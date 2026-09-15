import { createWeatherRadarLayer } from '../../layers/weather-radar/index.js';
import {
  IEM_NEXRAD_CREDIT,
  RAINVIEWER_CREDIT,
  registerDynamicCredit,
} from '../../data/dataCredits.js';
import { governorRequestRender } from '../../renderGovernor.js';

/**
 * Construct one Weather Radar layer with real credits and the render governor.
 * The map stack is attached by application data setup (`attachMapStack`).
 */
export function createApplicationWeatherRadar(options = {}) {
  return createWeatherRadarLayer({
    registerCredit: registerDynamicCredit,
    credits: { rainviewer: RAINVIEWER_CREDIT, iem: IEM_NEXRAD_CREDIT },
    requestRender: governorRequestRender,
    ...options,
  });
}
