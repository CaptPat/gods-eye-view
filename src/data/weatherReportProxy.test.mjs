import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import createViteConfig from '../../vite.config.js';
import {
  FRESH_MS,
  STALE_MAX_MS,
  createWeatherReportHandler,
} from '../../server/providers/weather-report.js';

const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`./fixtures/weather-report/${name}`, import.meta.url),
      'utf8',
    ),
  );
const T0 = Date.UTC(2026, 8, 14, 12, 10);
const MIN = 60_000;
const fail = () => new Response('busy', { status: 503 });

function invoke(handler, url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = {
      method,
      url,
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
    };
    const res = {
      writeHead(status, headers) {
        this.status = status;
        this.headers = headers || {};
      },
      end(body) {
        const text = Buffer.isBuffer(body)
          ? body.toString('utf8')
          : String(body || '');
        resolve({
          status: this.status,
          headers: this.headers,
          text,
          json: () => JSON.parse(text),
        });
      },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

/** Routes match by URL substring; a function answer receives the URL and may return a Response. */
function harness(overrides = {}, routeOverrides = {}) {
  const calls = [];
  const routes = {
    'currentConditions:lookup': () => fixture('google-current.json'),
    'forecast/hours:lookup': (href) =>
      fixture(
        href.includes('pageToken=fixture-page-2')
          ? 'google-hourly-page2.json'
          : 'google-hourly-page1.json',
      ),
    'forecast/days:lookup': () => fixture('google-daily.json'),
    'marine-api.open-meteo.com': () =>
      fixture('open-meteo-marine-coastal.json'),
    'api.open-meteo.com/v1/forecast': () => fixture('open-meteo-solar.json'),
    ...routeOverrides,
  };
  const fetchImpl = async (url, options = {}) => {
    const href = String(url);
    calls.push({ href, options });
    for (const [match, answer] of Object.entries(routes)) {
      if (!href.includes(match)) continue;
      const value = await answer(href, options);
      return value instanceof Response ? value : Response.json(value);
    }
    throw new Error('unexpected upstream');
  };
  const clock = { now: T0 };
  const handler = createWeatherReportHandler({
    fetchImpl,
    now: () => clock.now,
    apiKey: () => 'TEST-KEY',
    fetchPlace: async () => ({ label: 'Galveston, Texas' }),
    limiter: () => true,
    log: () => {},
    requestTimeoutMs: 1000,
    reportTimeoutMs: 1500,
    ...overrides,
  });
  const count = (match) =>
    calls.filter((call) => call.href.includes(match)).length;
  return { handler, calls, count, clock };
}

const ROUTE = '/?lat=29.27&lon=-94.82';

test('a full report normalizes every source, pages the hourly forecast and hides the key', async () => {
  const h = harness();
  const response = await invoke(h.handler, ROUTE);
  assert.equal(response.status, 200);
  const body = response.json();
  assert.deepEqual(body.point, { lat: 29.25, lon: -94.8 });
  assert.equal(body.place, 'Galveston, Texas');
  assert.equal(body.timeZone, 'America/Chicago');
  assert.equal(body.generatedAt, T0);
  assert.equal(body.stale, false);
  assert.deepEqual(body.sources, {
    google: 'ok',
    openMeteoMarine: 'ok',
    openMeteoSolar: 'ok',
    place: 'ok',
  });
  assert.equal(body.now.temperatureC, 29.8);
  assert.equal(body.hourly.length, 48);
  assert.equal(body.daily.length, 10);
  assert.equal(body.marine.waveHeightM, 0.46);
  assert.equal(body.solar.surfaceTempC, 28.8);
  assert.equal(h.count('forecast/hours:lookup'), 2);
  assert.doesNotMatch(response.text, /TEST-KEY/);
  for (const call of h.calls) {
    assert.equal(
      call.options.headers['User-Agent'],
      'CyclopsView/0.1 (+https://github.com/CaptPat/gods-eye-view)',
    );
  }
});

test('reports are cached per grid cell for ten minutes, and the oldest key is evicted', async () => {
  const h = harness({ cacheLimit: 2 });
  await invoke(h.handler, ROUTE);
  await invoke(h.handler, '/?lat=29.26&lon=-94.79');
  assert.equal(
    h.count('currentConditions:lookup'),
    1,
    'same 0.05° cell is a cache hit',
  );
  h.clock.now += FRESH_MS + 1;
  await invoke(h.handler, ROUTE);
  assert.equal(
    h.count('currentConditions:lookup'),
    2,
    'expired after ten minutes',
  );
  await invoke(h.handler, '/?lat=10&lon=10');
  await invoke(h.handler, '/?lat=20&lon=20');
  await invoke(h.handler, ROUTE);
  assert.equal(
    h.count('currentConditions:lookup'),
    5,
    'the oldest key was evicted at the cache limit',
  );
});

test('one failing source leaves the others; inland marine is null but ok; place failure is tolerated', async () => {
  const failing = harness(
    {
      fetchPlace: async () => {
        throw new Error('nominatim down');
      },
    },
    { 'marine-api.open-meteo.com': fail },
  );
  const body = (await invoke(failing.handler, ROUTE)).json();
  assert.deepEqual(body.sources, {
    google: 'ok',
    openMeteoMarine: 'unavailable',
    openMeteoSolar: 'ok',
    place: 'unavailable',
  });
  assert.equal(body.marine, null);
  assert.equal(body.place, null);

  const inland = harness(
    {},
    {
      'marine-api.open-meteo.com': () =>
        fixture('open-meteo-marine-inland.json'),
    },
  );
  const inlandBody = (await invoke(inland.handler, ROUTE)).json();
  assert.equal(inlandBody.sources.openMeteoMarine, 'ok');
  assert.equal(inlandBody.marine, null);
});

test('with every weather source failing the route is 502, or serves the last report as stale for an hour', async () => {
  const down = [
    'currentConditions:lookup',
    'marine-api.open-meteo.com',
    'api.open-meteo.com/v1/forecast',
  ];
  const cold = harness({}, Object.fromEntries(down.map((key) => [key, fail])));
  const failed = await invoke(cold.handler, ROUTE);
  assert.equal(failed.status, 502);
  assert.deepEqual(failed.json(), { error: 'Weather sources unavailable' });

  const state = { broken: false };
  const guard = (answer) => (href) => (state.broken ? fail() : answer(href));
  const h = harness(
    {},
    {
      'currentConditions:lookup': guard(() => fixture('google-current.json')),
      'marine-api.open-meteo.com': guard(() =>
        fixture('open-meteo-marine-coastal.json'),
      ),
      'api.open-meteo.com/v1/forecast': guard(() =>
        fixture('open-meteo-solar.json'),
      ),
    },
  );
  await invoke(h.handler, ROUTE);
  state.broken = true;
  h.clock.now = T0 + 20 * MIN;
  const stale = await invoke(h.handler, ROUTE);
  assert.equal(stale.status, 200);
  assert.equal(stale.json().stale, true);
  assert.equal(stale.json().generatedAt, T0);
  h.clock.now = T0 + STALE_MAX_MS + 1;
  assert.equal((await invoke(h.handler, ROUTE)).status, 502);
});

test('without a Google key the report is not-configured and makes no Google request', async () => {
  const h = harness({ apiKey: () => '' });
  const response = await invoke(h.handler, ROUTE);
  assert.equal(response.status, 200);
  const body = response.json();
  assert.equal(body.sources.google, 'not-configured');
  assert.equal(body.now, null);
  assert.equal(body.hourly, null);
  assert.equal(body.daily, null);
  assert.equal(body.timeZone, null);
  assert.equal(h.count('googleapis.com'), 0);
});

test('validation, rate limiting and methods', async () => {
  const h = harness();
  const bad = await invoke(h.handler, '/?lat=95&lon=0');
  assert.equal(bad.status, 400);
  assert.match(bad.json().error, /lat/);
  const limited = harness({ limiter: () => false });
  const refused = await invoke(limited.handler, ROUTE);
  assert.equal(refused.status, 429);
  assert.equal(refused.headers['Retry-After'], '10');
  assert.equal((await invoke(h.handler, ROUTE, 'POST')).status, 405);
});

test('a source still pending at the report deadline is unavailable', async () => {
  const h = harness(
    { reportTimeoutMs: 50 },
    { 'api.open-meteo.com/v1/forecast': () => new Promise(() => {}) },
  );
  const started = Date.now();
  const body = (await invoke(h.handler, ROUTE)).json();
  assert.ok(Date.now() - started < 1000);
  assert.equal(body.sources.openMeteoSolar, 'unavailable');
  assert.equal(body.solar, null);
  assert.equal(body.sources.google, 'ok');
});

test('concurrent requests for one grid cell share one upstream fan-out', async () => {
  const h = harness();
  await Promise.all([invoke(h.handler, ROUTE), invoke(h.handler, ROUTE)]);
  assert.equal(h.count('currentConditions:lookup'), 1);
});

test('the plugin is registered in the Vite config at /api/weather-report', () => {
  const plugin = createViteConfig({ mode: 'test' }).plugins.find(
    (p) => p.name === 'weather-report-proxy',
  );
  assert.ok(plugin, 'weather-report-proxy must be registered');
  const routes = new Map();
  plugin.configureServer({
    middlewares: { use: (route, handler) => routes.set(route, handler) },
  });
  assert.equal(typeof routes.get('/api/weather-report'), 'function');
});
