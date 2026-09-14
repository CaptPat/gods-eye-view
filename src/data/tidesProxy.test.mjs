import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import createViteConfig from '../../vite.config.js';
import {
  REPORT_TTL_MS,
  STATIONS_RETRY_MS,
  STATIONS_TTL_MS,
  createTidesHandler,
} from '../../server/providers/tides.js';

const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`./fixtures/tides-currents/${name}`, import.meta.url),
      'utf8',
    ),
  );
const T0 = Date.UTC(2026, 8, 14, 16, 10);
const USER_AGENT =
  'CyclopsView/0.1 (+https://github.com/CaptPat/gods-eye-view)';

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
        const text = String(body || '');
        resolve({
          status: this.status,
          headers: this.headers,
          json: () => JSON.parse(text),
        });
      },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

/** Name each upstream request by what it asks CO-OPS for. */
function requestName(href) {
  const url = new URL(href);
  const type = url.searchParams.get('type');
  if (type) return `stations:${type}`;
  const p = Object.fromEntries(url.searchParams);
  if (p.product === 'predictions')
    return `${p.interval === 'hilo' ? 'hilo' : 'latest'}:${p.station}`;
  if (p.product === 'water_level') return `level:${p.station}:${p.datum}`;
  if (p.product === 'currents_predictions')
    return `currents:${p.station}:${p.bin}`;
  return `unknown:${href}`;
}

const answers = {
  'stations:waterlevels': () => fixture('mdapi-waterlevels.json'),
  'stations:currentpredictions': () => fixture('mdapi-currentpredictions.json'),
  'hilo:8454000': () => fixture('datagetter-hilo-8454000.json'),
  'level:8454000:MLLW': () => fixture('datagetter-water-level-8454000.json'),
  'latest:8454000': () => fixture('datagetter-predictions-latest-8454000.json'),
  'level:9063020:IGLD': () =>
    fixture('datagetter-water-level-igld-9063020.json'),
  'currents:ACT1616:1': () => fixture('datagetter-currents-ACT1616-bin1.json'),
  'currents:HAI1103:1': () => fixture('datagetter-currents-ACT1616-bin1.json'),
};

function harness(overrides = {}, answerOverrides = {}) {
  const calls = [];
  const table = { ...answers, ...answerOverrides };
  const clock = { now: T0 };
  const fetchImpl = async (url, options = {}) => {
    const name = requestName(String(url));
    calls.push({ name, url: String(url), options });
    const answer = table[name];
    if (!answer) throw new Error(`unexpected upstream ${name}`);
    const value = await answer();
    return value instanceof Response ? value : Response.json(value);
  };
  const handler = createTidesHandler({
    fetchImpl,
    now: () => clock.now,
    limiter: () => true,
    log: () => {},
    ...overrides,
  });
  const count = (name) => calls.filter((call) => call.name === name).length;
  return { handler, calls, count, clock };
}

const forbidden = () =>
  Response.json(fixture('datagetter-forbidden.json'), { status: 403 });

test('tide stations are served from one Metadata API fetch cached for 24 hours', async () => {
  const h = harness();
  const first = await invoke(h.handler, '/stations?kind=tide');
  assert.equal(first.status, 200);
  const body = first.json();
  assert.equal(body.kind, 'tide');
  assert.equal(body.stale, false);
  assert.equal(body.generatedAt, T0);
  assert.equal(body.stations.length, 12);
  assert.equal(h.calls[0].options.headers['User-Agent'], USER_AGENT);
  await invoke(h.handler, '/stations?kind=tide');
  assert.equal(h.count('stations:waterlevels'), 1);
  h.clock.now += STATIONS_TTL_MS;
  await invoke(h.handler, '/stations?kind=tide');
  assert.equal(h.count('stations:waterlevels'), 2);
});

test('current stations are grouped by id with zones taken from the tide list', async () => {
  const h = harness();
  const body = (await invoke(h.handler, '/stations?kind=current')).json();
  assert.equal(body.kind, 'current');
  assert.deepEqual(
    body.stations.map((station) => station.id),
    ['ACT0311', 'ACT1616', 'HAI1103', 'PCT0016'],
  );
  assert.deepEqual(
    body.stations.find((station) => station.id === 'HAI1103').bins,
    [1, 12, 23],
  );
  assert.equal(h.count('stations:waterlevels'), 1);
  assert.equal(h.count('stations:currentpredictions'), 1);
  assert.equal((await invoke(h.handler, '/stations?kind=moon')).status, 400);
});

test('a failed list refresh serves the last list as stale and retries after ten minutes; with no list it is 502', async () => {
  const state = { down: false };
  const h = harness(
    {},
    {
      'stations:waterlevels': () =>
        state.down ? forbidden() : fixture('mdapi-waterlevels.json'),
    },
  );
  await invoke(h.handler, '/stations?kind=tide');
  state.down = true;
  h.clock.now = T0 + STATIONS_TTL_MS;
  const stale = (await invoke(h.handler, '/stations?kind=tide')).json();
  assert.equal(stale.stale, true);
  assert.equal(stale.generatedAt, T0);
  assert.equal(stale.stations.length, 12);
  await invoke(h.handler, '/stations?kind=tide');
  assert.equal(
    h.count('stations:waterlevels'),
    2,
    'no retry inside the ten-minute window',
  );
  state.down = false;
  h.clock.now += STATIONS_RETRY_MS;
  assert.equal(
    (await invoke(h.handler, '/stations?kind=tide')).json().stale,
    false,
  );

  const cold = harness({}, { 'stations:waterlevels': forbidden });
  const failed = await invoke(cold.handler, '/stations?kind=tide');
  assert.equal(failed.status, 502);
  assert.deepEqual(failed.json(), { error: 'NOAA CO-OPS unavailable' });
});

test('a tide report joins high/low predictions with the latest observation and its prediction, cached ten minutes', async () => {
  const h = harness();
  const response = await invoke(h.handler, '/tide?id=8454000');
  assert.equal(response.status, 200);
  const body = response.json();
  assert.equal(body.id, '8454000');
  assert.equal(body.kind, 'tide');
  assert.equal(body.datum, 'MLLW');
  assert.equal(body.generatedAt, T0);
  assert.deepEqual(body.sources, { predictions: 'ok', observed: 'ok' });
  assert.equal(body.predictions.length, 12);
  assert.deepEqual(body.observed, {
    time: Date.UTC(2026, 8, 14, 16, 6),
    heightM: 1.474,
    predictedM: 1.429,
  });
  const hilo = new URL(
    h.calls.find((call) => call.name === 'hilo:8454000').url,
  );
  assert.equal(hilo.searchParams.get('begin_date'), '20260914 16:00');
  await invoke(h.handler, '/tide?id=8454000');
  assert.equal(h.count('hilo:8454000'), 1);
  h.clock.now += REPORT_TTL_MS;
  await invoke(h.handler, '/tide?id=8454000');
  assert.equal(h.count('hilo:8454000'), 2);
});

test('Great Lakes stations report an IGLD observation and never ask for predictions', async () => {
  const h = harness();
  const body = (await invoke(h.handler, '/tide?id=9063020')).json();
  assert.equal(body.datum, 'IGLD');
  assert.deepEqual(body.sources, { predictions: 'none', observed: 'ok' });
  assert.equal(body.predictions, null);
  assert.deepEqual(body.observed, {
    time: Date.UTC(2026, 8, 14, 16, 6),
    heightM: 174.372,
    predictedM: null,
  });
  assert.equal(
    h.calls.some((call) => call.name.startsWith('hilo:')),
    false,
  );
});

test('a partial tide report is served but not cached; a report with nothing is 502', async () => {
  const h = harness(
    {},
    {
      'level:8454000:MLLW': () =>
        fixture('datagetter-water-level-nodata-8551910.json'),
    },
  );
  const body = (await invoke(h.handler, '/tide?id=8454000')).json();
  assert.deepEqual(body.sources, {
    predictions: 'ok',
    observed: 'unavailable',
  });
  assert.equal(body.observed, null);
  await invoke(h.handler, '/tide?id=8454000');
  assert.equal(h.count('hilo:8454000'), 2, 'partial reports are refetched');

  const down = harness(
    {},
    {
      'hilo:8454000': forbidden,
      'level:8454000:MLLW': forbidden,
      'latest:8454000': forbidden,
    },
  );
  const failed = await invoke(down.handler, '/tide?id=8454000');
  assert.equal(failed.status, 502);
  assert.deepEqual(failed.json(), { error: 'NOAA CO-OPS unavailable' });
});

test('current reports use the lowest bin by default and validate station and bin', async () => {
  const h = harness();
  const body = (await invoke(h.handler, '/current?id=HAI1103')).json();
  assert.equal(body.bin, 1);
  assert.equal(h.count('currents:HAI1103:1'), 1);
  const pollockRip = (
    await invoke(h.handler, '/current?id=ACT1616&bin=1')
  ).json();
  assert.deepEqual(pollockRip.sources, { predictions: 'ok' });
  assert.equal(pollockRip.depthM, 4.6);
  assert.equal(pollockRip.floodDirDeg, 37);
  assert.equal(pollockRip.ebbDirDeg, 226);
  assert.equal(pollockRip.events.length, 24);
  assert.equal(
    (await invoke(h.handler, '/current?id=ACT1616&bin=2')).status,
    400,
  );
  assert.equal(
    (await invoke(h.handler, '/current?id=ACT1616&bin=x')).status,
    400,
  );
  assert.equal(
    (await invoke(h.handler, '/current?id=ACT5971')).status,
    404,
    'weak-and-variable stations are not listed',
  );
  assert.equal(
    (await invoke(h.handler, '/tide?id=8761955')).status,
    404,
    'non-tidal stations are not listed',
  );
  assert.equal((await invoke(h.handler, '/tide?id=../etc')).status, 404);

  const unavailable = harness(
    {},
    {
      'currents:ACT1616:1': () =>
        fixture('datagetter-currents-unavailable-ACT5971.json'),
    },
  );
  assert.equal(
    (await invoke(unavailable.handler, '/current?id=ACT1616')).status,
    502,
  );
});

test('the report cache is pruned by age and capped by size', async () => {
  const h = harness({ reportCacheLimit: 2 });
  await invoke(h.handler, '/tide?id=8454000');
  await invoke(h.handler, '/tide?id=9063020');
  await invoke(h.handler, '/current?id=ACT1616');
  assert.equal(
    h.handler.cacheSizes().reports,
    2,
    'oldest report evicted at the cap',
  );
  await invoke(h.handler, '/tide?id=8454000');
  assert.equal(h.count('hilo:8454000'), 2, 'the evicted report is refetched');
  h.clock.now += REPORT_TTL_MS;
  await invoke(h.handler, '/current?id=HAI1103');
  assert.equal(
    h.handler.cacheSizes().reports,
    1,
    'expired reports pruned on insert',
  );
});

test('rate limits, methods and unknown routes', async () => {
  const limited = harness({ limiter: () => false });
  const refused = await invoke(limited.handler, '/stations?kind=tide');
  assert.equal(refused.status, 429);
  assert.equal(refused.headers['Retry-After'], '10');
  const h = harness();
  assert.equal(
    (await invoke(h.handler, '/stations?kind=tide', 'POST')).status,
    405,
  );
  assert.equal((await invoke(h.handler, '/nope')).status, 404);
});

test('the plugin is registered in the Vite config at /api/tides', () => {
  const plugin = createViteConfig({ mode: 'test' }).plugins.find(
    (p) => p.name === 'tides-proxy',
  );
  assert.ok(plugin, 'tides-proxy must be registered');
  const routes = new Map();
  plugin.configureServer({
    middlewares: { use: (route, handler) => routes.set(route, handler) },
  });
  assert.equal(typeof routes.get('/api/tides'), 'function');
});
