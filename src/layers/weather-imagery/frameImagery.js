import * as Cesium from 'cesium';

/** Loaded but effectively invisible: Cesium still requests tiles for it. */
export const PRELOAD_ALPHA = 0.001;

/**
 * Show `time` at once when nothing is shown, it is already shown, or its tiles
 * are ready. Otherwise preload it beside the shown frame and keep showing that.
 * @returns {boolean} Whether `time` is now the shown frame.
 */
export function swapToFrame(imagery, time) {
  const current = imagery.shownTime();
  if (current === null || current === time || imagery.isReady(time)) {
    imagery.show(time);
    imagery.release([time]);
    return true;
  }
  imagery.preload([time]);
  imagery.release([current, time]);
  return false;
}

/**
 * One Cesium imagery layer per frame time for the current source. A frame is
 * ready once the globe's tile queue first reports 0 after its layer was added.
 * `insertIndex` places new layers at that index (clamped to the collection)
 * instead of on top. It may be a constant integer or a function evaluated
 * fresh each time a layer is added (or re-seated), so callers can track a
 * moving target such as "directly above the base map".
 */
export function createFrameImagery(
  viewer,
  {
    createProvider,
    createLayer = (provider) => new Cesium.ImageryLayer(provider),
    insertIndex = null,
  } = {},
) {
  if (typeof createProvider !== 'function') {
    throw new TypeError('createFrameImagery requires createProvider');
  }
  const layers = new Map();
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

  function remove(time) {
    const layer = layers.get(time);
    if (!layer) return;
    viewer.imageryLayers.remove(layer, true);
    layers.delete(time);
    pending.delete(time);
    ready.delete(time);
    if (shown === time) shown = null;
  }

  function ensure(time) {
    if (layers.has(time)) return layers.get(time);
    const layer = createLayer(createProvider(source, time), source);
    layer.alpha = PRELOAD_ALPHA;
    layer.show = true;
    const index = resolveInsertIndex();
    if (index !== null) {
      viewer.imageryLayers.add(
        layer,
        Math.min(index, viewer.imageryLayers.length),
      );
    } else {
      viewer.imageryLayers.add(layer);
    }
    layers.set(time, layer);
    pending.add(time);
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
     * Move every current frame back to a freshly resolved `insertIndex`,
     * for example after the base map is added or removed beneath it. A
     * no-op when `insertIndex` was never given (the "append on top"
     * default, e.g. radar).
     */
    reseat() {
      if (insertIndex === null) return;
      for (const layer of layers.values()) {
        viewer.imageryLayers.remove(layer, false);
        const index = resolveInsertIndex();
        viewer.imageryLayers.add(
          layer,
          Math.min(
            index ?? viewer.imageryLayers.length,
            viewer.imageryLayers.length,
          ),
        );
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
