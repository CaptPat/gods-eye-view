import { createFireballsLayer } from '../../layers/fireballs/index.js';
import { CNEOS_FIREBALLS_CREDIT } from '../../data/dataCredits.js';
import { catalogPointServices } from './catalogPointServices.js';

/** Construct one Fireballs layer over the application scene owners. */
export function createApplicationFireballs(options = {}) {
  return createFireballsLayer({
    ...catalogPointServices(CNEOS_FIREBALLS_CREDIT),
    ...options,
  });
}
