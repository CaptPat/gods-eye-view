import {
  createApplicationCurrentStations,
  createApplicationTideStations,
} from '../app/layers/tides.js';

export * from '../layers/tides/index.js';

export function createTideStationsLayer(options = {}) {
  return createApplicationTideStations(options);
}

export function createCurrentStationsLayer(options = {}) {
  return createApplicationCurrentStations(options);
}

export const tideStationsLayer = createTideStationsLayer();
export const currentStationsLayer = createCurrentStationsLayer();

export default [tideStationsLayer, currentStationsLayer];
