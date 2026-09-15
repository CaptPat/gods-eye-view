import { createCatalogPointsLayer } from '../catalog-points/index.js';
import {
  METEOR_SHOWERS_META,
  buildShowerCard,
  showerRecords,
} from './model.js';

export * from './model.js';

/** Sub-radiant points drift 0.5° west every two minutes as the Earth turns. */
export const METEOR_POSITION_MAX_AGE_MS = 120_000;

/** Today's active meteor showers, each drawn under its radiant; computed, no network. */
export function createMeteorShowersLayer(options = {}) {
  const now = options.now ?? Date.now;
  return createCatalogPointsLayer({
    ...options,
    meta: METEOR_SHOWERS_META,
    maxAgeMs: METEOR_POSITION_MAX_AGE_MS,
    refreshInterval: METEOR_POSITION_MAX_AGE_MS,
    buildCard: (record) => buildShowerCard(record),
    loadRecords: async () => showerRecords(new Date(now())),
  });
}
