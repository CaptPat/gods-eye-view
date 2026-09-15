import { clientKey, makeRateLimiter } from './common/rate-limit.js';
import { coalesceProxyRequest, readResponseJsonCapped } from './common/http.js';
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
const USER_AGENT =
  'CyclopsView/0.1 (+https://github.com/CaptPat/gods-eye-view)';
const UNAVAILABLE = 'NASA/JPL fireball data unavailable';

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

/** GET /api/fireballs → `{ generatedAt, stale, fireballs }`. */
export function createFireballsHandler({
  fetchImpl = (...args) => fetch(...args),
  now = Date.now,
  limiter = makeRateLimiter({ windowMs: 60_000, max: 30, globalMax: 120 }),
  log = (message) => console.warn(message),
} = {}) {
  const inFlight = new Map();
  /** { fireballs, fetchedAt, checkedAt, stale } */
  let cache = null;

  async function fetchList() {
    const response = await fetchImpl(fireballsUrl(), {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    let json = null;
    try {
      json = await readResponseJsonCapped(response, MAX_LIST_BYTES);
    } catch (error) {
      if (response.ok) throw error;
    }
    const message = upstreamError(json);
    if (!response.ok || message)
      throw new Error(message || `HTTP ${response.status}`);
    const fireballs = normalizeFireballs(json);
    if (!fireballs) throw new Error('malformed fireball list');
    return fireballs;
  }

  async function load() {
    const maxAge = cache?.stale ? FIREBALLS_RETRY_MS : FIREBALLS_TTL_MS;
    if (cache && now() - cache.checkedAt < maxAge) return cache;
    try {
      const { promise } = coalesceProxyRequest(inFlight, 'list', fetchList);
      const fireballs = await promise;
      cache = { fireballs, fetchedAt: now(), checkedAt: now(), stale: false };
    } catch (error) {
      if (!cache) throw error;
      log(`[fireballs] refresh failed: ${error?.message ?? error}`);
      cache = { ...cache, checkedAt: now(), stale: true };
    }
    return cache;
  }

  async function handle(req, res) {
    try {
      if (req.method !== 'GET')
        return sendJson(res, 405, { error: 'method not allowed' });
      if (!limiter(clientKey(req)))
        return sendJson(
          res,
          429,
          { error: 'rate limited' },
          { 'Retry-After': '10' },
        );
      const url = new URL(req.url || '/', 'http://fireballs.local');
      if (url.pathname.replace(/\/+$/, '') !== '')
        return sendJson(res, 404, { error: 'not found' });
      const entry = await load();
      return sendJson(res, 200, {
        generatedAt: entry.fetchedAt,
        stale: entry.stale,
        fireballs: entry.fireballs,
      });
    } catch (error) {
      log(`[fireballs] ${error?.message ?? error}`);
      return sendJson(res, 502, { error: UNAVAILABLE });
    }
  }

  return handle;
}

export function fireballsProxy(options = {}) {
  const handler = createFireballsHandler(options);
  const install = (server) => {
    server.middlewares.use('/api/fireballs', handler);
  };
  return {
    name: 'fireballs-proxy',
    configureServer: install,
    configurePreviewServer: install,
  };
}
