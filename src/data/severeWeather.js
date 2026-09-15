import { createApplicationSevereWeather } from '../app/layers/severeWeather.js';

export * from '../layers/severe-weather/index.js';

/** Wire the application's overlay host, context store, pick registry, render governor and credits. */
export function createSevereWeatherLayer(options = {}) {
  return createApplicationSevereWeather(options);
}

export default createSevereWeatherLayer();
