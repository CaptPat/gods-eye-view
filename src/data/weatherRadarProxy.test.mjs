// src/data/weatherRadarProxy.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import createViteConfig from '../../vite.config.js';
import {
  IEM_TTL_MS,
  RAINVIEWER_CACHE_GRACE_MS,
  createWeatherRadarHandler,
} from '../../server/providers/weather-radar.js';
import { iemCacheKey } from '../../server/providers/weather-radar/sources.js';

const MANIFEST = JSON.parse(
  readFileSync(
    new URL('./fixtures/rainviewer-weather-maps.json', import.meta.url),
    'utf8',
  ),
);
const NEWEST_MS = 1789360800 * 1000;
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001', 'hex');
const MINUTE = 60_000;

async function tempDir(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gev-radar-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** Route by URL substring; count calls per route; a function answer may throw. */
function upstream(routes) {
  const calls = [];
  const fetchImpl = async (url) => {
    const href = String(url);
    calls.push(href);
    for (const [match, answer] of routes) {
      if (!href.includes(match)) continue;
      const value = typeof answer === 'function' ? await answer(href) : answer;
      if (value instanceof Response) return value;
      return Response.json(value);
    }
    throw new Error(`unexpected upstream ${href}`);
  };
  return {
    fetchImpl,
    calls,
    count: (match) => calls.filter((href) => href.includes(match)).length,
  };
}

const png = () =>
  new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });

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

test('the RainViewer frame list hides upstream paths and caches the manifest for two minutes', async (t) => {
  let clock = NEWEST_MS + 5 * MINUTE;
  const net = upstream([['weather-maps.json', MANIFEST]]);
  const handler = createWeatherRadarHandler({
    fetchImpl: net.fetchImpl,
    cacheDir: await tempDir(t),
    now: () => clock,
    limiter: () => true,
    log: () => {},
  });
  const first = await invoke(handler, '/frames?source=rainviewer');
  assert.equal(first.status, 200);
  const body = first.json();
  assert.equal(body.source, 'rainviewer');
  assert.equal(body.stale, false);
  assert.equal(body.frames.length, 13);
  assert.deepEqual(body.frames.at(-1), { time: NEWEST_MS });
  assert.doesNotMatch(
    first.buffer.toString(),
    /fixture|tilecache/,
    'upstream host and paths stay server-side',
  );
  await invoke(handler, '/frames');
  assert.equal(net.count('weather-maps.json'), 1);
  clock += 121_000;
  await invoke(handler, '/frames');
  assert.equal(net.count('weather-maps.json'), 2);
});

test('IEM frames are 13 synthesized ten-minute boundaries', async (t) => {
  const now = Date.UTC(2026, 8, 14, 4, 57, 30);
  const handler = createWeatherRadarHandler({
    fetchImpl: upstream([]).fetchImpl,
    cacheDir: await tempDir(t),
    now: () => now,
    limiter: () => true,
    log: () => {},
  });
  const body = (await invoke(handler, '/frames?source=iem')).json();
  assert.equal(body.source, 'iem');
  assert.equal(body.frames.length, 13);
  assert.deepEqual(body.frames.at(-1), { time: Date.UTC(2026, 8, 14, 4, 50) });
});

test('a failed manifest refresh serves the last good list as stale; with no list it is 502', async (t) => {
  let clock = NEWEST_MS + 5 * MINUTE;
  let up = true;
  const net = upstream([
    [
      'weather-maps.json',
      () => {
        if (!up) throw new Error('offline');
        return MANIFEST;
      },
    ],
  ]);
  const handler = createWeatherRadarHandler({
    fetchImpl: net.fetchImpl,
    cacheDir: await tempDir(t),
    now: () => clock,
    limiter: () => true,
    log: () => {},
  });
  await invoke(handler, '/frames');
  up = false;
  clock += 121_000;
  const stale = await invoke(handler, '/frames');
  assert.equal(stale.status, 200);
  assert.equal(stale.json().stale, true);
  assert.equal(stale.json().frames.length, 13);

  const cold = createWeatherRadarHandler({
    fetchImpl: net.fetchImpl,
    cacheDir: await tempDir(t),
    now: () => clock,
    limiter: () => true,
    log: () => {},
  });
  const failed = await invoke(cold, '/frames');
  assert.equal(failed.status, 502);
  assert.deepEqual(failed.json(), { error: 'upstream unavailable' });
});

test('RainViewer tiles are validated, fetched once, cached, and failures are never cached', async (t) => {
  const cacheDir = await tempDir(t);
  let failTile = true;
  const net = upstream([
    ['weather-maps.json', MANIFEST],
    [
      '/256/4/3/7/',
      () => (failTile ? new Response('busy', { status: 503 }) : png()),
    ],
    ['/256/4/3/6/', png],
  ]);
  const handler = createWeatherRadarHandler({
    fetchImpl: net.fetchImpl,
    cacheDir,
    now: () => NEWEST_MS + 5 * MINUTE,
    limiter: () => true,
    tileLimiter: () => true,
    log: () => {},
  });
  const route = `/rainviewer/${NEWEST_MS}/4/3/6.png`;

  const miss = await invoke(handler, route);
  assert.equal(miss.status, 200);
  assert.equal(miss.headers['Content-Type'], 'image/png');
  assert.equal(miss.headers['X-Radar-Cache'], 'MISS');
  assert.ok(
    net.calls.includes(
      'https://tilecache.rainviewer.com/v2/radar/fixture12/256/4/3/6/2/1_1.png',
    ),
  );
  await stat(
    path.join(cacheDir, 'rainviewer', String(NEWEST_MS), '4', '3', '6.png'),
  );

  const hit = await invoke(handler, route);
  assert.equal(hit.headers['X-Radar-Cache'], 'HIT');
  assert.equal(net.count('/256/4/3/6/'), 1);

  assert.equal(
    (await invoke(handler, `/rainviewer/${NEWEST_MS}/8/0/0.png`)).status,
    400,
  );
  assert.equal(
    (await invoke(handler, `/rainviewer/${NEWEST_MS}/4/3/6.jpg`)).status,
    400,
  );
  assert.equal(
    (await invoke(handler, '/rainviewer/123/4/3/6.png')).status,
    404,
  );

  assert.equal(
    (await invoke(handler, `/rainviewer/${NEWEST_MS}/4/3/7.png`)).status,
    502,
  );
  failTile = false;
  assert.equal(
    (await invoke(handler, `/rainviewer/${NEWEST_MS}/4/3/7.png`)).status,
    200,
  );
  assert.equal(net.count('/256/4/3/7/'), 2, 'the failed tile was not cached');
});

test('IEM images use the time-aware layer and cache recent frames 5 minutes, older frames 24 hours', async (t) => {
  const cacheDir = await tempDir(t);
  const nowMs = Date.now();
  const boundary = (ms) => Math.floor(ms / (5 * MINUTE)) * 5 * MINUTE;
  const iso = (ms) => `${new Date(ms).toISOString().slice(0, 16)}:00Z`;
  const net = upstream([['n0q-t.cgi', png]]);
  const handler = createWeatherRadarHandler({
    fetchImpl: net.fetchImpl,
    cacheDir,
    now: () => nowMs,
    limiter: () => true,
    tileLimiter: () => true,
    log: () => {},
  });
  const query = (ms) => ({
    time: iso(ms),
    bbox: [-100, 28, -94, 34],
    width: 256,
    height: 256,
  });
  const route = (q) =>
    `/iem?time=${q.time}&bbox=${q.bbox.join(',')}&width=${q.width}&height=${q.height}`;

  assert.equal(
    (
      await invoke(
        handler,
        '/iem?time=bad&bbox=-100,28,-94,34&width=256&height=256',
      )
    ).status,
    400,
  );

  const recent = query(boundary(nowMs - 5 * MINUTE));
  assert.equal(
    (await invoke(handler, route(recent))).headers['X-Radar-Cache'],
    'MISS',
  );
  const upstreamUrl = new URL(net.calls.at(-1));
  assert.equal(upstreamUrl.pathname, '/cgi-bin/wms/nexrad/n0q-t.cgi');
  assert.equal(upstreamUrl.searchParams.get('layers'), 'nexrad-n0q-wmst');
  assert.equal(
    (await invoke(handler, route(recent))).headers['X-Radar-Cache'],
    'HIT',
  );

  const sixMinutesAgo = new Date(nowMs - 6 * MINUTE);
  await utimes(
    path.join(cacheDir, 'iem', `${iemCacheKey(recent)}.png`),
    sixMinutesAgo,
    sixMinutesAgo,
  );
  assert.equal(
    (await invoke(handler, route(recent))).headers['X-Radar-Cache'],
    'MISS',
    'recent frames expire after 5 minutes',
  );

  const older = query(boundary(nowMs - 60 * MINUTE));
  await invoke(handler, route(older));
  await utimes(
    path.join(cacheDir, 'iem', `${iemCacheKey(older)}.png`),
    sixMinutesAgo,
    sixMinutesAgo,
  );
  assert.equal(
    (await invoke(handler, route(older))).headers['X-Radar-Cache'],
    'HIT',
    'older frames keep for 24 hours',
  );
});

test('the IEM disk cache is pruned at most once per hour', async (t) => {
  const cacheDir = await tempDir(t);
  const iemDir = path.join(cacheDir, 'iem');
  await mkdir(iemDir, { recursive: true });

  const oldFile = path.join(iemDir, 'old-frame.png');
  const freshFile = path.join(iemDir, 'fresh-frame.png');
  await writeFile(oldFile, PNG);
  await writeFile(freshFile, PNG);
  let clock = Date.UTC(2026, 8, 14, 5, 0, 0);
  const beyondTtl = new Date(clock - IEM_TTL_MS - MINUTE);
  await utimes(oldFile, beyondTtl, beyondTtl);

  const net = upstream([['n0q-t.cgi', png]]);
  const handler = createWeatherRadarHandler({
    fetchImpl: net.fetchImpl,
    cacheDir,
    now: () => clock,
    limiter: () => true,
    tileLimiter: () => true,
    log: () => {},
  });
  const query = {
    time: '2026-09-14T04:30:00Z',
    bbox: [-100, 28, -94, 34],
    width: 256,
    height: 256,
  };
  const route = `/iem?time=${query.time}&bbox=${query.bbox.join(',')}&width=${query.width}&height=${query.height}`;

  await invoke(handler, route);
  await assert.rejects(
    () => stat(oldFile),
    /ENOENT/,
    'a file older than IEM_TTL_MS was pruned on the next IEM request',
  );
  await stat(freshFile); // still present, no error thrown

  // A second, still-old file placed after the first prune is not swept again
  // within the hour.
  const secondOldFile = path.join(iemDir, 'old-frame-2.png');
  await writeFile(secondOldFile, PNG);
  await utimes(secondOldFile, beyondTtl, beyondTtl);
  clock += 10 * MINUTE;
  await invoke(handler, route);
  await stat(secondOldFile); // not yet pruned — under an hour since the scan

  clock += 55 * MINUTE; // now over an hour since the first prune
  await invoke(handler, route);
  await assert.rejects(
    () => stat(secondOldFile),
    /ENOENT/,
    'pruning resumes once an hour has passed',
  );
});

test('the RainViewer disk cache is pruned once a time drops out of the manifest', async (t) => {
  const cacheDir = await tempDir(t);
  const oldestFrameMs = 1789353600 * 1000; // the fixture manifest's oldest frame
  const staleDir = path.join(
    cacheDir,
    'rainviewer',
    String(oldestFrameMs - RAINVIEWER_CACHE_GRACE_MS - MINUTE),
  );
  const keptDir = path.join(cacheDir, 'rainviewer', String(oldestFrameMs));
  await mkdir(path.join(staleDir, '4', '3'), { recursive: true });
  await writeFile(path.join(staleDir, '4', '3', '6.png'), PNG);
  await mkdir(path.join(keptDir, '4', '3'), { recursive: true });
  await writeFile(path.join(keptDir, '4', '3', '6.png'), PNG);

  const net = upstream([['weather-maps.json', MANIFEST]]);
  const handler = createWeatherRadarHandler({
    fetchImpl: net.fetchImpl,
    cacheDir,
    now: () => NEWEST_MS + 5 * MINUTE,
    limiter: () => true,
    tileLimiter: () => true,
    log: () => {},
  });

  await invoke(handler, '/frames'); // triggers the manifest refresh and its prune

  await assert.rejects(
    () => stat(staleDir),
    /ENOENT/,
    'a directory older than the oldest frame minus the grace window was pruned',
  );
  await stat(keptDir); // still present, no error thrown
});

test('rate limits, methods, unknown paths and non-PNG bodies', async (t) => {
  const cacheDir = await tempDir(t);
  const limited = createWeatherRadarHandler({
    fetchImpl: upstream([]).fetchImpl,
    cacheDir,
    limiter: () => false,
    log: () => {},
  });
  const refused = await invoke(limited, '/frames?source=iem');
  assert.equal(refused.status, 429);
  assert.equal(refused.headers['Retry-After'], '10');

  const net = upstream([
    ['weather-maps.json', MANIFEST],
    ['/256/', () => new Response('<html>not a tile</html>', { status: 200 })],
  ]);
  const handler = createWeatherRadarHandler({
    fetchImpl: net.fetchImpl,
    cacheDir,
    now: () => NEWEST_MS,
    limiter: () => true,
    log: () => {},
  });
  assert.equal((await invoke(handler, '/frames', 'POST')).status, 405);
  assert.equal((await invoke(handler, '/nope')).status, 404);
  assert.equal(
    (await invoke(handler, `/rainviewer/${NEWEST_MS}/2/1/1.png`)).status,
    502,
  );
});

test('the tile limiter and the frames limiter throttle independently', async (t) => {
  const net = upstream([
    ['weather-maps.json', MANIFEST],
    ['/256/4/3/6/', png],
  ]);

  const tilesRefused = createWeatherRadarHandler({
    fetchImpl: net.fetchImpl,
    cacheDir: await tempDir(t),
    now: () => NEWEST_MS + 5 * MINUTE,
    limiter: () => true,
    tileLimiter: () => false,
    log: () => {},
  });
  const refusedTile = await invoke(
    tilesRefused,
    `/rainviewer/${NEWEST_MS}/4/3/6.png`,
  );
  assert.equal(refusedTile.status, 429);
  assert.equal(refusedTile.headers['Retry-After'], '10');
  assert.equal(
    (await invoke(tilesRefused, '/frames')).status,
    200,
    'the frames limiter is unaffected by a refused tile limiter',
  );

  const framesRefused = createWeatherRadarHandler({
    fetchImpl: net.fetchImpl,
    cacheDir: await tempDir(t),
    now: () => NEWEST_MS + 5 * MINUTE,
    limiter: () => false,
    tileLimiter: () => true,
    log: () => {},
  });
  const refusedFrames = await invoke(framesRefused, '/frames');
  assert.equal(refusedFrames.status, 429);
  assert.equal(refusedFrames.headers['Retry-After'], '10');
  assert.equal(
    (await invoke(framesRefused, `/rainviewer/${NEWEST_MS}/4/3/6.png`)).status,
    200,
    'the tile limiter is unaffected by a refused frames limiter',
  );
});

test('the plugin is registered in the Vite config at /api/radar', () => {
  const plugin = createViteConfig({ mode: 'test' }).plugins.find(
    (p) => p.name === 'weather-radar-proxy',
  );
  assert.ok(plugin, 'weather-radar-proxy must be registered');
  const routes = new Map();
  plugin.configureServer({
    middlewares: { use: (route, handler) => routes.set(route, handler) },
  });
  assert.equal(typeof routes.get('/api/radar'), 'function');
});
