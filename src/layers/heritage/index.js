import { createCatalogPointsLayer } from '../catalog-points/index.js';
import { loadBundledJson } from '../catalog-points/bundled.js';
import { HERITAGE_SNAPSHOT_URLS } from './bundledSource.js';
import {
  HERITAGE_LAYERS,
  buildFortCard,
  buildParkCard,
  buildWorldHeritageCard,
  parseHeritageSnapshot,
} from './model.js';

export * from './model.js';
export { HERITAGE_SNAPSHOT_URLS } from './bundledSource.js';

/** Bundled snapshots cannot change while the app runs: one load serves the session. */
export const HERITAGE_SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

function createHeritageLayer(kind, buildCard, options) {
  return createCatalogPointsLayer({
    ...options,
    meta: HERITAGE_LAYERS[kind],
    maxAgeMs: HERITAGE_SNAPSHOT_MAX_AGE_MS,
    refreshInterval: 24 * 60 * 60_000,
    buildCard: (record) => buildCard(record),
    loadRecords: async ({ fetchImpl, signal }) => {
      const parsed = parseHeritageSnapshot(
        await loadBundledJson(HERITAGE_SNAPSHOT_URLS[kind], {
          fetchImpl,
          signal,
        }),
        kind,
      );
      if (!parsed) throw new Error(`malformed ${kind} snapshot`);
      return parsed;
    },
  });
}

/** UNESCO World Heritage Sites from Wikidata. */
export function createWorldHeritageLayer(options = {}) {
  return createHeritageLayer('worldHeritage', buildWorldHeritageCard, options);
}

/** Castles, forts, fortifications and star forts from Wikidata. */
export function createFortsCastlesLayer(options = {}) {
  return createHeritageLayer('forts', buildFortCard, options);
}

/** National parks and US National Monuments from Wikidata. */
export function createParksMonumentsLayer(options = {}) {
  return createHeritageLayer('parks', buildParkCard, options);
}
