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
 * drapes the globe only, so the photoreal 3D map source hides it and the row
 * says so.
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
  let mapStackId = null;

  const render = () => requestRender(MARINE_DEPTHS_META.id);
  const onMapStack = (event) => {
    mapStackId = event?.detail?.activeStack?.id ?? mapStackId;
    if (!imagery) return;
    imagery.reseat();
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
      imagery = createImagery(nextViewer, { onTileError });
      eventTarget?.addEventListener?.(MAP_STACK_EVENT, onMapStack);
    },

    attachMapStack(mapStack) {
      mapStackController = mapStack ?? null;
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
    },

    getStats() {
      const name = MARINE_DEPTHS_META.source;
      const activeStack = mapStackController
        ? (mapStackController.getActiveId?.() ?? null)
        : mapStackId;
      if (activeStack === 'photoreal')
        return {
          status: 'idle',
          source: name,
          statusMessage: 'Hidden by Google 3D map source',
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
