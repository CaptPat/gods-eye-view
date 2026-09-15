import { createAuroraLayer } from '../../layers/aurora/index.js';
import {
  NOAA_SWPC_AURORA_CREDIT,
  registerDynamicCredit,
} from '../../data/dataCredits.js';
import { governorRequestRender } from '../../renderGovernor.js';

/** Construct one Aurora Forecast layer over the application scene owners. */
export function createApplicationAuroraForecast(options = {}) {
  return createAuroraLayer({
    requestRender: governorRequestRender,
    registerCredit: registerDynamicCredit,
    credit: NOAA_SWPC_AURORA_CREDIT,
    ...options,
  });
}
