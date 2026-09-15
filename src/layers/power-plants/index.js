import { createCatalogPointsLayer } from '../catalog-points/index.js';
import { loadBundledJson } from '../catalog-points/bundled.js';
import { POWER_PLANTS_SNAPSHOT_URL } from './bundledSource.js';
import {
  POWER_PLANTS_META,
  buildPowerPlantCard,
  parsePowerPlantSnapshot,
} from './model.js';

export * from './model.js';
export { POWER_PLANTS_SNAPSHOT_URL } from './bundledSource.js';

/** The bundled snapshot cannot change while the app runs: one load serves the session. */
export const POWER_PLANTS_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

/** Non-hydro power plants from the WRI database, coloured by fuel and sized by capacity. */
export function createPowerPlantsLayer(options = {}) {
  return createCatalogPointsLayer({
    ...options,
    meta: POWER_PLANTS_META,
    maxAgeMs: POWER_PLANTS_MAX_AGE_MS,
    refreshInterval: 24 * 60 * 60_000,
    buildCard: (record) => buildPowerPlantCard(record),
    loadRecords: async ({ fetchImpl, signal }) => {
      const parsed = parsePowerPlantSnapshot(
        await loadBundledJson(POWER_PLANTS_SNAPSHOT_URL, { fetchImpl, signal }),
      );
      if (!parsed) throw new Error('malformed power plant snapshot');
      return parsed;
    },
  });
}
