import { NO_IMAGERY_HOST, resolveImageryHost } from '../../maps/imageryHost.js';
import { createMarineDepthsImagery } from './imagery.js';
import { MARINE_DEPTHS_META } from './model.js';

export * from './model.js';
export {
  createMarineDepthsImagery,
  marineDepthsInsertIndex,
  DEPTH_BANDS_OPACITY,
  CHART_DEPTHS_OPACITY,
} from './imagery.js';

const MAP_STACK_EVENT = 'gev:map-stack-changed';
/** Tile failures inside this window count as a live outage on the status row. */
export const MARINE_DEPTHS_ERROR_WINDOW_MS = 60_000;

/**
 * NOAA seafloor depth imagery above the base map: NCEI depth bands worldwide,
 * plus NOAA chart soundings and contours in US waters once the camera is
 * close. Static imagery, so nothing refreshes. Like Sea Ice, the imagery
 * drapes the globe, or the tiles themselves on Google 3D; only a map source
 * with neither hides it, and the row says so.
 */
export function createMarineDepthsLayer({
  createImagery = createMarineDepthsImagery,
  registerCredit = () => false,
  credit = null,
  eventTarget = globalThis.window,
  requestRender = () => {},
  now = Date.now,
} = {}) {
  let imagery = null;
  let enabled = false;
  let enabledAt = null;
  let lastTileError = null;
  let mapStackController = null;
  let viewer = null;

  const render = () => requestRender(MARINE_DEPTHS_META.id);
  const currentHost = () =>
    resolveImageryHost({
      viewer,
      tileset: mapStackController?.getImageryHostTileset?.() ?? null,
    });
  const onMapStack = () => {
    if (!imagery) return;
    imagery.rehome();
    render();
  };
  const onTileError = () => {
    if (enabled) lastTileError = now();
  };

  const layer = {
    id: MARINE_DEPTHS_META.id,
    name: MARINE_DEPTHS_META.name,
    icon: MARINE_DEPTHS_META.icon,
    source: MARINE_DEPTHS_META.source,
    updateInterval: 0,

    init(nextViewer) {
      viewer = nextViewer;
      imagery = createImagery(nextViewer, { onTileError, host: currentHost });
      eventTarget?.addEventListener?.(MAP_STACK_EVENT, onMapStack);
    },

    attachMapStack(mapStack) {
      mapStackController = mapStack ?? null;
      onMapStack();
    },

    enable(nextViewer) {
      enabled = true;
      enabledAt = now();
      lastTileError = null;
      registerCredit(nextViewer, credit);
      imagery?.show();
      render();
    },

    disable() {
      enabled = false;
      enabledAt = null;
      lastTileError = null;
      imagery?.clear();
      render();
    },

    async update() {
      return enabled;
    },

    destroy() {
      layer.disable();
      eventTarget?.removeEventListener?.(MAP_STACK_EVENT, onMapStack);
      imagery?.destroy();
      imagery = null;
      viewer = null;
    },

    getStats() {
      const name = MARINE_DEPTHS_META.source;
      if (viewer && currentHost().kind === 'none')
        return {
          status: 'idle',
          source: name,
          statusMessage: NO_IMAGERY_HOST,
        };
      if (
        enabled &&
        lastTileError !== null &&
        now() - lastTileError < MARINE_DEPTHS_ERROR_WINDOW_MS
      )
        return {
          stale: true,
          source: name,
          lastUpdate: enabledAt,
          error: 'Some NOAA depth tiles failed to load',
        };
      return { status: 'ok', source: name, lastUpdate: enabledAt };
    },
  };

  return layer;
}
