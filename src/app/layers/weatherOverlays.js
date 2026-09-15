import { createWeatherOverlaysLayer } from '../../layers/weather-overlays/index.js';
import {
  GOOGLE_AIR_QUALITY_CREDIT,
  GOOGLE_POLLEN_CREDIT,
  NOAA_GFS_CREDIT,
  NOAA_GMGSI_CREDIT,
  registerDynamicCredit,
} from '../../data/dataCredits.js';
import { governorRequestRender } from '../../renderGovernor.js';

/**
 * Construct one Weather Overlays layer with real credits and the render governor.
 * The map stack is attached by application data setup (`attachMapStack`).
 */
export function createApplicationWeatherOverlays(options = {}) {
  return createWeatherOverlaysLayer({
    registerCredit: registerDynamicCredit,
    credits: {
      clouds: NOAA_GMGSI_CREDIT,
      temperature: NOAA_GFS_CREDIT,
      'air-quality': GOOGLE_AIR_QUALITY_CREDIT,
      pollen: GOOGLE_POLLEN_CREDIT,
    },
    requestRender: governorRequestRender,
    ...options,
  });
}
