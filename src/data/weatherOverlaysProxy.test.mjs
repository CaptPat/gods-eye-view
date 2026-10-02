import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import createViteConfig from '../../vite.config.js';
import {
  DEFAULT_GOOGLE_TILE_BUDGET,
  GOOGLE_TILE_BUDGET_REASON,
  createWeatherOverlaysHandler,
  googleDailyBudgetFromEnv,
} from '../../server/providers/weather-overlays.js';

const bytes = (name) =>
  readFileSync(new URL(`./fixtures/weather-overlays/${name}`, import.meta.url));
const text = (name) => bytes(name).toString('utf8');
const NOW = Date.UTC(2026, 8, 14, 16, 20);
const T15 = Date.UTC(2026, 8, 14, 15);
const H16 = Date.UTC(2026, 8, 14, 16);
const pngResponse = (name) => () =>
  new Response(bytes(name), {
    status: 200,
    headers: { 'content-type': 'image/png' },
  });

/** Route by URL substring (first match wins); count calls per route; answers may throw. */
function upstream(routes) {
  const calls = [];
  const fetchImpl = async (url) => {
    const href = String(url);
    calls.push(href);
    for (const [match, answer] of routes) {
      if (href.includes(match)) return answer(href);
    }
    throw new Error(`unexpected upstream ${href}`);
  };
  return {
    fetchImpl,
    calls,
    count: (match) => calls.filter((href) => href.includes(match)).length,
  };
}

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
        const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body || '');
        resolve({
          status: this.status,
          headers: this.headers,
          buffer,
          json: () => JSON.parse(buffer.toString('utf8')),
        });
      },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

function harness({
  key = 'TEST-KEY',
  routes = [],
  limiter = () => true,
  tileLimiter = () => true,
  googleTileBudget,
} = {}) {
  const clock = { now: NOW };
  const logs = [];
  const net = upstream([
    ...routes,
    ['airquality.googleapis.com', pngResponse('google-air-quality-tile.png')],
    ['pollen.googleapis.com', pngResponse('google-pollen-tile.png')],
  ]);
  const handler = createWeatherOverlaysHandler({
    fetchImpl: net.fetchImpl,
    now: () => clock.now,
    apiKey: () => key,
    limiter,
    tileLimiter,
    log: (message) => logs.push(message),
    ...(googleTileBudget !== undefined ? { googleTileBudget } : {}),
  });
  return { handler, net, logs, clock };
}

test('manifests give the current hour for Google modes; clouds and temperature are gone', async () => {
  const h = harness();
  for (const moved of ['clouds', 'temperature']) {
    assert.equal(
      (await invoke(h.handler, `/manifest?mode=${moved}`)).status,
      400,
      `${moved} moved upstream (Satellite clouds, Wind)`,
    );
    assert.equal(
      (await invoke(h.handler, `/tiles/${moved}/${T15}/3/1/2.png`)).status,
      400,
    );
  }

  for (const mode of ['air-quality', 'pollen-weed']) {
    assert.deepEqual(
      (await invoke(h.handler, `/manifest?mode=${mode}`)).json(),
      {
        mode,
        googleConfigured: true,
        available: true,
        time: H16,
        stale: false,
      },
    );
  }
  assert.equal(h.net.count('googleapis.com'), 0, 'manifests never call Google');
  assert.equal((await invoke(h.handler, '/manifest?mode=pollen')).status, 400);
  assert.equal((await invoke(h.handler, '/manifest')).status, 400);
});

test('without a Google key every mode is unavailable and tiles 404', async () => {
  const h = harness({ key: '' });
  assert.deepEqual(
    (await invoke(h.handler, '/manifest?mode=air-quality')).json(),
    {
      mode: 'air-quality',
      googleConfigured: false,
      available: false,
      reason: 'not-configured',
      time: null,
      stale: false,
    },
  );
  assert.equal(
    (await invoke(h.handler, `/tiles/pollen-tree/${H16}/3/1/2.png`)).status,
    404,
  );
  assert.equal(
    (await invoke(h.handler, '/manifest?mode=pollen-weed')).json().available,
    false,
  );
  assert.equal(h.net.count('googleapis.com'), 0);
});

test('Google tiles use the server key, are never cached, and failures are not cached', async () => {
  let failPollen = true;
  const h = harness({
    routes: [
      [
        'GRASS_UPI',
        () =>
          failPollen
            ? new Response(text('google-invalid-map-type.json'), {
                status: 400,
              })
            : pngResponse('google-pollen-tile.png')(),
      ],
    ],
  });
  const route = `/tiles/air-quality/${H16}/3/1/2.png`;
  const miss = await invoke(h.handler, route);
  assert.equal(miss.status, 200);
  assert.equal(miss.headers['Content-Type'], 'image/png');
  assert.equal(
    miss.headers['Cache-Control'],
    'no-store',
    'Google tiles are never cached by the browser either',
  );
  assert.ok(miss.buffer.equals(bytes('google-air-quality-tile.png')));
  assert.ok(
    h.net.calls.includes(
      'https://airquality.googleapis.com/v1/mapTypes/US_AQI/heatmapTiles/3/1/2?key=TEST-KEY',
    ),
  );
  await invoke(h.handler, route);
  assert.equal(
    h.net.count('US_AQI'),
    2,
    'an identical request goes upstream again: Google tiles are never cached',
  );

  const pollen = `/tiles/pollen-grass/${H16}/5/7/12.png`;
  assert.equal((await invoke(h.handler, pollen)).status, 502);
  failPollen = false;
  assert.equal((await invoke(h.handler, pollen)).status, 200);
  assert.equal(h.net.count('GRASS_UPI'), 2, 'the failed tile was not cached');
  assert.ok(h.logs.length > 0);
  assert.ok(
    h.logs.every((line) => !line.includes('TEST-KEY')),
    'logs never carry the key',
  );

  assert.equal(
    (
      await invoke(
        h.handler,
        `/tiles/air-quality/${H16 - 4 * 3_600_000}/3/1/2.png`,
      )
    ).status,
    404,
  );
  assert.equal(
    (await invoke(h.handler, `/tiles/air-quality/${H16}/13/0/0.png`)).status,
    400,
  );
  assert.equal(
    (await invoke(h.handler, `/tiles/pollen-grass/${H16}/11/0/0.png`)).status,
    400,
  );
});

test('manifest and tile rate limits are separate; methods, unknown paths and non-PNG bodies', async () => {
  const manifestLimited = harness({ limiter: () => false });
  const refused = await invoke(
    manifestLimited.handler,
    '/manifest?mode=air-quality',
  );
  assert.equal(refused.status, 429);
  assert.equal(refused.headers['Retry-After'], '10');
  assert.equal(
    (
      await invoke(
        manifestLimited.handler,
        `/tiles/air-quality/${H16}/0/0/0.png`,
      )
    ).status,
    200,
    'tiles keep their own budget',
  );

  const tileLimited = harness({ tileLimiter: () => false });
  assert.equal(
    (await invoke(tileLimited.handler, `/tiles/air-quality/${H16}/0/0/0.png`))
      .status,
    429,
  );
  assert.equal(
    (await invoke(tileLimited.handler, '/manifest?mode=air-quality')).status,
    200,
  );

  const h = harness({
    routes: [['US_AQI', () => new Response('<html>not a tile</html>')]],
  });
  assert.equal(
    (await invoke(h.handler, '/manifest?mode=air-quality', 'POST')).status,
    405,
  );
  assert.equal((await invoke(h.handler, '/nope')).status, 404);
  assert.equal(
    (await invoke(h.handler, `/tiles/fog/${T15}/0/0/0.png`)).status,
    400,
  );
  assert.equal(
    (await invoke(h.handler, `/tiles/air-quality/${H16}/0/0/0.jpg`)).status,
    400,
  );
  assert.equal(
    (await invoke(h.handler, `/tiles/air-quality/${H16}/2/1/1.png`)).status,
    502,
  );
});

test('the Google tile budget counts upstream fetches and blocks with a 429 once exhausted', async () => {
  const h = harness({ googleTileBudget: 2 });
  const route = (xy) => `/tiles/air-quality/${H16}/3/${xy}/2.png`;
  assert.equal((await invoke(h.handler, route(1))).status, 200);
  assert.equal((await invoke(h.handler, route(2))).status, 200);
  assert.equal(h.net.count('US_AQI'), 2, 'two upstream fetches, budget = 2');

  const blocked = await invoke(h.handler, route(3));
  assert.equal(blocked.status, 429);
  assert.deepEqual(blocked.json(), { error: 'google tile budget reached' });
  assert.ok(
    Number(blocked.headers['Retry-After']) > 0,
    'Retry-After counts seconds to UTC midnight',
  );
  assert.equal(
    h.net.count('US_AQI'),
    2,
    'the blocked request never reached upstream',
  );

  // Pollen shares the same server-wide counter.
  const pollenBlocked = await invoke(
    h.handler,
    `/tiles/pollen-tree/${H16}/3/1/2.png`,
  );
  assert.equal(pollenBlocked.status, 429);
  assert.equal(h.net.count('googleapis.com'), 2);
});

test('the manifest reports the budget-exhausted reason for every mode', async () => {
  const h = harness({ googleTileBudget: 1 });
  await invoke(h.handler, `/tiles/air-quality/${H16}/3/1/2.png`);
  assert.deepEqual(
    (await invoke(h.handler, '/manifest?mode=air-quality')).json(),
    {
      mode: 'air-quality',
      googleConfigured: true,
      available: false,
      reason: GOOGLE_TILE_BUDGET_REASON,
      time: null,
      stale: false,
    },
  );
  assert.equal(
    GOOGLE_TILE_BUDGET_REASON,
    'Google overlay tile budget reached for today',
  );
  assert.deepEqual(
    (await invoke(h.handler, '/manifest?mode=pollen-grass')).json(),
    {
      mode: 'pollen-grass',
      googleConfigured: true,
      available: false,
      reason: GOOGLE_TILE_BUDGET_REASON,
      time: null,
      stale: false,
    },
  );
});

test('the Google tile budget resets at the UTC day boundary', async () => {
  const h = harness({ googleTileBudget: 1 });
  const day1Now = Date.UTC(2026, 8, 14, 23, 50);
  const day1Time = Math.floor(day1Now / 3_600_000) * 3_600_000;
  h.clock.now = day1Now;
  assert.equal(
    (await invoke(h.handler, `/tiles/air-quality/${day1Time}/3/1/2.png`))
      .status,
    200,
  );
  assert.equal(
    (await invoke(h.handler, `/tiles/air-quality/${day1Time}/3/1/2.png`))
      .status,
    429,
    'exhausted for the rest of day 1',
  );

  const day2Now = Date.UTC(2026, 8, 15, 0, 10);
  const day2Time = Math.floor(day2Now / 3_600_000) * 3_600_000;
  h.clock.now = day2Now;
  assert.equal(
    (await invoke(h.handler, `/tiles/air-quality/${day2Time}/3/1/2.png`))
      .status,
    200,
    'a new UTC day resets the counter',
  );
  assert.equal(h.net.count('US_AQI'), 2);
});

test('googleDailyBudgetFromEnv reads a positive integer, else the default', () => {
  assert.equal(
    googleDailyBudgetFromEnv({ GEV_GOOGLE_OVERLAY_TILES_PER_DAY: '500' }),
    500,
  );
  assert.equal(googleDailyBudgetFromEnv({}), DEFAULT_GOOGLE_TILE_BUDGET);
  assert.equal(DEFAULT_GOOGLE_TILE_BUDGET, 25_000);
  for (const bad of ['0', '-5', 'abc', '', undefined, null]) {
    assert.equal(
      googleDailyBudgetFromEnv({ GEV_GOOGLE_OVERLAY_TILES_PER_DAY: bad }),
      DEFAULT_GOOGLE_TILE_BUDGET,
      `falls back for ${JSON.stringify(bad)}`,
    );
  }
});

test('the plugin is registered in the Vite config at /api/weather-overlays', () => {
  const plugin = createViteConfig({ mode: 'test' }).plugins.find(
    (p) => p.name === 'weather-overlays-proxy',
  );
  assert.ok(plugin, 'weather-overlays-proxy must be registered');
  const routes = new Map();
  plugin.configureServer({
    middlewares: { use: (route, handler) => routes.set(route, handler) },
  });
  assert.equal(typeof routes.get('/api/weather-overlays'), 'function');
});
