import { createApplicationWeatherOverlays } from '../app/layers/weatherOverlays.js';

export * from '../layers/weather-overlays/index.js';

/** Wire real credits and the render governor; everything else uses browser defaults. */
export function createWeatherOverlaysLayer(options = {}) {
  return createApplicationWeatherOverlays(options);
}

export default createWeatherOverlaysLayer();
