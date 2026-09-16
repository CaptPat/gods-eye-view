import { createMarineDepthsLayer } from '../../layers/marine-depths/index.js';
import {
  NOAA_MARINE_DEPTHS_CREDIT,
  registerDynamicCredit,
} from '../../data/dataCredits.js';
import { governorRequestRender } from '../../renderGovernor.js';

/**
 * Construct one Marine Depths layer with its credit and the render governor.
 * The map stack is attached by application data setup (`attachMapStack`).
 */
export function createApplicationMarineDepths(options = {}) {
  return createMarineDepthsLayer({
    registerCredit: registerDynamicCredit,
    credit: NOAA_MARINE_DEPTHS_CREDIT,
    requestRender: governorRequestRender,
    ...options,
  });
}
