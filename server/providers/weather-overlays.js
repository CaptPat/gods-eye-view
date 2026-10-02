import { googleServerApiKey } from './places/google-key.js';
import { clientKey, makeRateLimiter } from './common/rate-limit.js';
import { coalesceProxyRequest } from './common/http.js';
import {
  googleTileUrl,
  googleTimeBucket,
  isGoogleTime,
  isOverlayKey,
  parseTileCoords,
} from './weather-overlays/sources.js';

/**
 * Air Quality layer proxy (`/api/weather-overlays`, path kept for share links
 * and installs): Google Air Quality and Pollen heatmap tiles with the server's
 * key. Google Pollen policy prohibits caching/storage, and the Air Quality API
 * is "subject to caching restrictions", so tiles are never cached here or in
 * the browser.
 */
export const UPSTREAM_TIMEOUT_MS = 15_000;
// Google tiles are never cached (above), so nothing bounds request volume —
// and therefore billing — except this in-memory, server-wide daily counter.
// It resets at the UTC day boundary and never touches disk; it is a soft
// application-level ceiling, not a substitute for a Google Cloud Console
// per-API daily quota.
export const DEFAULT_GOOGLE_TILE_BUDGET = 25_000;
export const GOOGLE_TILE_BUDGET_REASON =
  'Google overlay tile budget reached for today';
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const TILE_MAX_BYTES = 2 * 1024 * 1024;
const DAY_MS = 24 * 60 * 60_000;
const USER_AGENT =
  'CyclopsView/0.1 (+https://github.com/CaptPat/gods-eye-view)';

/** `GEV_GOOGLE_OVERLAY_TILES_PER_DAY`, a positive integer; else the default. */
export function googleDailyBudgetFromEnv(
  env = typeof process !== 'undefined' ? process.env : {},
) {
  const raw = Number.parseInt(env?.GEV_GOOGLE_OVERLAY_TILES_PER_DAY ?? '', 10);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_GOOGLE_TILE_BUDGET;
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function sendPng(res, bytes) {
  res.writeHead(200, {
    'Content-Type': 'image/png',
    'Cache-Control': 'no-store',
  });
  res.end(bytes);
}

async function readPngCapped(response) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > TILE_MAX_BYTES) {
    throw new Error('overlay tile too large');
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > TILE_MAX_BYTES) throw new Error('overlay tile too large');
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('overlay tile is not a PNG');
  }
  return bytes;
}

export function createWeatherOverlaysHandler({
  fetchImpl = (...args) => fetch(...args),
  now = Date.now,
  apiKey = googleServerApiKey,
  limiter = makeRateLimiter({ windowMs: 60_000, max: 600, globalMax: 2000 }),
  tileLimiter = makeRateLimiter({
    windowMs: 60_000,
    max: 6000,
    globalMax: 20000,
  }),
  log = (message) => console.warn(message),
  googleTileBudget = googleDailyBudgetFromEnv(),
} = {}) {
  const inFlight = new Map();
  let googleBudgetDay = null;
  let googleBudgetUsed = 0;
  const googleKey = () => String(apiKey() || '').trim();

  // Log names only: Google upstream URLs carry the key.
  const logFailure = (label, error) =>
    log(`[weather-overlays] ${label} failed (${error?.name || 'Error'})`);

  function resetGoogleBudgetIfNewDay(nowMs) {
    const day = Math.floor(nowMs / DAY_MS);
    if (day !== googleBudgetDay) {
      googleBudgetDay = day;
      googleBudgetUsed = 0;
    }
  }
  function googleBudgetExhausted(nowMs) {
    resetGoogleBudgetIfNewDay(nowMs);
    return googleBudgetUsed >= googleTileBudget;
  }
  function consumeGoogleBudget(nowMs) {
    resetGoogleBudgetIfNewDay(nowMs);
    googleBudgetUsed += 1;
  }
  function secondsUntilUtcMidnight(nowMs) {
    const nextMidnight = (Math.floor(nowMs / DAY_MS) + 1) * DAY_MS;
    return Math.max(1, Math.ceil((nextMidnight - nowMs) / 1000));
  }

  async function fetchUpstream(url) {
    const response = await fetchImpl(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`upstream HTTP ${response.status}`);
    return response;
  }

  function manifest(key, res) {
    const googleConfigured = Boolean(googleKey());
    const base = { mode: key, googleConfigured };
    if (!googleConfigured) {
      return sendJson(res, 200, {
        ...base,
        available: false,
        reason: 'not-configured',
        time: null,
        stale: false,
      });
    }
    if (googleBudgetExhausted(now())) {
      return sendJson(res, 200, {
        ...base,
        available: false,
        reason: GOOGLE_TILE_BUDGET_REASON,
        time: null,
        stale: false,
      });
    }
    return sendJson(res, 200, {
      ...base,
      available: true,
      time: googleTimeBucket(now()),
      stale: false,
    });
  }

  async function tile(parts, res) {
    const [, key, timeText, z, x, file] = parts;
    if (!isOverlayKey(key))
      return sendJson(res, 400, { error: 'unknown overlay' });
    const coords = file.endsWith('.png')
      ? parseTileCoords(key, z, x, file.slice(0, -4))
      : null;
    if (!coords)
      return sendJson(res, 400, { error: 'invalid tile coordinates' });
    const time = /^\d+$/.test(timeText) ? Number(timeText) : Number.NaN;
    const secret = googleKey();
    if (!secret) return sendJson(res, 404, { error: 'overlay not configured' });
    if (!isGoogleTime(time, now())) {
      return sendJson(res, 404, { error: 'unknown overlay time' });
    }
    if (googleBudgetExhausted(now())) {
      return sendJson(
        res,
        429,
        { error: 'google tile budget reached' },
        { 'Retry-After': String(secondsUntilUtcMidnight(now())) },
      );
    }
    // Concurrent requests for one tile share a single upstream fetch.
    const { promise } = coalesceProxyRequest(
      inFlight,
      `tile:${key}/${timeText}/${coords.z}/${coords.x}/${coords.y}`,
      async () => {
        consumeGoogleBudget(now());
        return readPngCapped(
          await fetchUpstream(googleTileUrl(key, coords, secret)),
        );
      },
    );
    return sendPng(res, await promise);
  }

  return async function handle(req, res) {
    try {
      if (req.method !== 'GET') {
        return sendJson(res, 405, { error: 'method not allowed' });
      }
      const url = new URL(req.url || '/', 'http://weather-overlays.local');
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length === 1 && parts[0] === 'manifest') {
        if (!limiter(clientKey(req))) {
          return sendJson(
            res,
            429,
            { error: 'rate limited' },
            { 'Retry-After': '10' },
          );
        }
        const key = url.searchParams.get('mode');
        if (!isOverlayKey(key))
          return sendJson(res, 400, { error: 'unknown overlay' });
        return await manifest(key, res);
      }
      if (parts.length === 6 && parts[0] === 'tiles') {
        if (!tileLimiter(clientKey(req))) {
          return sendJson(
            res,
            429,
            { error: 'rate limited' },
            { 'Retry-After': '10' },
          );
        }
        return await tile(parts, res);
      }
      return sendJson(res, 404, { error: 'not found' });
    } catch (error) {
      logFailure('request', error);
      return sendJson(res, 502, { error: 'upstream unavailable' });
    }
  };
}

export function weatherOverlaysProxy(options = {}) {
  const handler = createWeatherOverlaysHandler(options);
  const install = (server) => {
    server.middlewares.use('/api/weather-overlays', handler);
  };
  return {
    name: 'weather-overlays-proxy',
    configureServer: install,
    configurePreviewServer: install,
  };
}
