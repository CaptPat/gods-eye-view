import { createNightSkyLayer } from '../../layers/night-sky/index.js';
import {
  D3_CELESTIAL_CREDIT,
  registerDynamicCredit,
} from '../../data/dataCredits.js';
import { governorRequestRender } from '../../renderGovernor.js';

/** Construct one Night Sky layer over the application scene owners. */
export function createApplicationNightSky(options = {}) {
  return createNightSkyLayer({
    requestRender: governorRequestRender,
    registerCredit: registerDynamicCredit,
    credit: D3_CELESTIAL_CREDIT,
    ...options,
  });
}
