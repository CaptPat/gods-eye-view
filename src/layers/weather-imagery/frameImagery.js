import * as Cesium from 'cesium';

/** Loaded but effectively invisible: Cesium still requests tiles for it. */
export const PRELOAD_ALPHA = 0.001;

/**
 * Show `time` at once when nothing is shown, it is already shown, or its tiles
 * are ready. Otherwise preload it beside the shown frame and keep showing that.
 * Preloading can itself make a frame ready (a frame draped on 3D tiles is
 * ready as soon as it exists), so readiness is checked again afterwards.
 * @returns {boolean} Whether `time` is now the shown frame.
 */
export function swapToFrame(imagery, time) {
  const current = imagery.shownTime();
  if (current !== null && current !== time && !imagery.isReady(time)) {
    imagery.preload([time]);
    if (!imagery.isReady(time)) {
      imagery.release([current, time]);
      return false;
    }
  }
  imagery.show(time);
  imagery.release([time]);
  return true;
}

/**
 * One Cesium imagery layer per frame time for the current source. Frames go to
 * the collection `host()` names: the globe's `imageryLayers`, a photoreal 3D
 * tileset's own `imageryLayers` (Cesium drapes imagery onto the tiles), or no
 * collection at all, in which case they wait detached until `rehome()` finds
 * one. A globe frame is ready once the globe's tile queue first reports 0 after
 * its layer was added; the globe never reports for tileset imagery, so a frame
 * draped on a tileset counts as ready at once.
 *
 * `insertIndex` places new layers at that index (clamped to the collection)
 * instead of on top. It may be a constant integer or a function evaluated
 * fresh each time a layer is added (or re-homed), so callers can track a
 * moving target such as "directly above the base map".
 */
export function createFrameImagery(
  viewer,
  {
    createProvider,
    createLayer = (provider) => new Cesium.ImageryLayer(provider),
    insertIndex = null,
    host = () => ({ collection: viewer.imageryLayers, kind: 'globe' }),
  } = {},
) {
  if (typeof createProvider !== 'function') {
    throw new TypeError('createFrameImagery requires createProvider');
  }
  const layers = new Map();
  /** Frame time → the collection holding its layer, or null while detached. */
  const homes = new Map();
  const pending = new Set();
  const ready = new Set();
  let source = null;
  let shown = null;
  let alpha = 0.7;

  const removeProgressListener =
    viewer.scene.globe.tileLoadProgressEvent.addEventListener((queued) => {
      if (queued !== 0) return;
      for (const time of pending) ready.add(time);
      pending.clear();
    });

  function resolveInsertIndex() {
    const value =
      typeof insertIndex === 'function' ? insertIndex() : insertIndex;
    return Number.isInteger(value) ? value : null;
  }

  function resolveHost() {
    const next = host() || {};
    return next.collection
      ? { collection: next.collection, kind: next.kind || 'globe' }
      : { collection: null, kind: 'none' };
  }

  /** Add `layer` to the current host; returns where it went (null: detached). */
  function place(time, layer) {
    const { collection, kind } = resolveHost();
    if (!collection) return null;
    const index = resolveInsertIndex();
    if (index !== null) {
      collection.add(layer, Math.min(index, collection.length));
    } else {
      collection.add(layer);
    }
    if (kind === 'globe') {
      pending.add(time);
    } else {
      ready.add(time);
    }
    return collection;
  }

  function remove(time) {
    const layer = layers.get(time);
    if (!layer) return;
    const home = homes.get(time);
    if (home) home.remove(layer, true);
    else layer.destroy?.();
    layers.delete(time);
    homes.delete(time);
    pending.delete(time);
    ready.delete(time);
    if (shown === time) shown = null;
  }

  function ensure(time) {
    if (layers.has(time)) return layers.get(time);
    const layer = createLayer(createProvider(source, time), source);
    layer.alpha = PRELOAD_ALPHA;
    layer.show = true;
    layers.set(time, layer);
    homes.set(time, place(time, layer));
    return layer;
  }

  return {
    setSource(nextSource) {
      if (nextSource === source) return;
      for (const time of [...layers.keys()]) remove(time);
      source = nextSource;
    },
    preload(times) {
      for (const time of times) ensure(time);
    },
    show(time) {
      if (shown !== null && shown !== time && layers.has(shown))
        layers.get(shown).alpha = PRELOAD_ALPHA;
      ensure(time).alpha = alpha;
      shown = time;
    },
    setAlpha(nextAlpha) {
      alpha = nextAlpha;
      if (shown !== null && layers.has(shown)) layers.get(shown).alpha = alpha;
    },
    release(keepTimes) {
      const keep = new Set(keepTimes);
      for (const time of [...layers.keys()]) if (!keep.has(time)) remove(time);
    },
    /**
     * Move every current frame to the freshly resolved host and `insertIndex`:
     * to the 3D tiles when the globe is hidden, back above the base map when a
     * globe map returns, or detached when nothing can host imagery. Without an
     * `insertIndex` a frame on an unchanged host keeps its place (the "append
     * on top" default).
     */
    rehome() {
      const target = resolveHost().collection;
      for (const [time, layer] of layers) {
        const home = homes.get(time);
        if (home === target && insertIndex === null) continue;
        if (home) home.remove(layer, false);
        pending.delete(time);
        ready.delete(time);
        homes.set(time, place(time, layer));
      }
    },
    isReady: (time) => ready.has(time),
    readyCount: () =>
      [...layers.keys()].filter((time) => ready.has(time)).length,
    shownTime: () => shown,
    clear() {
      for (const time of [...layers.keys()]) remove(time);
    },
    destroy() {
      this.clear();
      removeProgressListener();
    },
  };
}
