import { createCatalogPointsLayer } from '../catalog-points/index.js';
import { loadBundledJson } from '../catalog-points/bundled.js';
import { OFFSHORE_PLATFORMS_SNAPSHOT_URL } from './bundledSource.js';
import {
  OFFSHORE_PLATFORMS_META,
  buildOffshorePlatformCard,
  parseOffshorePlatformSnapshot,
} from './model.js';

export * from './model.js';
export { OFFSHORE_PLATFORMS_SNAPSHOT_URL } from './bundledSource.js';

/** The bundled snapshot cannot change while the app runs: one load serves the session. */
export const OFFSHORE_PLATFORMS_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

/** Standing U.S. offshore oil and gas structures from BSEE, styled by structure type. */
export function createOffshorePlatformsLayer(options = {}) {
  return createCatalogPointsLayer({
    ...options,
    meta: OFFSHORE_PLATFORMS_META,
    maxAgeMs: OFFSHORE_PLATFORMS_MAX_AGE_MS,
    refreshInterval: 24 * 60 * 60_000,
    buildCard: (record) => buildOffshorePlatformCard(record),
    loadRecords: async ({ fetchImpl, signal }) => {
      const parsed = parseOffshorePlatformSnapshot(
        await loadBundledJson(OFFSHORE_PLATFORMS_SNAPSHOT_URL, {
          fetchImpl,
          signal,
        }),
      );
      if (!parsed) throw new Error('malformed offshore platform snapshot');
      return parsed;
    },
  });
}
