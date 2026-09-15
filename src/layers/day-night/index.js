import { createBandRendering } from '../grid-bands/rendering.js';
import { computeSunMoon } from './bodies.js';
import { createBodyMarkers } from './markers.js';
import { nightBands } from './solar.js';

export { computeSunMoon } from './bodies.js';
export { createBodyMarkers, moonLabel } from './markers.js';
export * from './solar.js';

export const DAY_NIGHT_META = Object.freeze({
  id: 'day-night',
  name: 'Day & Night',
  icon: '🌗',
  source: 'Sun & Moon',
  unavailableText: 'Sun and moon positions unavailable',
});

/** The terminator moves 0.5° in two minutes: about half a band cell. */
export const DAY_NIGHT_REFRESH_MS = 120_000;

/** Civil, nautical and astronomical twilight, then night: one navy, darker each step. */
export const NIGHT_BAND_LEVELS = Object.freeze(
  [0.12, 0.2, 0.28, 0.36].map((alpha) =>
    Object.freeze({ color: '#0b1633', alpha }),
  ),
);

/** Night and twilight shading with sun and moon overhead markers; computed, no network. */
export function createDayNightLayer({
  createRendering = createBandRendering,
  createMarkers = createBodyMarkers,
  computeBodies = computeSunMoon,
  requestRender = () => {},
  now = Date.now,
} = {}) {
  const id = DAY_NIGHT_META.id;
  let rendering = null;
  let markers = null;
  let enabled = false;
  let bodies = null;
  let bandCount = 0;
  let lastUpdate = null;
  let error = null;

  const layer = {
    id,
    name: DAY_NIGHT_META.name,
    icon: DAY_NIGHT_META.icon,
    source: DAY_NIGHT_META.source,
    updateInterval: 0,
    refreshInterval: DAY_NIGHT_REFRESH_MS,

    init(viewer) {
      rendering = createRendering(viewer, {
        id,
        levels: NIGHT_BAND_LEVELS,
        requestRender,
      });
      markers = createMarkers(viewer);
    },

    enable() {
      enabled = true;
      rendering.setShow(true);
      markers.setShow(true);
      requestRender(id);
    },

    disable() {
      enabled = false;
      rendering?.setShow(false);
      rendering?.clear();
      markers?.setShow(false);
      requestRender(id);
    },

    async update(_viewer, { signal } = {}) {
      if (!enabled || !rendering || signal?.aborted) return false;
      try {
        const next = computeBodies(new Date(now()));
        bandCount = rendering.setBands(nightBands(next.sun, { cellDeg: 1 }));
        markers.set(next);
        bodies = next;
        error = null;
        lastUpdate = now();
        // A timer-driven scene change the idle render governor cannot see.
        requestRender(id);
      } catch {
        error = DAY_NIGHT_META.unavailableText;
      }
      return true;
    },

    destroy() {
      layer.disable();
      rendering?.destroy();
      markers?.destroy();
      rendering = null;
      markers = null;
    },

    getStats() {
      if (error && !bodies) return { count: 0, lastUpdate: null, error };
      if (error) return { stale: true, count: bandCount, lastUpdate, error };
      if (!bodies) return { count: 0, lastUpdate: null };
      return {
        count: bandCount,
        lastUpdate,
        loadingLabel: `Moon ${Math.round(bodies.illumination * 100)}% lit, ${bodies.waxing ? 'waxing' : 'waning'}`,
      };
    },
  };
  return layer;
}
