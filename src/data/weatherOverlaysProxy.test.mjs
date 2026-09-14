import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import createViteConfig from '../../vite.config.js';
import {
  CAPABILITIES_TTL_MS,
  GOOGLE_TILE_TTL_MS,
  GRID_TTL_MS,
  createTileCache,
  createWeatherOverlaysHandler,
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
} = {}) {
  const clock = { now: NOW };
  const logs = [];
  const down = { capabilities: false, grid: false };
  const net = upstream([
    ...routes,
    [
      'GetCapabilities',
      () => {
        if (down.capabilities) throw new Error('offline');
        return new Response(text('gmgsi-capabilities.xml'));
      },
    ],
    ['request=GetMap', pngResponse('gmgsi-longwave-tile.png')],
    [
      'ncep_global.csvp',
      () => {
        if (down.grid) throw new Error('offline');
        return new Response(text('gfs-tmp2m-30deg.csv'));
      },
    ],
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
  });
  return { handler, net, logs, clock, down };
}

test('manifests: newest GMGSI time, nearest GFS step, and the current hour for Google modes', async () => {
  const h = harness();
  const clouds = await invoke(h.handler, '/manifest?mode=clouds');
  assert.equal(clouds.status, 200);
  assert.deepEqual(clouds.json(), {
    mode: 'clouds',
    googleConfigured: true,
    available: true,
    time: T15,
    stale: false,
  });

  const temperature = await invoke(h.handler, '/manifest?mode=temperature');
  assert.deepEqual(temperature.json(), {
    mode: 'temperature',
    googleConfigured: true,
    available: true,
    time: T15,
    stale: false,
  });
  await invoke(h.handler, '/manifest?mode=temperature');
  assert.equal(
    h.net.count('ncep_global.csvp'),
    1,
    'the grid is held for an hour',
  );
  assert.ok(
    h.net.calls.some((href) =>
      href.includes('tmp2m%5B(2026-09-14T15:00:00Z)%5D'),
    ),
  );

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

test('without a Google key the Google modes are unavailable and their tiles 404; NOAA modes still work', async () => {
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
  const clouds = (await invoke(h.handler, '/manifest?mode=clouds')).json();
  assert.equal(clouds.available, true);
  assert.equal(clouds.googleConfigured, false);
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
  assert.equal(miss.headers['X-Overlay-Cache'], 'MISS');
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
  const second = await invoke(h.handler, route);
  assert.equal(
    second.headers['X-Overlay-Cache'],
    'MISS',
    'an identical request is still a MISS: Google tiles are never cached',
  );
  assert.equal(h.net.count('US_AQI'), 2);
  assert.equal(GOOGLE_TILE_TTL_MS, 0);

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

test('cloud tiles are served only for advertised GMGSI times; capabilities refresh every ten minutes and go stale on failure', async () => {
  const h = harness();
  const route = `/tiles/clouds/${T15}/7/30/53.png`;
  const miss = await invoke(h.handler, route);
  assert.equal(miss.status, 200);
  assert.ok(miss.buffer.equals(bytes('gmgsi-longwave-tile.png')));
  assert.equal(miss.headers['Cache-Control'], 'private, max-age=600');
  const getMap = new URL(
    h.net.calls.find((href) => href.includes('request=GetMap')),
  );
  assert.equal(getMap.searchParams.get('time'), '2026-09-14T15:00:00Z');
  assert.equal(
    getMap.searchParams.get('layers'),
    'global_longwave_imagery_mosaic',
  );
  assert.equal(
    (await invoke(h.handler, route)).headers['X-Overlay-Cache'],
    'HIT',
  );
  assert.equal(
    (
      await invoke(
        h.handler,
        `/tiles/clouds/${Date.UTC(2026, 8, 14, 9)}/7/30/53.png`,
      )
    ).status,
    404,
  );
  assert.equal(
    (await invoke(h.handler, `/tiles/clouds/${T15}/8/0/0.png`)).status,
    400,
    'zoom 8 is beyond the cloud cap',
  );
  assert.equal(h.net.count('GetCapabilities'), 1);

  h.down.capabilities = true;
  h.clock.now += CAPABILITIES_TTL_MS + 1;
  assert.deepEqual((await invoke(h.handler, '/manifest?mode=clouds')).json(), {
    mode: 'clouds',
    googleConfigured: true,
    available: true,
    time: T15,
    stale: true,
  });

  const cold = harness();
  cold.down.capabilities = true;
  const failed = await invoke(cold.handler, '/manifest?mode=clouds');
  assert.equal(failed.status, 502);
  assert.deepEqual(failed.json(), {
    error: 'upstream unavailable',
    googleConfigured: true,
  });
});

test('temperature tiles are rendered from the GFS grid; a failed refresh falls back to the held grid as stale', async () => {
  const h = harness();
  const route = `/tiles/temperature/${T15}/0/0/0.png`;
  const miss = await invoke(h.handler, route);
  assert.equal(miss.status, 200);
  assert.equal(miss.headers['X-Overlay-Cache'], 'MISS');
  assert.equal(miss.buffer.subarray(1, 4).toString('ascii'), 'PNG');
  assert.deepEqual(
    [miss.buffer.readUInt32BE(16), miss.buffer.readUInt32BE(20)],
    [256, 256],
  );
  assert.equal(
    (await invoke(h.handler, route)).headers['X-Overlay-Cache'],
    'HIT',
  );
  assert.equal(
    (
      await invoke(
        h.handler,
        `/tiles/temperature/${Date.UTC(2026, 8, 14, 14)}/0/0/0.png`,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await invoke(
        h.handler,
        `/tiles/temperature/${Date.UTC(2026, 8, 15, 3)}/0/0/0.png`,
      )
    ).status,
    404,
  );
  assert.equal(
    (await invoke(h.handler, `/tiles/temperature/${T15}/7/0/0.png`)).status,
    400,
  );

  h.down.grid = true;
  h.clock.now += GRID_TTL_MS + 1;
  assert.deepEqual(
    (await invoke(h.handler, '/manifest?mode=temperature')).json(),
    {
      mode: 'temperature',
      googleConfigured: true,
      available: true,
      time: T15,
      stale: true,
    },
  );

  const cold = harness();
  cold.down.grid = true;
  assert.equal(
    (await invoke(cold.handler, '/manifest?mode=temperature')).status,
    502,
  );
});

test('manifest and tile rate limits are separate; methods, unknown paths and non-PNG bodies', async () => {
  const manifestLimited = harness({ limiter: () => false });
  const refused = await invoke(
    manifestLimited.handler,
    '/manifest?mode=clouds',
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
    (await invoke(tileLimited.handler, '/manifest?mode=clouds')).status,
    200,
  );

  const h = harness({
    routes: [['request=GetMap', () => new Response('<html>not a tile</html>')]],
  });
  assert.equal(
    (await invoke(h.handler, '/manifest?mode=clouds', 'POST')).status,
    405,
  );
  assert.equal((await invoke(h.handler, '/nope')).status, 404);
  assert.equal(
    (await invoke(h.handler, `/tiles/fog/${T15}/0/0/0.png`)).status,
    400,
  );
  assert.equal(
    (await invoke(h.handler, `/tiles/clouds/${T15}/0/0/0.jpg`)).status,
    400,
  );
  assert.equal(
    (await invoke(h.handler, `/tiles/clouds/${T15}/2/1/1.png`)).status,
    502,
  );
});

test('the tile cache evicts the oldest entry past its limit and prunes by age', () => {
  const cache = createTileCache(2);
  const one = Buffer.from('1');
  cache.set('a', one, 0, 100);
  cache.set('b', one, 0, 1000);
  cache.set('c', one, 0, 1000);
  assert.equal(cache.get('a', 1), null, 'evicted');
  assert.equal(cache.size(), 2);
  assert.equal(cache.get('b', 1000), one);
  assert.equal(cache.get('b', 1001), null, 'expired on read');
  cache.prune(5000);
  assert.equal(cache.size(), 0);
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
