import { createBandRendering } from '../grid-bands/rendering.js';
import {
  AURORA_BAND_LEVELS,
  AURORA_META,
  auroraStatusLabel,
  parseAuroraPayload,
} from './model.js';

export * from './model.js';

export const AURORA_ENDPOINT = '/api/aurora';
/** The proxy caches SWPC for five minutes; each refresh simply asks again. */
export const AURORA_REFRESH_MS = 5 * 60_000;

/** NOAA SWPC OVATION aurora probability, drawn as coloured ground bands. */
export function createAuroraLayer({
  fetchImpl = (...args) => fetch(...args),
  createRendering = createBandRendering,
  requestRender = () => {},
  registerCredit = () => false,
  credit = null,
  now = Date.now,
} = {}) {
  const id = AURORA_META.id;
  let rendering = null;
  let enabled = false;
  let request = null;
  let forecast = null;
  let lastUpdate = null;
  let error = null;
  let loading = false;

  const layer = {
    id,
    name: AURORA_META.name,
    icon: AURORA_META.icon,
    source: AURORA_META.source,
    updateInterval: 0,
    refreshInterval: AURORA_REFRESH_MS,

    init(viewer) {
      rendering = createRendering(viewer, {
        id,
        levels: AURORA_BAND_LEVELS,
        requestRender,
      });
    },

    enable(viewer) {
      enabled = true;
      registerCredit(viewer, credit);
      if (forecast) rendering.setBands(forecast.bands);
      rendering.setShow(true);
      requestRender(id);
    },

    disable() {
      enabled = false;
      request?.abort();
      request = null;
      loading = false;
      rendering?.setShow(false);
      rendering?.clear();
      requestRender(id);
    },

    async update(_viewer, { signal } = {}) {
      if (!enabled || !rendering || signal?.aborted) return false;
      request?.abort();
      const controller = new AbortController();
      request = controller;
      const onAbort = () => controller.abort();
      signal?.addEventListener?.('abort', onAbort, { once: true });
      loading = true;
      try {
        const response = await fetchImpl(AURORA_ENDPOINT, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const parsed = parseAuroraPayload(await response.json());
        if (!parsed) throw new Error('malformed aurora payload');
        if (!enabled || request !== controller) return true;
        forecast = parsed;
        error = null;
        lastUpdate = now();
        rendering.setBands(parsed.bands);
        return true;
      } catch {
        if (signal?.aborted) return false;
        if (controller.signal.aborted) return true;
        error = forecast
          ? AURORA_META.refreshFailedText
          : AURORA_META.unavailableText;
        return true;
      } finally {
        if (request === controller) {
          request = null;
          loading = false;
        }
        signal?.removeEventListener?.('abort', onAbort);
      }
    },

    destroy() {
      layer.disable();
      rendering?.destroy();
      rendering = null;
      forecast = null;
    },

    getStats() {
      const count = forecast?.bands.length ?? 0;
      if (loading)
        return {
          loading: true,
          loadingLabel: AURORA_META.loadingLabel,
          count,
          lastUpdate,
        };
      if (error && !forecast) return { count: 0, lastUpdate: null, error };
      if (error) return { stale: true, count, lastUpdate, error };
      const label = auroraStatusLabel(forecast);
      if (forecast.stale)
        return { stale: true, count, lastUpdate, loadingLabel: label };
      return { count, lastUpdate, loadingLabel: label };
    },
  };
  return layer;
}
