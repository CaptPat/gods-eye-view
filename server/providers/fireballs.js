import {
  cachedJsonPlugin,
  createCachedJsonHandler,
} from './common/cachedJson.js';
import {
  fireballsUrl,
  normalizeFireballs,
  upstreamError,
} from './fireballs/normalize.js';

/** CNEOS adds a handful of events a week: six hours is plenty fresh. */
export const FIREBALLS_TTL_MS = 6 * 60 * 60_000;
/** After a failed refresh the last list is served stale and retried this often. */
export const FIREBALLS_RETRY_MS = 10 * 60_000;
export const UPSTREAM_TIMEOUT_MS = 20_000;
const MAX_LIST_BYTES = 4 * 1024 * 1024;

/** GET /api/fireballs → `{ generatedAt, stale, fireballs }`. */
export function createFireballsHandler(options = {}) {
  return createCachedJsonHandler({
    label: 'fireballs',
    url: fireballsUrl(),
    ttlMs: FIREBALLS_TTL_MS,
    retryMs: FIREBALLS_RETRY_MS,
    timeoutMs: UPSTREAM_TIMEOUT_MS,
    maxBytes: MAX_LIST_BYTES,
    normalize: normalizeFireballs,
    upstreamError,
    present: (fireballs) => ({ fireballs }),
    unavailable: 'NASA/JPL fireball data unavailable',
    ...options,
  });
}

export function fireballsProxy(options = {}) {
  return cachedJsonPlugin(
    'fireballs-proxy',
    '/api/fireballs',
    createFireballsHandler(options),
  );
}
