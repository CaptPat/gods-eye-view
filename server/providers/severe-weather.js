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
export const RESPONSE_BUDGET_MS = 25_000;
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
  responseBudgetMs = RESPONSE_BUDGET_MS,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
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

  async function fetchJson(url, maxBytes, accept, extraSignal) {
    const signal = extraSignal
      ? AbortSignal.any([AbortSignal.timeout(UPSTREAM_TIMEOUT_MS), extraSignal])
      : AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
    const response = await fetchImpl(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: accept },
      signal,
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
      // A missing or malformed shape is an ordinary cache miss. Anything else
      // (EPERM, EISDIR, a bad mount) is one bad disk entry, not a reason to
      // fail the whole NWS refresh: log it and refetch instead.
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) {
        log(`[severe-weather] zone ${key} disk read failed: ${error.name}`);
      }
      return null;
    }
  }

  async function fetchZone(key, deadlineSignal) {
    const zone = await fetchJson(
      zoneUrl(key),
      MAX_ZONE_BYTES,
      'application/geo+json',
      deadlineSignal,
    );
    const polygons = simplifyGeometry(zone?.geometry);
    await mkdir(zoneDir(), { recursive: true });
    await writeFile(zoneFile(key), JSON.stringify(polygons));
    return { polygons, fetchedAt: now() };
  }

  /** Memory, then disk, then api.weather.gov at `zoneConcurrency`, until the deadline or a 429/503. */
  async function resolveZones(keys) {
    const deadline = now() + zoneDeadlineMs;
    // Loop-start checks above use the injected clock (deterministic in
    // tests); this real timer is what actually aborts fetches already in
    // flight when wall-clock time runs out, since `now()` alone never
    // advances on its own while an upstream request is pending.
    const deadlineController = new AbortController();
    const deadlineTimer = setTimeout(
      () => deadlineController.abort(),
      zoneDeadlineMs,
    );
    try {
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
          if (
            now() >= deadline ||
            zoneBackoffUntil > now() ||
            deadlineController.signal.aborted
          )
            return;
          const key = queue.shift();
          try {
            zoneMemory.set(
              key,
              await fetchZone(key, deadlineController.signal),
            );
          } catch (error) {
            if (error.name === 'AbortError') {
              // The deadline aborted this fetch: not a 404, not cached, and
              // it stays unmapped for this round.
              log(`[severe-weather] zone ${key} aborted at the deadline`);
              continue;
            }
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
    } finally {
      clearTimeout(deadlineTimer);
    }
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
      // A prune failure never fails the build; ENOENT just means no cache yet.
      if (error.code !== 'ENOENT') {
        log(`[severe-weather] zone prune readdir failed: ${error.name}`);
      }
      return;
    }
    await Promise.all(
      names.map(async (name) => {
        const file = path.join(zoneDir(), name);
        try {
          const info = await stat(file);
          if (now() - info.mtimeMs > ZONE_TTL_MS)
            await rm(file, { force: true });
        } catch (error) {
          // ENOENT: another prune removed it first. Anything else is logged,
          // never thrown: a prune failure never fails the build.
          if (error.code !== 'ENOENT') {
            log(
              `[severe-weather] zone prune failed for ${name}: ${error.name}`,
            );
          }
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

  /** name → promise that resolves once that source's in-flight refresh has settled into `sources`. */
  const refreshing = new Map();

  /**
   * Start a refresh at most once per TTL, and never a second concurrent one
   * for the same source. Returns null when no refresh is due right now
   * (nothing to wait for); otherwise the settle promise, which callers may
   * await or leave running in the background — either way it updates
   * `sources[name]` exactly once when the build resolves or rejects.
   */
  function ensureRefresh(name, ttlMs, build) {
    const state = sources[name];
    if (now() - state.checkedAt < ttlMs) return null;
    const existing = refreshing.get(name);
    if (existing) return existing;
    const { promise } = coalesceProxyRequest(inFlight, name, build);
    const settle = promise
      .then(
        (data) => {
          state.data = data;
          state.fetchedAt = now();
          state.stale = false;
        },
        (error) => {
          log(`[severe-weather] ${name} refresh failed: ${error.message}`);
          if (state.data && now() - state.fetchedAt <= STALE_MAX_MS) {
            state.stale = true;
          } else {
            state.data = null;
            state.fetchedAt = null;
            state.stale = false;
          }
        },
      )
      .finally(() => {
        state.checkedAt = now();
        refreshing.delete(name);
      });
    refreshing.set(name, settle);
    return settle;
  }

  /** Data younger than STALE_MAX_MS since its last success can be served (fresh or stale). */
  const isServable = (state) =>
    Boolean(state.data) && now() - state.fetchedAt <= STALE_MAX_MS;

  const statusOf = (state) => {
    if (!isServable(state)) return 'unavailable';
    return state.stale ? 'stale' : 'ok';
  };

  /** A cancellable timer: { promise, cancel }. `cancel()` is always safe to
   *  call, including after the timer already fired. */
  function delay(ms) {
    let timer;
    const promise = new Promise((resolve) => {
      timer = setTimeoutImpl(resolve, ms);
    });
    return { promise, cancel: () => clearTimeoutImpl(timer) };
  }

  function sourceView(state, emptyShape) {
    const status = statusOf(state);
    return status === 'unavailable'
      ? { status, ...emptyShape }
      : { status, ...state.data };
  }

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
      // A source that already has servable data answers immediately; its due
      // refresh (if any) keeps running in the background. A source with
      // nothing servable is awaited, capped by the response budget so one
      // slow or unreachable source never delays the other.
      //
      // The budget only ever cuts the wait short when *something* is already
      // servable by the time it elapses (e.g. the other source answered).
      // If nothing is servable yet when the budget elapses — a first enable
      // with a cold NWS build racing a hung GDACS, say — giving up would
      // wrongly turn "still building" into a 502. Instead we keep awaiting
      // the still-pending sources one at a time (each already bounded by its
      // own upstream timeout / zone deadline) until one becomes servable or
      // every awaited source has settled.
      const nwsRefresh = ensureRefresh('nws', NWS_TTL_MS, buildNws);
      const gdacsRefresh = ensureRefresh('gdacs', GDACS_TTL_MS, buildGdacs);
      const pending = [];
      if (!isServable(sources.nws) && nwsRefresh) pending.push(nwsRefresh);
      if (!isServable(sources.gdacs) && gdacsRefresh)
        pending.push(gdacsRefresh);
      if (pending.length) {
        const trackers = pending.map((promise) => {
          const tracker = { settled: false, tracked: null };
          tracker.tracked = promise.then(() => {
            tracker.settled = true;
          });
          return tracker;
        });
        const budget = delay(responseBudgetMs);
        try {
          await Promise.race([
            Promise.all(trackers.map((t) => t.tracked)),
            budget.promise,
          ]);
          while (!isServable(sources.nws) && !isServable(sources.gdacs)) {
            const unsettled = trackers.filter((t) => !t.settled);
            if (!unsettled.length) break;
            await Promise.race(unsettled.map((t) => t.tracked));
          }
        } finally {
          budget.cancel();
        }
      }
      const nws = sourceView(sources.nws, {
        updatedAt: null,
        alerts: [],
        zones: {},
        unmappedAlerts: 0,
      });
      const gdacs = sourceView(sources.gdacs, {
        updatedAt: null,
        events: [],
      });
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
