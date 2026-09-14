import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { clientKey, makeRateLimiter } from './common/rate-limit.js';
import { coalesceProxyRequest, readResponseJsonCapped } from './common/http.js';
import { simplifyGeometry } from './severe-weather/geometry.js';
import {
  NWS_ALERTS_URL,
  normalizeNwsAlerts,
  zoneUrl,
} from './severe-weather/nws.js';
import {
  GDACS_CYCLONES_URL,
  GDACS_EVENTS_URL,
  attachCycloneShapes,
  normalizeGdacsCycloneShapes,
  normalizeGdacsEvents,
} from './severe-weather/gdacs.js';

export const SEVERE_WEATHER_CACHE_DIR = path.join(
  process.cwd(),
  '.gev-cache',
  'severe-weather',
);
export const NWS_TTL_MS = 5 * 60_000;
export const GDACS_TTL_MS = 15 * 60_000;
export const STALE_MAX_MS = 60 * 60_000;
export const ZONE_TTL_MS = 7 * 24 * 60 * 60_000;
export const ZONE_PRUNE_INTERVAL_MS = 60 * 60_000;
export const ZONE_BACKOFF_MS = 60_000;
export const ZONE_MISSING_TTL_MS = 60 * 60_000;
export const ZONE_CONCURRENCY = 4;
export const ZONE_DEADLINE_MS = 30_000;
export const UPSTREAM_TIMEOUT_MS = 20_000;
export const MAX_ALERTS_BYTES = 8 * 1024 * 1024;
export const MAX_ZONE_BYTES = 4 * 1024 * 1024;
export const MAX_GDACS_BYTES = 6 * 1024 * 1024;
const USER_AGENT =
  'CyclopsView/0.1 (+https://github.com/CaptPat/gods-eye-view)';
const UNAVAILABLE_ERROR = 'Severe weather sources unavailable';

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

export function createSevereWeatherHandler({
  fetchImpl = (...args) => fetch(...args),
  cacheDir = SEVERE_WEATHER_CACHE_DIR,
  now = Date.now,
  limiter = makeRateLimiter({ windowMs: 60_000, max: 30, globalMax: 120 }),
  log = (message) => console.warn(message),
  zoneConcurrency = ZONE_CONCURRENCY,
  zoneDeadlineMs = ZONE_DEADLINE_MS,
} = {}) {
  const inFlight = new Map();
  /** zone key → { polygons, fetchedAt } */
  const zoneMemory = new Map();
  const zoneMissingUntil = new Map();
  let zoneBackoffUntil = 0;
  let lastZonePruneAt = Number.NEGATIVE_INFINITY;
  const sources = {
    nws: {
      data: null,
      fetchedAt: null,
      checkedAt: Number.NEGATIVE_INFINITY,
      stale: false,
    },
    gdacs: {
      data: null,
      fetchedAt: null,
      checkedAt: Number.NEGATIVE_INFINITY,
      stale: false,
    },
  };

  async function fetchJson(url, maxBytes, accept) {
    const response = await fetchImpl(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: accept },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!response.ok) {
      void response.body?.cancel?.().catch(() => {});
      throw Object.assign(new Error(`upstream HTTP ${response.status}`), {
        status: response.status,
      });
    }
    return readResponseJsonCapped(response, maxBytes);
  }

  const zoneDir = () => path.join(cacheDir, 'zones');
  const zoneFile = (key) =>
    path.join(zoneDir(), `${key.replace('/', '_')}.json`);

  async function readZoneFromDisk(key) {
    try {
      const info = await stat(zoneFile(key));
      if (now() - info.mtimeMs > ZONE_TTL_MS) return null;
      const polygons = JSON.parse(await readFile(zoneFile(key), 'utf8'));
      return Array.isArray(polygons)
        ? { polygons, fetchedAt: info.mtimeMs }
        : null;
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
      throw error;
    }
  }

  async function fetchZone(key) {
    const zone = await fetchJson(
      zoneUrl(key),
      MAX_ZONE_BYTES,
      'application/geo+json',
    );
    const polygons = simplifyGeometry(zone?.geometry);
    await mkdir(zoneDir(), { recursive: true });
    await writeFile(zoneFile(key), JSON.stringify(polygons));
    return { polygons, fetchedAt: now() };
  }

  /** Memory, then disk, then api.weather.gov at `zoneConcurrency`, until the deadline or a 429/503. */
  async function resolveZones(keys) {
    const deadline = now() + zoneDeadlineMs;
    const queue = [];
    for (const key of keys) {
      const cached = zoneMemory.get(key);
      if (cached && now() - cached.fetchedAt <= ZONE_TTL_MS) continue;
      if ((zoneMissingUntil.get(key) ?? 0) > now()) continue;
      const fromDisk = await readZoneFromDisk(key);
      if (fromDisk) zoneMemory.set(key, fromDisk);
      else queue.push(key);
    }
    const worker = async () => {
      while (queue.length) {
        if (now() >= deadline || zoneBackoffUntil > now()) return;
        const key = queue.shift();
        try {
          zoneMemory.set(key, await fetchZone(key));
        } catch (error) {
          if (error.status === 404)
            zoneMissingUntil.set(key, now() + ZONE_MISSING_TTL_MS);
          if (error.status === 429 || error.status === 503)
            zoneBackoffUntil = now() + ZONE_BACKOFF_MS;
          log(`[severe-weather] zone ${key} failed: ${error.message}`);
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.max(1, zoneConcurrency) }, worker),
    );
  }

  /** At most hourly: forget and delete zone shapes older than ZONE_TTL_MS. */
  async function pruneZones() {
    if (now() - lastZonePruneAt < ZONE_PRUNE_INTERVAL_MS) return;
    lastZonePruneAt = now();
    for (const [key, entry] of zoneMemory) {
      if (now() - entry.fetchedAt > ZONE_TTL_MS) zoneMemory.delete(key);
    }
    let names = [];
    try {
      names = await readdir(zoneDir());
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    await Promise.all(
      names.map(async (name) => {
        const file = path.join(zoneDir(), name);
        try {
          const info = await stat(file);
          if (now() - info.mtimeMs > ZONE_TTL_MS)
            await rm(file, { force: true });
        } catch {
          // Another prune removed it first.
        }
      }),
    );
  }

  async function buildNws() {
    const normalized = normalizeNwsAlerts(
      await fetchJson(NWS_ALERTS_URL, MAX_ALERTS_BYTES, 'application/geo+json'),
    );
    if (!normalized) throw new Error('malformed NWS alerts');
    await resolveZones([
      ...new Set(normalized.alerts.flatMap((alert) => alert.zones)),
    ]);
    await pruneZones();
    const zones = {};
    let unmappedAlerts = 0;
    for (const alert of normalized.alerts) {
      let mapped = Boolean(alert.polygons);
      for (const key of alert.zones) {
        const entry = zoneMemory.get(key);
        if (!entry?.polygons.length) continue;
        zones[key] = entry.polygons;
        mapped = true;
      }
      if (!mapped) unmappedAlerts += 1;
    }
    return {
      updatedAt: normalized.updatedAt,
      alerts: normalized.alerts,
      zones,
      unmappedAlerts,
    };
  }

  async function buildGdacs() {
    const events = normalizeGdacsEvents(
      await fetchJson(GDACS_EVENTS_URL, MAX_GDACS_BYTES, 'application/json'),
    );
    if (!events) throw new Error('malformed GDACS events');
    if (!events.some((event) => event.type === 'TC'))
      return { updatedAt: now(), events };
    try {
      const shapes = normalizeGdacsCycloneShapes(
        await fetchJson(
          GDACS_CYCLONES_URL,
          MAX_GDACS_BYTES,
          'application/json',
        ),
      );
      return { updatedAt: now(), events: attachCycloneShapes(events, shapes) };
    } catch (error) {
      log(`[severe-weather] GDACS cyclone shapes failed: ${error.message}`);
      return { updatedAt: now(), events };
    }
  }

  /** Refresh one source at most once per TTL; keep the last good data as stale for STALE_MAX_MS. */
  async function refresh(name, ttlMs, build) {
    const state = sources[name];
    if (now() - state.checkedAt < ttlMs) return;
    try {
      const { promise } = coalesceProxyRequest(inFlight, name, build);
      state.data = await promise;
      state.fetchedAt = now();
      state.stale = false;
    } catch (error) {
      log(`[severe-weather] ${name} refresh failed: ${error.message}`);
      if (state.data && now() - state.fetchedAt <= STALE_MAX_MS) {
        state.stale = true;
      } else {
        state.data = null;
        state.fetchedAt = null;
        state.stale = false;
      }
    }
    state.checkedAt = now();
  }

  const statusOf = (state) =>
    !state.data ? 'unavailable' : state.stale ? 'stale' : 'ok';

  return async function handle(req, res) {
    try {
      if (req.method !== 'GET')
        return sendJson(res, 405, { error: 'method not allowed' });
      const url = new URL(req.url || '/', 'http://severe-weather.local');
      if (url.pathname !== '/')
        return sendJson(res, 404, { error: 'not found' });
      if (!limiter(clientKey(req))) {
        return sendJson(
          res,
          429,
          { error: 'rate limited' },
          { 'Retry-After': '10' },
        );
      }
      await Promise.all([
        refresh('nws', NWS_TTL_MS, buildNws),
        refresh('gdacs', GDACS_TTL_MS, buildGdacs),
      ]);
      const nws = sources.nws.data
        ? { status: statusOf(sources.nws), ...sources.nws.data }
        : {
            status: 'unavailable',
            updatedAt: null,
            alerts: [],
            zones: {},
            unmappedAlerts: 0,
          };
      const gdacs = sources.gdacs.data
        ? { status: statusOf(sources.gdacs), ...sources.gdacs.data }
        : { status: 'unavailable', updatedAt: null, events: [] };
      if (nws.status === 'unavailable' && gdacs.status === 'unavailable') {
        return sendJson(res, 502, { error: UNAVAILABLE_ERROR });
      }
      return sendJson(res, 200, { generatedAt: now(), nws, gdacs });
    } catch (error) {
      log(`[severe-weather] ${error?.message ?? error}`);
      return sendJson(res, 502, { error: UNAVAILABLE_ERROR });
    }
  };
}

export function severeWeatherProxy(options = {}) {
  const handler = createSevereWeatherHandler(options);
  const install = (server) => {
    server.middlewares.use('/api/severe-weather', handler);
  };
  return {
    name: 'severe-weather-proxy',
    configureServer: install,
    configurePreviewServer: install,
  };
}
