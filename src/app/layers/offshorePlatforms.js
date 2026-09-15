import { createOffshorePlatformsLayer } from '../../layers/offshore-platforms/index.js';
import { BSEE_PLATFORMS_CREDIT } from '../../data/dataCredits.js';
import { catalogPointServices } from './catalogPointServices.js';

/** Construct one Offshore Platforms layer over the application scene owners. */
export function createApplicationOffshorePlatforms(options = {}) {
  return createOffshorePlatformsLayer({
    ...catalogPointServices(BSEE_PLATFORMS_CREDIT),
    ...options,
  });
}
