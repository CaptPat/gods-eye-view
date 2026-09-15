import { createPowerPlantsLayer } from '../../layers/power-plants/index.js';
import { GPPD_CREDIT } from '../../data/dataCredits.js';
import { catalogPointServices } from './catalogPointServices.js';

/** Construct one Power Plants layer over the application scene owners. */
export function createApplicationPowerPlants(options = {}) {
  return createPowerPlantsLayer({
    ...catalogPointServices(GPPD_CREDIT),
    ...options,
  });
}
