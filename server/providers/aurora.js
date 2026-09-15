import {
  cachedJsonPlugin,
  createCachedJsonHandler,
} from './common/cachedJson.js';
import { OVATION_URL, normalizeOvation } from './aurora/normalize.js';

/** SWPC refreshes OVATION every few minutes and marks it max-age=60. */
export const AURORA_TTL_MS = 5 * 60_000;
export const AURORA_RETRY_MS = 60_000;
const MAX_BYTES = 4 * 1024 * 1024;

/** GET /api/aurora → `{ generatedAt, stale, observationTime, forecastTime, maxProbability, bands }`. */
export function createAuroraHandler(options = {}) {
  return createCachedJsonHandler({
    label: 'aurora',
    url: OVATION_URL,
    ttlMs: AURORA_TTL_MS,
    retryMs: AURORA_RETRY_MS,
    maxBytes: MAX_BYTES,
    normalize: normalizeOvation,
    present: (forecast) => forecast,
    unavailable: 'NOAA SWPC aurora forecast unavailable',
    ...options,
  });
}

export function auroraProxy(options = {}) {
  return cachedJsonPlugin(
    'aurora-proxy',
    '/api/aurora',
    createAuroraHandler(options),
  );
}
