import { clientKey, makeRateLimiter } from './rate-limit.js';
import { coalesceProxyRequest, readResponseJsonCapped } from './http.js';

export const PROVIDER_USER_AGENT =
  'CyclopsView/0.1 (+https://github.com/CaptPat/gods-eye-view)';

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

/**
 * A single GET route over one upstream JSON document: fetched with an
 * identifying User-Agent, normalized, cached for `ttlMs`, and served stale
 * (retried every `retryMs`) when a refresh fails. A cold failure is a 502.
 * The body is `{ generatedAt, stale, ...present(value) }`.
 */
export function createCachedJsonHandler({
  label,
  url,
  ttlMs,
  retryMs,
  timeoutMs = 20_000,
  maxBytes,
  normalize,
  upstreamError = () => null,
  present,
  unavailable,
  fetchImpl = (...args) => fetch(...args),
  now = Date.now,
  limiter = makeRateLimiter({ windowMs: 60_000, max: 30, globalMax: 120 }),
  log = (message) => console.warn(message),
}) {
  const inFlight = new Map();
  /** { value, fetchedAt, checkedAt, stale } */
  let cache = null;

  async function fetchValue() {
    const response = await fetchImpl(url, {
      headers: {
        'User-Agent': PROVIDER_USER_AGENT,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    let json = null;
    try {
      json = await readResponseJsonCapped(response, maxBytes);
    } catch (error) {
      if (response.ok) throw error;
    }
    const message = upstreamError(json);
    if (!response.ok || message)
      throw new Error(message || `HTTP ${response.status}`);
    const value = normalize(json);
    if (value === null || value === undefined)
      throw new Error(`malformed ${label} payload`);
    return value;
  }

  async function load() {
    const maxAge = cache?.stale ? retryMs : ttlMs;
    if (cache && now() - cache.checkedAt < maxAge) return cache;
    try {
      const { promise } = coalesceProxyRequest(inFlight, label, fetchValue);
      const value = await promise;
      cache = { value, fetchedAt: now(), checkedAt: now(), stale: false };
    } catch (error) {
      if (!cache) throw error;
      log(`[${label}] refresh failed: ${error?.message ?? error}`);
      cache = { ...cache, checkedAt: now(), stale: true };
    }
    return cache;
  }

  return async function handle(req, res) {
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
      const path = new URL(req.url || '/', 'http://provider.local').pathname;
      if (path.replace(/\/+$/, '') !== '')
        return sendJson(res, 404, { error: 'not found' });
      const entry = await load();
      return sendJson(res, 200, {
        generatedAt: entry.fetchedAt,
        stale: entry.stale,
        ...present(entry.value),
      });
    } catch (error) {
      log(`[${label}] ${error?.message ?? error}`);
      return sendJson(res, 502, { error: unavailable });
    }
  };
}

/** A Vite plugin mounting `handler` at `route` for dev and preview servers. */
export function cachedJsonPlugin(name, route, handler) {
  const install = (server) => {
    server.middlewares.use(route, handler);
  };
  return {
    name,
    configureServer: install,
    configurePreviewServer: install,
  };
}
