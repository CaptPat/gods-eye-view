import { createSeaIceLayer } from '../../layers/sea-ice/index.js';
import {
  NASA_GIBS_SEA_ICE_CREDIT,
  registerDynamicCredit,
} from '../../data/dataCredits.js';
import { governorRequestRender } from '../../renderGovernor.js';

/**
 * Construct one Sea Ice layer with its credit and the render governor.
 * The map stack is attached by application data setup (`attachMapStack`).
 */
export function createApplicationSeaIce(options = {}) {
  return createSeaIceLayer({
    registerCredit: registerDynamicCredit,
    credit: NASA_GIBS_SEA_ICE_CREDIT,
    requestRender: governorRequestRender,
    ...options,
  });
}
