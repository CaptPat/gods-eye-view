import { createSkyObjectsLayer } from '../../layers/sky-objects/index.js';
import {
  SKY_OBJECTS_CREDIT,
  registerDynamicCredit,
} from '../../data/dataCredits.js';
import { governorRequestRender } from '../../renderGovernor.js';

/** Construct one Planets & Deep Sky layer over the application scene owners. */
export function createApplicationSkyObjects(options = {}) {
  return createSkyObjectsLayer({
    requestRender: governorRequestRender,
    registerCredit: registerDynamicCredit,
    credit: SKY_OBJECTS_CREDIT,
    ...options,
  });
}
