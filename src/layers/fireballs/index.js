import { createCatalogPointsLayer } from '../catalog-points/index.js';
import {
  FIREBALLS_META,
  buildFireballCard,
  parseFireballsPayload,
} from './model.js';

export * from './model.js';

export const FIREBALLS_ENDPOINT = '/api/fireballs';
/** The proxy caches CNEOS for six hours; asking more often gains nothing. */
export const FIREBALLS_MAX_AGE_MS = 6 * 60 * 60_000;
export const FIREBALLS_REFRESH_CHECK_MS = 60 * 60_000;

/** NASA/JPL CNEOS fireballs (bright bolides) sized by impact energy. */
export function createFireballsLayer(options = {}) {
  return createCatalogPointsLayer({
    ...options,
    meta: FIREBALLS_META,
    maxAgeMs: FIREBALLS_MAX_AGE_MS,
    refreshInterval: FIREBALLS_REFRESH_CHECK_MS,
    buildCard: (record) => buildFireballCard(record),
    loadRecords: async ({ fetchImpl, signal }) => {
      const response = await fetchImpl(FIREBALLS_ENDPOINT, { signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const parsed = parseFireballsPayload(await response.json());
      if (!parsed) throw new Error('malformed fireball payload');
      return parsed;
    },
  });
}
