import { googleServerApiKey } from './places/google-key.js';
import { clientKey, makeRateLimiter } from './common/rate-limit.js';
import { coalesceProxyRequest, readResponseTextCapped } from './common/http.js';
import {
  GFS_WINDOW_MS,
  gfsGridUrl,
  gfsValidTime,
  gmgsiCapabilitiesUrl,
  gmgsiTileUrl,
  googleTileUrl,
  googleTimeBucket,
  isGfsTime,
  isGoogleKey,
  isGoogleTime,
  isOverlayKey,
  parseGfsCsv,
  parseGmgsiTimes,
  parseTileCoords,
} from './weather-overlays/sources.js';
import {
  PNG_SIGNATURE,
  renderTemperatureTile,
} from './weather-overlays/render.js';

export const CAPABILITIES_TTL_MS = 10 * 60_000;
export const GRID_TTL_MS = 60 * 60_000;
// Google Pollen policy prohibits caching/storage, and the Air Quality API is
// "subject to caching restrictions" — Google tiles are never cached (Task 4
// amendment). NOAA clouds and temperature stay cached per the plan.
export const GOOGLE_TILE_TTL_MS = 0;
export const CLOUD_TILE_TTL_MS = 3 * 60 * 60_000;
export const TEMPERATURE_TILE_TTL_MS = 60 * 60_000;
export const TILE_CACHE_LIMIT = 1500;
export const PRUNE_INTERVAL_MS = 60_000;
export const UPSTREAM_TIMEOUT_MS = 15_000;
export const GRID_TIMEOUT_MS = 30_000;
// Google tiles are never cached (above), so nothing bounds request volume —
// and therefore billing — except this in-memory, server-wide daily counter.
// It resets at the UTC day boundary and never touches disk; it is a soft
// application-level ceiling, not a substitute for a Google Cloud Console
// per-API daily quota.
export const DEFAULT_GOOGLE_TILE_BUDGET = 25_000;
export const GOOGLE_TILE_BUDGET_REASON =
  'Google overlay tile budget reached for today';
// A source that has never loaded successfully is re-tried at most this often;
// the most recent failure is re-thrown from cache in between. A source that
// has already loaded once keeps its existing TTL/stale-if-held behaviour.
export const FAILURE_COOLDOWN_MS = 60_000;
const CAPABILITIES_MAX_BYTES = 1024 * 1024;
const GRID_MAX_BYTES = 8 * 1024 * 1024;
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

function sendPng(
  res,
  bytes,
  cacheStatus,
  cacheControl = 'private, max-age=600',
) {
  res.writeHead(200, {
    'Content-Type': 'image/png',
    'Cache-Control': cacheControl,
    'X-Overlay-Cache': cacheStatus,
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

/** In-memory tile cache: per-entry age limit, oldest-first eviction, periodic prune. */
export function createTileCache(limit = TILE_CACHE_LIMIT) {
  const entries = new Map();
  return {
    get(key, nowMs) {
      const entry = entries.get(key);
      if (!entry) return null;
      if (nowMs - entry.at > entry.ttlMs) {
        entries.delete(key);
        return null;
      }
      return entry.bytes;
    },
    set(key, bytes, nowMs, ttlMs) {
      entries.delete(key);
      entries.set(key, { bytes, at: nowMs, ttlMs });
      while (entries.size > limit) entries.delete(entries.keys().next().value);
    },
    prune(nowMs) {
      for (const [key, entry] of entries) {
        if (nowMs - entry.at > entry.ttlMs) entries.delete(key);
      }
    },
    size: () => entries.size,
  };
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
  tileCache = createTileCache(),
  googleTileBudget = googleDailyBudgetFromEnv(),
} = {}) {
  const inFlight = new Map();
  const grids = new Map();
  const failures = new Map();
  let capabilities = null;
  let lastPrune = 0;
  let googleBudgetDay = null;
  let googleBudgetUsed = 0;
  const googleKey = () => String(apiKey() || '').trim();

  // Log names only: Google upstream URLs carry the key.
  const logFailure = (label, error) =>
    log(`[weather-overlays] ${label} failed (${error?.name || 'Error'})`);

  // A source that has never loaded successfully is re-tried at most once per
  // FAILURE_COOLDOWN_MS; in between, the most recent failure is re-thrown
  // without a new upstream call. A source that has already loaded once keeps
  // its own TTL/stale-if-held path untouched.
  function coolingDownFailure(key) {
    const entry = failures.get(key);
    if (!entry) return null;
    if (now() - entry.at >= FAILURE_COOLDOWN_MS) {
      failures.delete(key);
      return null;
    }
    return entry.error;
  }
  function recordFailure(key, error) {
    failures.set(key, { at: now(), error });
  }
  function clearFailure(key) {
    failures.delete(key);
  }

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

  async function fetchUpstream(url, timeoutMs = UPSTREAM_TIMEOUT_MS) {
    const response = await fetchImpl(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`upstream HTTP ${response.status}`);
    return response;
  }

  async function cloudTimes() {
    if (capabilities && now() - capabilities.checkedAt < CAPABILITIES_TTL_MS) {
      return capabilities;
    }
    if (!capabilities) {
      const cooling = coolingDownFailure('gmgsi-capabilities');
      if (cooling) throw cooling;
    }
    try {
      const { promise } = coalesceProxyRequest(
        inFlight,
        'gmgsi-capabilities',
        async () =>
          parseGmgsiTimes(
            await readResponseTextCapped(
              await fetchUpstream(gmgsiCapabilitiesUrl()),
              CAPABILITIES_MAX_BYTES,
            ),
          ),
      );
      const times = await promise;
      if (!times.length) throw new Error('no GMGSI times');
      capabilities = { times, checkedAt: now(), stale: false };
      clearFailure('gmgsi-capabilities');
    } catch (error) {
      if (!capabilities) {
        recordFailure('gmgsi-capabilities', error);
        throw error;
      }
      capabilities = { ...capabilities, checkedAt: now(), stale: true };
      logFailure('GMGSI capabilities refresh', error);
    }
    return capabilities;
  }

  async function gridFor(timeMs) {
    const held = grids.get(timeMs);
    if (held && now() - held.fetchedAt < GRID_TTL_MS) {
      return { grid: held.grid, stale: false };
    }
    const failureKey = `gfs:${timeMs}`;
    if (!held) {
      const cooling = coolingDownFailure(failureKey);
      if (cooling) throw cooling;
    }
    try {
      const { promise } = coalesceProxyRequest(
        inFlight,
        failureKey,
        async () => {
          const grid = parseGfsCsv(
            await readResponseTextCapped(
              await fetchUpstream(gfsGridUrl(timeMs), GRID_TIMEOUT_MS),
              GRID_MAX_BYTES,
            ),
          );
          if (!grid) throw new Error('malformed GFS grid');
          return grid;
        },
      );
      const grid = await promise;
      grids.set(timeMs, { grid, fetchedAt: now() });
      for (const time of [...grids.keys()]) {
        if (Math.abs(time - now()) > GFS_WINDOW_MS) grids.delete(time);
      }
      clearFailure(failureKey);
      return { grid, stale: false };
    } catch (error) {
      if (!held) {
        recordFailure(failureKey, error);
        throw error;
      }
      logFailure('GFS grid refresh', error);
      return { grid: held.grid, stale: true };
    }
  }

  function nearestHeldGridTime() {
    const times = [...grids.keys()].sort(
      (a, b) => Math.abs(a - now()) - Math.abs(b - now()),
    );
    return times[0] ?? null;
  }

  function maybePrune() {
    if (now() - lastPrune < PRUNE_INTERVAL_MS) return;
    lastPrune = now();
    tileCache.prune(now());
  }

  async function manifest(key, res) {
    const googleConfigured = Boolean(googleKey());
    const base = { mode: key, googleConfigured };
    if (isGoogleKey(key)) {
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
    try {
      if (key === 'clouds') {
        const { times, stale } = await cloudTimes();
        return sendJson(res, 200, {
          ...base,
          available: true,
          time: times.at(-1),
          stale,
        });
      }
      const time = gfsValidTime(now());
      const { stale } = await gridFor(time);
      return sendJson(res, 200, { ...base, available: true, time, stale });
    } catch (error) {
      logFailure(`${key} manifest`, error);
      const fallback = key === 'temperature' ? nearestHeldGridTime() : null;
      if (fallback !== null) {
        return sendJson(res, 200, {
          ...base,
          available: true,
          time: fallback,
          stale: true,
        });
      }
      return sendJson(res, 502, {
        error: 'upstream unavailable',
        googleConfigured,
      });
    }
  }

  async function sendTile(res, cacheKey, ttlMs, produce, cacheControl) {
    const cacheable = ttlMs > 0;
    if (cacheable) {
      const cached = tileCache.get(cacheKey, now());
      if (cached) return sendPng(res, cached, 'HIT', cacheControl);
    }
    const { promise } = coalesceProxyRequest(
      inFlight,
      `tile:${cacheKey}`,
      produce,
    );
    const bytes = await promise;
    if (cacheable) tileCache.set(cacheKey, bytes, now(), ttlMs);
    return sendPng(res, bytes, 'MISS', cacheControl);
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
    const cacheKey = `${key}/${timeText}/${coords.z}/${coords.x}/${coords.y}`;
    maybePrune();
    if (isGoogleKey(key)) {
      const secret = googleKey();
      if (!secret)
        return sendJson(res, 404, { error: 'overlay not configured' });
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
      // Never cached: the Pollen policy prohibits caching/storage, and Air
      // Quality is subject to caching restrictions (Task 4 amendment).
      return sendTile(
        res,
        cacheKey,
        GOOGLE_TILE_TTL_MS,
        async () => {
          consumeGoogleBudget(now());
          return readPngCapped(
            await fetchUpstream(googleTileUrl(key, coords, secret)),
          );
        },
        'no-store',
      );
    }
    if (key === 'clouds') {
      const { times } = await cloudTimes();
      if (!times.includes(time)) {
        return sendJson(res, 404, { error: 'unknown overlay time' });
      }
      return sendTile(res, cacheKey, CLOUD_TILE_TTL_MS, async () =>
        readPngCapped(await fetchUpstream(gmgsiTileUrl(time, coords))),
      );
    }
    if (!isGfsTime(time, now())) {
      return sendJson(res, 404, { error: 'unknown overlay time' });
    }
    return sendTile(res, cacheKey, TEMPERATURE_TILE_TTL_MS, async () =>
      renderTemperatureTile((await gridFor(time)).grid, coords),
    );
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
