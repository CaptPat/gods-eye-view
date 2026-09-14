import { createWeatherRadarLayer as createLayer } from '../layers/weather-radar/index.js';
import { IEM_NEXRAD_CREDIT, RAINVIEWER_CREDIT, registerDynamicCredit } from './dataCredits.js';

export * from '../layers/weather-radar/index.js';

/** Wire real credits; everything else uses the layer's browser defaults. */
export function createWeatherRadarLayer(options = {}) {
  return createLayer({
    registerCredit: registerDynamicCredit,
    credits: { rainviewer: RAINVIEWER_CREDIT, iem: IEM_NEXRAD_CREDIT },
    ...options,
  });
}

export default createWeatherRadarLayer();
