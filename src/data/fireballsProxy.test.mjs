import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import createViteConfig from '../../vite.config.js';
import {
  FIREBALLS_RETRY_MS,
  FIREBALLS_TTL_MS,
  createFireballsHandler,
} from '../../server/providers/fireballs.js';
import {
  normalizeFireballs,
  upstreamError,
} from '../../server/providers/fireballs/normalize.js';

const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`./fixtures/fireballs/${name}`, import.meta.url),
      'utf8',
    ),
  );
const T0 = Date.UTC(2026, 8, 15, 12, 0);
const USER_AGENT =
  'CyclopsView/0.1 (+https://github.com/CaptPat/gods-eye-view)';

function invoke(handler, url, method = 'GET', remoteAddress = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const req = { method, url, headers: {}, socket: { remoteAddress } };
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
    answer: answer ?? (() => fixture('fireball-located-6.json')),
  };
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const value = await state.answer();
    return value instanceof Response ? value : Response.json(value);
  };
  const handler = createFireballsHandler({
    fetchImpl,
    now: () => clock.now,
    limiter,
    log: () => {},
  });
  return { handler, calls, clock, state };
}

test('CNEOS rows become signed-coordinate fireball records in UTC', () => {
  const records = normalizeFireballs(fixture('fireball-located-6.json'));
  assert.equal(records.length, 6);
  assert.deepEqual(records[0], {
    id: '20260911101803',
    time: Date.UTC(2026, 8, 11, 10, 18, 3),
    lat: -0.2,
    lon: -129.6,
    altKm: 70,
    velKms: null,
    energyJ: 6.1e10,
    impactKt: 0.2,
  });
  assert.equal(records[2].velKms, 19.3);
  assert.deepEqual([records[5].lat, records[5].lon], [-19.5, 176.2]);
  assert.deepEqual([records[1].lat, records[1].lon], [54.4, -100.1]);
});

test('rows without a usable location or time are dropped; same-second ids stay unique; empty is no fireballs', () => {
  const base = fixture('fireball-located-6.json');
  const rows = [
    ['2026-01-02 03:04:05', '1.0', '0.05', null, null, null, null, null, null],
    [
      '2026-01-02 03:04:06',
      '1.0',
      '0.05',
      '95.0',
      'N',
      '10.0',
      'E',
      '30',
      null,
    ],
    [
      '2026-01-02 03:04:06',
      '1.0',
      '0.05',
      '10.0',
      'N',
      '190.0',
      'E',
      '30',
      null,
    ],
    ['not a date', '1.0', '0.05', '10.0', 'N', '10.0', 'E', '30.0', null],
    [
      '2026-01-02 03:04:07',
      '1.0',
      '0.05',
      '10.0',
      'X',
      '10.0',
      'E',
      '30',
      null,
    ],
    [
      '2026-01-02 03:04:08',
      '1.0',
      '0.05',
      '10.0',
      'N',
      '10.0',
      'E',
      null,
      null,
    ],
    [
      '2026-01-02 03:04:08',
      '2.0',
      '0.07',
      '11.0',
      'S',
      '12.0',
      'W',
      '25',
      '14',
    ],
  ];
  const records = normalizeFireballs({ ...base, count: '7', data: rows });
  assert.deepEqual(
    records.map((record) => record.id),
    ['20260102030408', '20260102030408-2'],
  );
  assert.equal(records[0].altKm, null);
  assert.deepEqual([records[1].lat, records[1].lon], [-11, -12]);
  assert.deepEqual(normalizeFireballs(fixture('fireball-empty.json')), []);
});

test('a malformed or error answer is not a fireball list', () => {
  const bad = fixture('fireball-bad-request.json');
  assert.equal(normalizeFireballs(bad), null);
  assert.match(upstreamError(bad), /invalid value specified/);
  assert.equal(upstreamError(fixture('fireball-located-6.json')), null);
  assert.equal(normalizeFireballs({ fields: ['date'], data: 'nope' }), null);
  assert.equal(normalizeFireballs({ count: '2', fields: ['date'] }), null);
  assert.equal(normalizeFireballs(null), null);
});

test('fireballs are served from one located CNEOS fetch cached for six hours', async () => {
  const h = harness();
  const first = await invoke(h.handler, '/');
  assert.equal(first.status, 200);
  const body = first.json();
  assert.equal(body.stale, false);
  assert.equal(body.generatedAt, T0);
  assert.equal(body.fireballs.length, 6);
  assert.equal(
    h.calls[0].url,
    'https://ssd-api.jpl.nasa.gov/fireball.api?req-loc=true',
  );
  assert.equal(h.calls[0].options.headers['User-Agent'], USER_AGENT);
  await invoke(h.handler, '/');
  assert.equal(h.calls.length, 1);
  h.clock.now += FIREBALLS_TTL_MS;
  await invoke(h.handler, '');
  assert.equal(h.calls.length, 2);
});

test('simultaneous cold requests share one upstream fetch', async () => {
  const h = harness();
  const [a, b] = await Promise.all([
    invoke(h.handler, '/'),
    invoke(h.handler, '/'),
  ]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(h.calls.length, 1);
});

test('a failed refresh serves the last list as stale and retries after ten minutes; with no list it is 502', async () => {
  const h = harness();
  await invoke(h.handler, '/');
  h.state.answer = () =>
    Response.json(fixture('fireball-bad-request.json'), { status: 400 });
  h.clock.now += FIREBALLS_TTL_MS;
  const stale = await invoke(h.handler, '/');
  assert.equal(stale.status, 200);
  assert.equal(stale.json().stale, true);
  assert.equal(stale.json().fireballs.length, 6);
  assert.equal(stale.json().generatedAt, T0);
  assert.equal(h.calls.length, 2);
  h.clock.now += FIREBALLS_RETRY_MS - 1;
  await invoke(h.handler, '/');
  assert.equal(h.calls.length, 2, 'no retry inside ten minutes');
  h.clock.now += 1;
  h.state.answer = () => fixture('fireball-any-6.json');
  const recovered = await invoke(h.handler, '/');
  assert.equal(recovered.json().stale, false);
  assert.equal(h.calls.length, 3);

  for (const answer of [
    () => {
      throw new Error('ECONNRESET');
    },
    () => ({ fields: ['date'], data: 'nope' }),
  ]) {
    const cold = harness({ answer });
    const failed = await invoke(cold.handler, '/');
    assert.equal(failed.status, 502);
    assert.deepEqual(failed.json(), {
      error: 'NASA/JPL fireball data unavailable',
    });
  }
});

test('non-GET, unknown paths and rate-limited clients are refused', async () => {
  const h = harness();
  assert.equal((await invoke(h.handler, '/', 'POST')).status, 405);
  assert.equal((await invoke(h.handler, '/other')).status, 404);
  const limited = await invoke(harness({ limiter: () => false }).handler, '/');
  assert.equal(limited.status, 429);
  assert.equal(limited.headers['Retry-After'], '10');
  assert.equal(h.calls.length, 0);
});

test('the plugin is registered in the Vite config at /api/fireballs', () => {
  const plugin = createViteConfig({ mode: 'test' }).plugins.find(
    (p) => p.name === 'fireballs-proxy',
  );
  assert.ok(plugin, 'fireballs-proxy must be registered');
  const routes = new Map();
  plugin.configureServer({
    middlewares: { use: (route, handler) => routes.set(route, handler) },
  });
  assert.equal(typeof routes.get('/api/fireballs'), 'function');
});
