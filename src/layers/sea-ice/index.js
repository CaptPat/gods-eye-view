import { createSeaIceImagery } from './imagery.js';
import { SEA_ICE_META, SEA_ICE_PROBE_URL, parseLayerTime } from './model.js';

export * from './model.js';
export { createSeaIceImagery, seaIceInsertIndex } from './imagery.js';

/** The GHRSST analysis publishes once a day; four checks a day keep it current. */
export const SEA_ICE_REFRESH_MS = 6 * 60 * 60_000;
export const SEA_ICE_OPACITY = 0.8;
const MAP_STACK_EVENT = 'gev:map-stack-changed';
/** GIBS's own name for the newest day, used when the served day is unknown. */
const LATEST_DAY = 'default';

/**
 * NASA GIBS sea ice concentration imagery above the base map. Each refresh
 * asks GIBS which day is newest and pins the tiles to it; if that fails before
 * any day is shown, the newest day still draws under GIBS's `default` name.
 * Like Weather Overlays, the imagery drapes the globe only, so the photoreal
 * 3D map source hides it and the row says so.
 */
export function createSeaIceLayer({
  fetchImpl = (...args) => fetch(...args),
  createImagery = createSeaIceImagery,
  registerCredit = () => false,
  credit = null,
  eventTarget = globalThis.window,
  requestRender = () => {},
  now = Date.now,
} = {}) {
  let imagery = null;
  let enabled = false;
  let shown = null;
  let lastUpdate = null;
  let error = null;
  let loading = false;
  let request = null;
  let mapStackController = null;
  let mapStackId = null;

  const render = () => requestRender(SEA_ICE_META.id);
  const onMapStack = (event) => {
    mapStackId = event?.detail?.activeStack?.id ?? mapStackId;
    if (!imagery) return;
    imagery.reseat();
    render();
  };

  function showDay(day) {
    if (day === shown) return;
    imagery.show(day);
    shown = day;
    render();
  }

  const layer = {
    id: SEA_ICE_META.id,
    name: SEA_ICE_META.name,
    icon: SEA_ICE_META.icon,
    source: SEA_ICE_META.source,
    updateInterval: SEA_ICE_REFRESH_MS,

    init(nextViewer) {
      imagery = createImagery(nextViewer);
      imagery.setAlpha(SEA_ICE_OPACITY);
      eventTarget?.addEventListener?.(MAP_STACK_EVENT, onMapStack);
    },

    attachMapStack(mapStack) {
      mapStackController = mapStack ?? null;
    },

    enable(nextViewer) {
      enabled = true;
      registerCredit(nextViewer, credit);
    },

    disable() {
      enabled = false;
      request?.abort();
      request = null;
      loading = false;
      imagery?.clear();
      shown = null;
      lastUpdate = null;
      error = null;
      render();
    },

    /** Resolves false only when disabled or the manager's own signal aborted. */
    async update(_viewer, { signal } = {}) {
      if (!enabled || !imagery) return false;
      request?.abort();
      const controller = new AbortController();
      request = controller;
      const onAbort = () => controller.abort();
      if (signal?.aborted) controller.abort();
      else signal?.addEventListener?.('abort', onAbort, { once: true });
      loading = true;
      try {
        const response = await fetchImpl(SEA_ICE_PROBE_URL, {
          signal: controller.signal,
        });
        try {
          await response.body?.cancel();
        } catch {
          /* only the headers matter */
        }
        if (!response.ok) throw new Error(`GIBS HTTP ${response.status}`);
        const day = parseLayerTime(response.headers.get('layer-time-actual'));
        if (!day) throw new Error('GIBS reported no sea ice date');
        if (!enabled || request !== controller) return true;
        showDay(day);
        lastUpdate = now();
        error = null;
        return true;
      } catch (failure) {
        if (signal?.aborted) return false;
        if (controller.signal.aborted || !enabled || request !== controller)
          return true;
        error = failure?.message || String(failure);
        if (shown === null) showDay(LATEST_DAY);
        return true;
      } finally {
        signal?.removeEventListener?.('abort', onAbort);
        if (request === controller) {
          request = null;
          loading = false;
        }
      }
    },

    destroy() {
      layer.disable();
      eventTarget?.removeEventListener?.(MAP_STACK_EVENT, onMapStack);
      imagery?.destroy();
      imagery = null;
    },

    getStats() {
      const name = SEA_ICE_META.source;
      const activeStack = mapStackController
        ? (mapStackController.getActiveId?.() ?? null)
        : mapStackId;
      if (activeStack === 'photoreal')
        return {
          status: 'idle',
          source: name,
          statusMessage: 'Hidden by Google 3D map source',
        };
      if (loading && shown === null)
        return { loading: true, source: name, loadingLabel: 'Loading sea ice' };
      if (shown === LATEST_DAY)
        return {
          stale: true,
          source: `${name} · latest day`,
          lastUpdate,
          error: 'Sea ice date unavailable — showing the latest day',
        };
      if (shown !== null && error)
        return {
          stale: true,
          source: `${name} · ${shown}`,
          lastUpdate,
          error: `Sea ice refresh failed — showing ${shown}`,
        };
      if (shown !== null)
        return { status: 'ok', source: `${name} · ${shown}`, lastUpdate };
      return { status: 'ok', source: name, lastUpdate };
    },
  };

  return layer;
}
