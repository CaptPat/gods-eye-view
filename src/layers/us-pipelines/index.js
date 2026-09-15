import { createCatalogPointsLayer } from '../catalog-points/index.js';
import { loadBundledJson } from '../catalog-points/bundled.js';
import { createCatalogLines } from '../catalog-lines/lines.js';
import { US_PIPELINES_SNAPSHOT_URL } from './bundledSource.js';
import {
  US_PIPELINES_META,
  buildPipelineCard,
  parsePipelineSnapshot,
} from './model.js';

export * from './model.js';
export { US_PIPELINES_SNAPSHOT_URL } from './bundledSource.js';

/** The bundled snapshot cannot change while the app runs: one load serves the session. */
export const US_PIPELINES_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

/** National gas, crude and HGL pipelines (EIA) and in-service offshore oil and gas segments (BSEE), as one ground-draped line batch. */
export function createUsPipelinesLayer(options = {}) {
  return createCatalogPointsLayer({
    createPoints: createCatalogLines,
    ...options,
    meta: US_PIPELINES_META,
    maxAgeMs: US_PIPELINES_MAX_AGE_MS,
    refreshInterval: 24 * 60 * 60_000,
    buildCard: (record) => buildPipelineCard(record),
    loadRecords: async ({ fetchImpl, signal }) => {
      const parsed = parsePipelineSnapshot(
        await loadBundledJson(US_PIPELINES_SNAPSHOT_URL, { fetchImpl, signal }),
      );
      if (!parsed) throw new Error('malformed US pipeline snapshot');
      return parsed;
    },
  });
}
