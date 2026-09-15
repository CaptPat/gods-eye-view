import { createOilGasLayer } from '../../layers/oil-gas/index.js';
import { createTransmissionLinesLayer } from '../../layers/transmission-lines/index.js';
import { OSM_INFRASTRUCTURE_CREDIT } from '../../data/dataCredits.js';
import { catalogPointServices } from './catalogPointServices.js';

/** Construct one Transmission Lines layer over the application scene owners. */
export function createApplicationTransmissionLines(options = {}) {
  return createTransmissionLinesLayer({
    ...catalogPointServices(OSM_INFRASTRUCTURE_CREDIT),
    ...options,
  });
}

/** Construct one Oil & Gas layer over the application scene owners. */
export function createApplicationOilGas(options = {}) {
  return createOilGasLayer({
    ...catalogPointServices(OSM_INFRASTRUCTURE_CREDIT),
    ...options,
  });
}
