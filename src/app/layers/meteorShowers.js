import { createMeteorShowersLayer } from '../../layers/meteor-showers/index.js';
import { IMO_METEOR_SHOWERS_CREDIT } from '../../data/dataCredits.js';
import { catalogPointServices } from './catalogPointServices.js';

/** Construct one Meteor Showers layer over the application scene owners. */
export function createApplicationMeteorShowers(options = {}) {
  return createMeteorShowersLayer({
    ...catalogPointServices(IMO_METEOR_SHOWERS_CREDIT),
    ...options,
  });
}
