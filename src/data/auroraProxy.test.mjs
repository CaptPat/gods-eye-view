import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import createViteConfig from '../../vite.config.js';
import {
  AURORA_RETRY_MS,
  AURORA_TTL_MS,
  createAuroraHandler,
} from '../../server/providers/aurora.js';
import {
  AURORA_LEVELS,
  normalizeOvation,
} from '../../server/providers/aurora/normalize.js';

const fixture = (name) =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/aurora/${name}`, import.meta.url), 'utf8'),
  );
const T0 = Date.UTC(2026, 8, 15, 12, 0);
const USER_AGENT =
  'CyclopsView/0.1 (+https://github.com/CaptPat/gods-eye-view)';
const UPSTREAM =
  'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json';

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

function harness({ answer, limiter = () => true } = {}) {
  const calls = [];
  const clock = { now: T0 };
  const state = {
    answer: answer ?? (() => fixture('ovation-header-truncated.json')),
  };
  const handler = createAuroraHandler({
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      const value = await state.answer();
      return value instanceof Response ? value : Response.json(value);
    },
    now: () => clock.now,
    limiter,
    log: () => {},
  });
  return { handler, calls, clock, state };
}

test('the OVATION grid becomes probability bands with its observation and forecast times', () => {
  assert.deepEqual(AURORA_LEVELS, [5, 10, 30, 50]);
  assert.deepEqual(normalizeOvation(fixture('ovation-header-truncated.json')), {
    observationTime: Date.parse('2026-09-15T11:39:00Z'),
    forecastTime: Date.parse('2026-09-15T12:36:00Z'),
    maxProbability: 5,
    bands: [
      { level: 0, west: -0.5, south: -88.5, east: 0.5, north: -87.5 },
      { level: 0, west: -0.5, south: -87.5, east: 0.5, north: -86.5 },
    ],
  });
});

test('a cell takes the highest threshold it reaches, and equal neighbours merge', () => {
  const result = normalizeOvation({
    coordinates: [
      [10, 70, 55],
      [11, 70, 55],
      [12, 70, 31],
      [13, 70, 4],
      [200, -60, 10],
    ],
  });
  assert.deepEqual(result, {
    observationTime: null,
    forecastTime: null,
    maxProbability: 55,
    bands: [
      { level: 1, west: -160.5, south: -60.5, east: -159.5, north: -59.5 },
      { level: 3, west: 9.5, south: 69.5, east: 11.5, north: 70.5 },
      { level: 2, west: 11.5, south: 69.5, east: 12.5, north: 70.5 },
    ],
  });
});

test('a real northern slice keeps every band inside it and covers exactly the cells at 5% or more', () => {
  const json = fixture('ovation-north-55-75.json');
  const result = normalizeOvation(json);
  assert.equal(
    result.maxProbability,
    Math.max(...json.coordinates.map((point) => point[2])),
  );
  assert.ok(result.bands.length > 0);
  for (const band of result.bands) {
    assert.ok(band.south >= 54.5 && band.north <= 75.5, JSON.stringify(band));
    assert.ok(band.east > band.west && band.east - band.west <= 90);
  }
  const covered = result.bands.reduce(
    (sum, band) => sum + (band.east - band.west),
    0,
  );
  assert.equal(
    Math.round(covered),
    json.coordinates.filter((point) => point[2] >= 5).length,
  );
});

test('malformed input is refused and out-of-range triplets are skipped', () => {
  assert.equal(normalizeOvation(null), null);
  assert.equal(normalizeOvation({ coordinates: 'x' }), null);
  assert.equal(
    normalizeOvation({
      coordinates: [
        [400, 0, 10],
        [0, 95, 10],
        [0, 0, -1],
        [0, 0, 'x'],
        [1.5, 0, 10],
        'nope',
      ],
    }),
    null,
  );
  const partial = normalizeOvation({
    coordinates: [
      [400, 0, 10],
      [5, 5, 6],
    ],
  });
  assert.equal(partial.bands.length, 1);
  assert.equal(partial.maxProbability, 6);
});

test('the aurora forecast is served from one SWPC fetch cached for five minutes', async () => {
  const h = harness();
  const first = await invoke(h.handler, '/');
  assert.equal(first.status, 200);
  const body = first.json();
  assert.equal(body.generatedAt, T0);
  assert.equal(body.stale, false);
  assert.equal(body.maxProbability, 5);
  assert.equal(body.bands.length, 2);
  assert.equal(body.forecastTime, Date.parse('2026-09-15T12:36:00Z'));
  assert.equal(h.calls[0].url, UPSTREAM);
  assert.equal(h.calls[0].options.headers['User-Agent'], USER_AGENT);
  await invoke(h.handler, '/');
  assert.equal(h.calls.length, 1);
  h.clock.now += AURORA_TTL_MS;
  await invoke(h.handler, '/');
  assert.equal(h.calls.length, 2);
  assert.equal(AURORA_TTL_MS, 5 * 60_000);
});

test('a failed refresh serves the last forecast as stale and retries after a minute; with none it is 502', async () => {
  const h = harness();
  await invoke(h.handler, '/');
  h.state.answer = () => new Response('busy', { status: 503 });
  h.clock.now += AURORA_TTL_MS;
  const stale = await invoke(h.handler, '/');
  assert.equal(stale.status, 200);
  assert.equal(stale.json().stale, true);
  assert.equal(stale.json().generatedAt, T0);
  h.clock.now += AURORA_RETRY_MS - 1;
  await invoke(h.handler, '/');
  assert.equal(h.calls.length, 2);
  h.clock.now += 1;
  h.state.answer = () => fixture('ovation-north-55-75.json');
  const recovered = (await invoke(h.handler, '/')).json();
  assert.equal(recovered.stale, false);
  assert.equal(h.calls.length, 3);
  assert.equal(AURORA_RETRY_MS, 60_000);

  for (const answer of [
    () => {
      throw new Error('ECONNRESET');
    },
    () => ({ coordinates: 'nope' }),
  ]) {
    const failed = await invoke(harness({ answer }).handler, '/');
    assert.equal(failed.status, 502);
    assert.deepEqual(failed.json(), {
      error: 'NOAA SWPC aurora forecast unavailable',
    });
  }
});

test('non-GET, unknown paths and rate-limited clients are refused', async () => {
  const h = harness();
  assert.equal((await invoke(h.handler, '/', 'POST')).status, 405);
  assert.equal((await invoke(h.handler, '/other')).status, 404);
  const limited = await invoke(harness({ limiter: () => false }).handler, '/');
  assert.equal(limited.status, 429);
  assert.equal(h.calls.length, 0);
});

test('the plugin is registered in the Vite config at /api/aurora', () => {
  const plugin = createViteConfig({ mode: 'test' }).plugins.find(
    (p) => p.name === 'aurora-proxy',
  );
  assert.ok(plugin, 'aurora-proxy must be registered');
  const routes = new Map();
  plugin.configureServer({
    middlewares: { use: (route, handler) => routes.set(route, handler) },
  });
  assert.equal(typeof routes.get('/api/aurora'), 'function');
});
