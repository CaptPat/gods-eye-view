import { createUfoIncidentsLayer } from '../../layers/ufo-incidents/index.js';
import { UFO_INCIDENTS_CREDIT } from '../../data/dataCredits.js';
import { catalogPointServices } from './catalogPointServices.js';

/** Construct one UFO Incidents layer over the application scene owners. */
export function createApplicationUfoIncidents(options = {}) {
  return createUfoIncidentsLayer({
    ...catalogPointServices(UFO_INCIDENTS_CREDIT),
    ...options,
  });
}
