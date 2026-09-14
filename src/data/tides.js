import {
  createCurrentStationsLayer as createCurrentLayer,
  createTideStationsLayer as createTideLayer,
} from '../layers/tides/index.js';
import { NOAA_COOPS_CREDIT, registerDynamicCredit } from './dataCredits.js';
import { governorRequestRender } from '../renderGovernor.js';
import {
  isOwnedByOtherLayer,
  registerPickOwner,
  resolvePickId,
  unregisterPickOwner,
} from './pickRegistry.js';
import {
  clearOverlaySource,
  hitTestWorldOverlay,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';

export * from '../layers/tides/index.js';

/** Read-only view of the weather report's units preference. */
const browserStorage = Object.freeze({
  getItem: (key) => globalThis.localStorage?.getItem(key) ?? null,
});

/** The application's overlay host, render governor, credit display and browser services. */
function applicationServices() {
  return {
    overlayHost: {
      setEntries: setOverlayEntries,
      setVisible: setOverlaySourceVisible,
      clearSource: clearOverlaySource,
      hitTest: hitTestWorldOverlay,
    },
    requestRender: governorRequestRender,
    registerCredit: registerDynamicCredit,
    credit: NOAA_COOPS_CREDIT,
    storage: browserStorage,
    openUrl: (url) => globalThis.open?.(url, '_blank', 'noopener,noreferrer'),
    picking: {
      registerPickOwner,
      unregisterPickOwner,
      resolvePickId,
      isOwnedByOtherLayer,
    },
  };
}

export function createTideStationsLayer(options = {}) {
  return createTideLayer({ ...applicationServices(), ...options });
}

export function createCurrentStationsLayer(options = {}) {
  return createCurrentLayer({ ...applicationServices(), ...options });
}

export const tideStationsLayer = createTideStationsLayer();
export const currentStationsLayer = createCurrentStationsLayer();

export default [tideStationsLayer, currentStationsLayer];
