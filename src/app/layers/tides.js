import {
  createCurrentStationsLayer,
  createTideStationsLayer,
} from '../../layers/tides/index.js';
import {
  NOAA_COOPS_CREDIT,
  registerDynamicCredit,
} from '../../data/dataCredits.js';
import { governorRequestRender } from '../../renderGovernor.js';
import {
  isOwnedByOtherLayer,
  registerPickOwner,
  resolvePickId,
  unregisterPickOwner,
} from '../../data/pickRegistry.js';
import {
  clearOverlaySource,
  hitTestWorldOverlay,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../../overlays/worldOverlay.js';

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

/** Construct one Tide Stations layer over the application scene owners. */
export function createApplicationTideStations(options = {}) {
  return createTideStationsLayer({ ...applicationServices(), ...options });
}

/** Construct one Current Stations layer over the application scene owners. */
export function createApplicationCurrentStations(options = {}) {
  return createCurrentStationsLayer({ ...applicationServices(), ...options });
}
