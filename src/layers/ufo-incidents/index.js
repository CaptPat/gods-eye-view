import { createCatalogPointsLayer } from '../catalog-points/index.js';
import { loadUfoSnapshot } from './bundledSource.js';
import { UFO_INCIDENTS_META, buildUfoCard, parseUfoSnapshot } from './model.js';

export * from './model.js';
export { UFO_SNAPSHOT_URL, loadUfoSnapshot } from './bundledSource.js';

/** The bundled snapshot cannot change while the app runs: one load serves the session. */
export const UFO_SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

/** Notable UFO incidents from Wikidata as clickable points linking to Wikipedia. */
export function createUfoIncidentsLayer(options = {}) {
  return createCatalogPointsLayer({
    ...options,
    meta: UFO_INCIDENTS_META,
    maxAgeMs: UFO_SNAPSHOT_MAX_AGE_MS,
    refreshInterval: 24 * 60 * 60_000,
    buildCard: (record) => buildUfoCard(record),
    loadRecords: async ({ fetchImpl, signal }) => {
      const parsed = parseUfoSnapshot(
        await loadUfoSnapshot({ fetchImpl, signal }),
      );
      if (!parsed) throw new Error('malformed UFO incidents snapshot');
      return parsed;
    },
  });
}
