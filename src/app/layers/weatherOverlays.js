import { createWeatherOverlaysLayer } from '../../layers/weather-overlays/index.js';
import {
  GOOGLE_AIR_QUALITY_CREDIT,
  GOOGLE_POLLEN_CREDIT,
  registerDynamicCredit,
} from '../../data/dataCredits.js';
import { governorRequestRender } from '../../renderGovernor.js';

/**
 * Construct the Air Quality layer (id `weather-overlays`) with real credits and the render governor.
 * The map stack is attached by application data setup (`attachMapStack`).
 */
export function createApplicationWeatherOverlays(options = {}) {
  return createWeatherOverlaysLayer({
    registerCredit: registerDynamicCredit,
    credits: {
      'air-quality': GOOGLE_AIR_QUALITY_CREDIT,
      pollen: GOOGLE_POLLEN_CREDIT,
    },
    requestRender: governorRequestRender,
    ...options,
  });
}
