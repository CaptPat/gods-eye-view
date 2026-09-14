import { googleServerApiKey } from './places/google-key.js';
import { fetchRegionalPlace } from './regional/place.js';
import { clientKey, makeRateLimiter } from './common/rate-limit.js';
import { coalesceProxyRequest, readResponseJsonCapped } from './common/http.js';
import {
  googleCurrentUrl,
  googleDailyUrl,
  googleHourlyUrl,
  googleTimeZone,
  isOpenMeteoPayload,
  marineUrl,
  normalizeGoogleDaily,
  normalizeGoogleHourly,
  normalizeGoogleNow,
  normalizeMarine,
  normalizeSolar,
  parseReportQuery,
  reportCacheKey,
  solarUrl,
} from './weather-report/normalize.js';

export const REQUEST_TIMEOUT_MS = 10_000;
export const REPORT_TIMEOUT_MS = 15_000;
export const FRESH_MS = 10 * 60_000;
export const STALE_MAX_MS = 60 * 60_000;
export const CACHE_LIMIT = 500;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const USER_AGENT =
  'CyclopsView/0.1 (+https://github.com/CaptPat/gods-eye-view)';
const TIMED_OUT = Symbol('timed out');

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

const usable = (report) =>
  ['google', 'openMeteoMarine', 'openMeteoSolar'].some(
    (name) => report.sources[name] === 'ok',
  );

export function createWeatherReportHandler({
  fetchImpl = (...args) => fetch(...args),
  now = Date.now,
  apiKey = googleServerApiKey,
  fetchPlace = fetchRegionalPlace,
  limiter = makeRateLimiter({ windowMs: 60_000, max: 20, globalMax: 60 }),
  log = (message) => console.warn(message),
  requestTimeoutMs = REQUEST_TIMEOUT_MS,
  reportTimeoutMs = REPORT_TIMEOUT_MS,
  cacheLimit = CACHE_LIMIT,
} = {}) {
  const cache = new Map();
  const inFlight = new Map();

  async function getJson(url, signal) {
    const response = await fetchImpl(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(requestTimeoutMs)]),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return readResponseJsonCapped(response, MAX_RESPONSE_BYTES);
  }

  async function buildReport(point) {
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(TIMED_OUT);
      }, reportTimeoutMs);
    });
    // Log source names only: upstream URLs carry the Google key.
    const attempt = async (label, task) => {
      const running = task();
      running.catch(() => {});
      try {
        const value = await Promise.race([running, deadline]);
        if (value === TIMED_OUT) throw new Error('report deadline');
        return { ok: true, value };
      } catch (error) {
        log(
          `[weather-report] ${label} unavailable (${error?.name || 'Error'})`,
        );
        return { ok: false, value: null };
      }
    };

    const key = String(apiKey() || '').trim();
    const signal = controller.signal;
    const [google, marine, solar, place] = await Promise.all([
      key
        ? attempt('google', async () => {
            const [current, firstPage, daily] = await Promise.all([
              getJson(googleCurrentUrl(point, key), signal),
              getJson(googleHourlyUrl(point, key), signal),
              getJson(googleDailyUrl(point, key), signal),
            ]);
            const pages = [firstPage];
            if (firstPage?.nextPageToken) {
              pages.push(
                await getJson(
                  googleHourlyUrl(point, key, firstPage.nextPageToken),
                  signal,
                ),
              );
            }
            const nowSection = normalizeGoogleNow(current);
            if (!nowSection || nowSection.temperatureC === null)
              throw new Error('malformed');
            return {
              now: nowSection,
              hourly: normalizeGoogleHourly(pages),
              daily: normalizeGoogleDaily(daily),
              timeZone: googleTimeZone(current) ?? googleTimeZone(daily),
            };
          })
        : Promise.resolve(null),
      attempt('open-meteo marine', async () => {
        const json = await getJson(marineUrl(point), signal);
        if (!isOpenMeteoPayload(json)) throw new Error('malformed');
        return normalizeMarine(json);
      }),
      attempt('open-meteo solar', async () => {
        const json = await getJson(solarUrl(point), signal);
        if (!isOpenMeteoPayload(json)) throw new Error('malformed');
        return normalizeSolar(json);
      }),
      attempt('place', async () => {
        const result = await fetchPlace({
          latitude: point.lat,
          longitude: point.lon,
        });
        return result?.label ?? null;
      }),
    ]);
    clearTimeout(timer);
    const status = (result) => (result?.ok ? 'ok' : 'unavailable');
    return {
      point,
      place: place.value,
      timeZone: google?.ok ? google.value.timeZone : null,
      generatedAt: now(),
      stale: false,
      sources: {
        google: key ? status(google) : 'not-configured',
        openMeteoMarine: status(marine),
        openMeteoSolar: status(solar),
        place: status(place),
      },
      now: google?.ok ? google.value.now : null,
      hourly: google?.ok ? google.value.hourly : null,
      daily: google?.ok ? google.value.daily : null,
      marine: marine.ok ? marine.value : null,
      solar: solar.ok ? solar.value : null,
    };
  }

  function remember(cacheKey, report) {
    cache.delete(cacheKey);
    cache.set(cacheKey, report);
    while (cache.size > cacheLimit) cache.delete(cache.keys().next().value);
  }

  async function respond(point, res) {
    const cacheKey = reportCacheKey(point);
    const cached = cache.get(cacheKey);
    if (cached && now() - cached.generatedAt < FRESH_MS)
      return sendJson(res, 200, cached);
    const { promise } = coalesceProxyRequest(inFlight, cacheKey, () =>
      buildReport(point),
    );
    const report = await promise;
    if (usable(report)) {
      remember(cacheKey, report);
      return sendJson(res, 200, report);
    }
    if (cached && now() - cached.generatedAt <= STALE_MAX_MS) {
      return sendJson(res, 200, { ...cached, stale: true });
    }
    return sendJson(res, 502, { error: 'Weather sources unavailable' });
  }

  return async function handle(req, res) {
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
      const url = new URL(req.url || '/', 'http://weather-report.local');
      const point = parseReportQuery(url.searchParams);
      if (point.error) return sendJson(res, 400, { error: point.error });
      return await respond(point, res);
    } catch (error) {
      log(`[weather-report] request failed (${error?.name || 'Error'})`);
      return sendJson(res, 502, { error: 'Weather sources unavailable' });
    }
  };
}

export function weatherReportProxy(options = {}) {
  const handler = createWeatherReportHandler(options);
  const install = (server) => {
    server.middlewares.use('/api/weather-report', handler);
  };
  return {
    name: 'weather-report-proxy',
    configureServer: install,
    configurePreviewServer: install,
  };
}
