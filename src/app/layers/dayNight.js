import { createDayNightLayer } from '../../layers/day-night/index.js';
import { governorRequestRender } from '../../renderGovernor.js';

/** Construct one Day & Night layer over the application scene owners. */
export function createApplicationDayNight(options = {}) {
  return createDayNightLayer({
    requestRender: governorRequestRender,
    ...options,
  });
}
