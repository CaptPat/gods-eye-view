import { createSevereWeatherLayer } from '../../layers/severe-weather/index.js';
import {
  GDACS_CREDIT,
  NWS_ALERTS_CREDIT,
  registerDynamicCredit,
} from '../../data/dataCredits.js';
import { governorRequestRender } from '../../renderGovernor.js';
import {
  clearSelectedEntityContextForLayer,
  registerEntityContext,
  removeEntityContextsForLayer,
  selectEntityContext,
} from '../../data/contextStore.js';
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
import { pickGround } from '../../weatherReport/groundPick.js';

/** Wire the application's overlay host, context store, pick registry, render governor and credits. */
export function createApplicationSevereWeather(options = {}) {
  return createSevereWeatherLayer({
    overlayHost: {
      setEntries: setOverlayEntries,
      setVisible: setOverlaySourceVisible,
      clearSource: clearOverlaySource,
      hitTest: hitTestWorldOverlay,
    },
    context: {
      registerEntityContext,
      selectEntityContext,
      clearSelectedEntityContextForLayer,
      removeEntityContextsForLayer,
    },
    picking: {
      resolvePickId,
      isOwnedByOtherLayer,
      registerPickOwner,
      unregisterPickOwner,
    },
    pickGround,
    requestRender: governorRequestRender,
    registerCredit: registerDynamicCredit,
    credits: [NWS_ALERTS_CREDIT, GDACS_CREDIT],
    ...options,
  });
}
