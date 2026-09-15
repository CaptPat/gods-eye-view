import { createCatalogPointsLayer } from '../catalog-points/index.js';
import { loadBundledJson } from '../catalog-points/bundled.js';
import { AIRPORTS_SNAPSHOT_URL } from './bundledSource.js';
import {
  AIRPORTS_META,
  buildAirportCard,
  parseAirportSnapshot,
} from './model.js';

export * from './model.js';
export { AIRPORTS_SNAPSHOT_URL } from './bundledSource.js';

/** The bundled snapshot cannot change while the app runs: one load serves the session. */
export const AIRPORTS_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

/** Large and medium airports from OurAirports with their ICAO and IATA codes. */
export function createAirportsLayer(options = {}) {
  return createCatalogPointsLayer({
    ...options,
    meta: AIRPORTS_META,
    maxAgeMs: AIRPORTS_MAX_AGE_MS,
    refreshInterval: 24 * 60 * 60_000,
    buildCard: (record) => buildAirportCard(record),
    loadRecords: async ({ fetchImpl, signal }) => {
      const parsed = parseAirportSnapshot(
        await loadBundledJson(AIRPORTS_SNAPSHOT_URL, { fetchImpl, signal }),
      );
      if (!parsed) throw new Error('malformed airport snapshot');
      return parsed;
    },
  });
}
