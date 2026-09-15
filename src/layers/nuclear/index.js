import { createCatalogPointsLayer } from '../catalog-points/index.js';
import { loadNuclearSnapshot } from './bundledSource.js';
import {
  NUCLEAR_LAYERS,
  buildAccidentCard,
  buildPlantCard,
  buildWasteCard,
  parseNuclearSnapshot,
} from './model.js';

export * from './model.js';
export { NUCLEAR_SNAPSHOT_URLS, loadNuclearSnapshot } from './bundledSource.js';

/** Bundled snapshots cannot change while the app runs: one load serves the session. */
export const NUCLEAR_SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

function createNuclearLayer(kind, buildCard, options) {
  return createCatalogPointsLayer({
    ...options,
    meta: NUCLEAR_LAYERS[kind],
    maxAgeMs: NUCLEAR_SNAPSHOT_MAX_AGE_MS,
    refreshInterval: 24 * 60 * 60_000,
    buildCard: (record) => buildCard(record),
    loadRecords: async ({ fetchImpl, signal }) => {
      const parsed = parseNuclearSnapshot(
        await loadNuclearSnapshot(kind, { fetchImpl, signal }),
        kind,
      );
      if (!parsed) throw new Error(`malformed nuclear ${kind} snapshot`);
      return parsed;
    },
  });
}

/** Nuclear power plants from Wikidata, coloured by status and sized by capacity. */
export function createNuclearPowerPlantsLayer(options = {}) {
  return createNuclearLayer('plants', buildPlantCard, options);
}

/** Radioactive waste and deep geological repositories from Wikidata. */
export function createNuclearWasteSitesLayer(options = {}) {
  return createNuclearLayer('waste', buildWasteCard, options);
}

/** Nuclear accidents and disasters from Wikidata, coloured and sized by INES level. */
export function createNuclearAccidentsLayer(options = {}) {
  return createNuclearLayer('accidents', buildAccidentCard, options);
}
