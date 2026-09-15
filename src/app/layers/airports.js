import { createAirportsLayer } from '../../layers/airports/index.js';
import { OURAIRPORTS_CREDIT } from '../../data/dataCredits.js';
import { catalogPointServices } from './catalogPointServices.js';

/** Construct one Airports layer over the application scene owners. */
export function createApplicationAirports(options = {}) {
  return createAirportsLayer({
    ...catalogPointServices(OURAIRPORTS_CREDIT),
    ...options,
  });
}
