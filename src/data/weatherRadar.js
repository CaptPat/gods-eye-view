import { createApplicationWeatherRadar } from '../app/layers/weatherRadar.js';

export * from '../layers/weather-radar/index.js';

/** Wire real credits; everything else uses the layer's browser defaults. */
export function createWeatherRadarLayer(options = {}) {
  return createApplicationWeatherRadar(options);
}

export default createWeatherRadarLayer();
