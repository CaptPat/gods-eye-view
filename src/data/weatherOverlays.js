import { createWeatherOverlaysLayer as createLayer } from '../layers/weather-overlays/index.js';
import {
  GOOGLE_AIR_QUALITY_CREDIT,
  GOOGLE_POLLEN_CREDIT,
  NOAA_GFS_CREDIT,
  NOAA_GMGSI_CREDIT,
  registerDynamicCredit,
} from './dataCredits.js';
import { governorRequestRender } from '../renderGovernor.js';

export * from '../layers/weather-overlays/index.js';

/** Wire real credits and the render governor; everything else uses browser defaults. */
export function createWeatherOverlaysLayer(options = {}) {
  return createLayer({
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

export default createWeatherOverlaysLayer();
