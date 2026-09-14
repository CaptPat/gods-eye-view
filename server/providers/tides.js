import { clientKey, makeRateLimiter } from './common/rate-limit.js';
import { coalesceProxyRequest, readResponseJsonCapped } from './common/http.js';
import {
  STATION_TYPES,
  currentsUrl,
  hiloUrl,
  latestPredictionUrl,
  normalizeCurrentStations,
  normalizeCurrents,
  normalizeHilo,
  normalizeTideStations,
  normalizeWaterLevel,
  predictionAt,
  stationListUrl,
  upstreamError,
  waterLevelUrl,
} from './tides/normalize.js';

export const STATIONS_TTL_MS = 24 * 60 * 60_000;
export const STATIONS_RETRY_MS = 10 * 60_000;
export const REPORT_TTL_MS = 10 * 60_000;
export const REPORT_CACHE_LIMIT = 500;
export const UPSTREAM_TIMEOUT_MS = 15_000;
const MAX_STATION_LIST_BYTES = 8 * 1024 * 1024;
const MAX_DATA_BYTES = 256 * 1024;
const USER_AGENT =
  'CyclopsView/0.1 (+https://github.com/CaptPat/gods-eye-view)';
const UNAVAILABLE = 'NOAA CO-OPS unavailable';

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

export function createTidesHandler({
  fetchImpl = (...args) => fetch(...args),
  now = Date.now,
  limiter = makeRateLimiter({ windowMs: 60_000, max: 60, globalMax: 240 }),
  log = (message) => console.warn(message),
  reportCacheLimit = REPORT_CACHE_LIMIT,
} = {}) {
  const inFlight = new Map();
  /** kind → { stations, byId, fetchedAt, checkedAt, stale } */
  const lists = new Map();
  /** cache key → { body, storedAt } */
  const reports = new Map();

  async function getJson(url, maxBytes) {
    const response = await fetchImpl(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    let json = null;
    try {
      json = await readResponseJsonCapped(response, maxBytes);
    } catch (error) {
      if (response.ok) throw error;
    }
    const message = upstreamError(json);
    if (!response.ok || message) {
      throw new Error(message || `HTTP ${response.status}`);
    }
    return json;
  }

  async function loadList(kind) {
    const cached = lists.get(kind);
    const maxAge = cached?.stale ? STATIONS_RETRY_MS : STATIONS_TTL_MS;
    if (cached && now() - cached.checkedAt < maxAge) return cached;
    try {
      const { promise } = coalesceProxyRequest(
        inFlight,
        `list:${kind}`,
        async () => {
          const json = await getJson(
            stationListUrl(kind),
            MAX_STATION_LIST_BYTES,
          );
          const stations =
            kind === 'tide'
              ? normalizeTideStations(json)
              : normalizeCurrentStations(
                  json,
                  (await loadList('tide')).stations,
                );
          if (!stations?.length) throw new Error(`empty ${kind} station list`);
          return stations;
        },
      );
      const stations = await promise;
      const entry = {
        stations,
        byId: new Map(stations.map((station) => [station.id, station])),
        fetchedAt: now(),
        checkedAt: now(),
        stale: false,
      };
      lists.set(kind, entry);
      return entry;
    } catch (error) {
      if (!cached) throw error;
      log(`[tides] ${kind} station list refresh failed: ${error.message}`);
      const stale = { ...cached, checkedAt: now(), stale: true };
      lists.set(kind, stale);
      return stale;
    }
  }

  function readReport(key) {
    const hit = reports.get(key);
    if (!hit) return null;
    if (now() - hit.storedAt >= REPORT_TTL_MS) {
      reports.delete(key);
      return null;
    }
    return hit.body;
  }

  function storeReport(key, body) {
    reports.delete(key);
    reports.set(key, { body, storedAt: now() });
    const cutoff = now() - REPORT_TTL_MS;
    for (const [entryKey, entry] of reports) {
      if (entry.storedAt <= cutoff) reports.delete(entryKey);
    }
    while (reports.size > reportCacheLimit) {
      reports.delete(reports.keys().next().value);
    }
  }

  async function attempt(label, task) {
    try {
      return { ok: true, value: await task() };
    } catch (error) {
      log(`[tides] ${label}: ${error?.message ?? error}`);
      return { ok: false, value: null };
    }
  }

  async function tideReport(station) {
    const generatedAt = now();
    const observe = (datum) =>
      attempt(`${station.id} water level`, async () => {
        const level = normalizeWaterLevel(
          await getJson(waterLevelUrl(station.id, datum), MAX_DATA_BYTES),
        );
        if (!level) throw new Error('malformed water level');
        return level;
      });
    if (station.greatLakes) {
      const level = await observe('IGLD');
      return {
        id: station.id,
        kind: 'tide',
        datum: 'IGLD',
        generatedAt,
        sources: {
          predictions: 'none',
          observed: level.ok ? 'ok' : 'unavailable',
        },
        predictions: null,
        observed: level.ok ? { ...level.value, predictedM: null } : null,
      };
    }
    const [hilo, level, latest] = await Promise.all([
      attempt(`${station.id} predictions`, async () => {
        const list = normalizeHilo(
          await getJson(hiloUrl(station.id, generatedAt), MAX_DATA_BYTES),
        );
        if (!list) throw new Error('malformed predictions');
        return list;
      }),
      observe('MLLW'),
      attempt(`${station.id} latest prediction`, () =>
        getJson(latestPredictionUrl(station.id), MAX_DATA_BYTES),
      ),
    ]);
    return {
      id: station.id,
      kind: 'tide',
      datum: 'MLLW',
      generatedAt,
      sources: {
        predictions: hilo.ok ? 'ok' : 'unavailable',
        observed: level.ok ? 'ok' : 'unavailable',
      },
      predictions: hilo.ok ? hilo.value : null,
      observed: level.ok
        ? {
            ...level.value,
            predictedM: latest.ok
              ? predictionAt(latest.value, level.value.time)
              : null,
          }
        : null,
    };
  }

  async function currentReport(station, bin) {
    const generatedAt = now();
    const result = await attempt(
      `${station.id} bin ${bin} currents`,
      async () => {
        const parsed = normalizeCurrents(
          await getJson(
            currentsUrl(station.id, bin, generatedAt),
            MAX_DATA_BYTES,
          ),
        );
        if (!parsed) throw new Error('malformed currents');
        return parsed;
      },
    );
    return {
      id: station.id,
      kind: 'current',
      bin,
      generatedAt,
      sources: { predictions: result.ok ? 'ok' : 'unavailable' },
      depthM: result.value?.depthM ?? null,
      floodDirDeg: result.value?.floodDirDeg ?? null,
      ebbDirDeg: result.value?.ebbDirDeg ?? null,
      events: result.value?.events ?? null,
    };
  }

  async function serveReport(res, key, build) {
    const cached = readReport(key);
    if (cached) return sendJson(res, 200, cached);
    const { promise } = coalesceProxyRequest(inFlight, key, build);
    const body = await promise;
    const states = Object.values(body.sources);
    if (!states.includes('ok'))
      return sendJson(res, 502, { error: UNAVAILABLE });
    // Partial reports are served but never cached, so a transient failure is retried next click.
    if (!states.includes('unavailable')) storeReport(key, body);
    return sendJson(res, 200, body);
  }

  async function route(url, res) {
    const path = url.pathname.replace(/\/+$/, '');
    if (path === '/stations') {
      const kind = url.searchParams.get('kind');
      if (!Object.hasOwn(STATION_TYPES, kind)) {
        return sendJson(res, 400, { error: 'kind must be tide or current' });
      }
      const list = await loadList(kind);
      return sendJson(res, 200, {
        kind,
        stations: list.stations,
        generatedAt: list.fetchedAt,
        stale: list.stale,
      });
    }
    if (path !== '/tide' && path !== '/current') {
      return sendJson(res, 404, { error: 'not found' });
    }
    const kind = path.slice(1);
    const list = await loadList(kind);
    const station = list.byId.get(String(url.searchParams.get('id') ?? ''));
    if (!station) return sendJson(res, 404, { error: 'unknown station' });
    if (kind === 'tide') {
      return serveReport(res, `tide:${station.id}`, () => tideReport(station));
    }
    const binText = url.searchParams.get('bin');
    const bin =
      binText === null
        ? station.bins[0]
        : /^\d{1,3}$/.test(binText)
          ? Number(binText)
          : Number.NaN;
    if (!station.bins.includes(bin)) {
      return sendJson(res, 400, {
        error: 'bin is not offered by this station',
      });
    }
    return serveReport(res, `current:${station.id}:${bin}`, () =>
      currentReport(station, bin),
    );
  }

  async function handle(req, res) {
    try {
      if (req.method !== 'GET')
        return sendJson(res, 405, { error: 'method not allowed' });
      if (!limiter(clientKey(req))) {
        return sendJson(
          res,
          429,
          { error: 'rate limited' },
          { 'Retry-After': '10' },
        );
      }
      return await route(new URL(req.url || '/', 'http://tides.local'), res);
    } catch (error) {
      log(`[tides] ${error?.message ?? error}`);
      return sendJson(res, 502, { error: UNAVAILABLE });
    }
  }

  handle.cacheSizes = () => ({ lists: lists.size, reports: reports.size });
  return handle;
}

export function tidesProxy(options = {}) {
  const handler = createTidesHandler(options);
  const install = (server) => {
    server.middlewares.use('/api/tides', handler);
  };
  return {
    name: 'tides-proxy',
    configureServer: install,
    configurePreviewServer: install,
  };
}
