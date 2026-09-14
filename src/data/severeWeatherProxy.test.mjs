// src/data/severeWeatherProxy.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import createViteConfig from '../../vite.config.js';
import {
  GDACS_TTL_MS,
  NWS_TTL_MS,
  RESPONSE_BUDGET_MS,
  STALE_MAX_MS,
  ZONE_BACKOFF_MS,
  ZONE_TTL_MS,
  createSevereWeatherHandler,
} from '../../server/providers/severe-weather.js';

const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`./fixtures/severe-weather/${name}`, import.meta.url),
      'utf8',
    ),
  );
const ALERTS = fixture('nws-alerts-active.json');
const ZONES = fixture('nws-zones.json');
const EVENTS = fixture('gdacs-events4app.json');
const CYCLONES = fixture('gdacs-map-tc.json');
const ZONE_PREFIX = 'https://api.weather.gov/zones/';
const MINUTE = 60_000;

async function tempDir(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gev-severe-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** Answers every upstream from fixtures; `overrides` maps a URL substring to a Response factory. */
function upstream(overrides = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const href = String(url);
    calls.push({ href, headers: init?.headers ?? {} });
    for (const [match, answer] of Object.entries(overrides)) {
      if (href.includes(match)) return answer(href);
    }
    if (href === 'https://api.weather.gov/alerts/active')
      return Response.json(ALERTS);
    if (href.startsWith(ZONE_PREFIX)) {
      const zone = ZONES[href.slice(ZONE_PREFIX.length)];
      return zone ? Response.json(zone) : new Response('{}', { status: 404 });
    }
    if (href.endsWith('/EVENTS4APP')) return Response.json(EVENTS);
    if (href.endsWith('/MAP?eventtype=TC')) return Response.json(CYCLONES);
    throw new Error(`unexpected upstream ${href}`);
  };
  const count = (match) =>
    calls.filter((call) => call.href.includes(match)).length;
  return { fetchImpl, calls, count };
}

function invoke(handler, url = '/', method = 'GET') {
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
        resolve({
          status: this.status,
          headers: this.headers,
          json: () => JSON.parse(String(body)),
        });
      },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

function makeHandler(net, cacheDir, clock, extra = {}) {
  return createSevereWeatherHandler({
    fetchImpl: net.fetchImpl,
    cacheDir,
    now: () => clock.now,
    limiter: () => true,
    log: () => {},
    ...extra,
  });
}

/**
 * Poll the handler until `predicate(body)` holds or `timeoutMs` elapses
 * (generous, since a background refresh's completion is real wall-clock
 * work — disk I/O for zones, an upstream fetch settling — and must not be
 * pinned to a fixed sleep that flakes under a loaded test run).
 */
async function waitFor(handler, predicate, { timeoutMs = 5000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const body = (await invoke(handler)).json();
    if (predicate(body)) return body;
    if (Date.now() >= deadline) return body;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

test('one request merges NWS alerts with resolved zone shapes and GDACS events with cyclone shapes', async (t) => {
  const cacheDir = await tempDir(t);
  const net = upstream();
  const clock = { now: Date.now() };
  const response = await invoke(makeHandler(net, cacheDir, clock));
  assert.equal(response.status, 200);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  const body = response.json();
  assert.equal(body.generatedAt, clock.now);
  assert.equal(body.nws.status, 'ok');
  assert.equal(body.nws.updatedAt, Date.parse('2026-09-14T16:05:29+00:00'));
  assert.equal(body.nws.alerts.length, 6);
  assert.deepEqual(
    Object.keys(body.nws.zones).sort(),
    Object.keys(ZONES).sort(),
  );
  assert.equal(body.nws.unmappedAlerts, 0);
  assert.equal(
    net.count('/zones/county/MDC031'),
    0,
    "the Test Message's zone is never fetched",
  );
  assert.equal(net.count(ZONE_PREFIX), 9);
  for (const call of net.calls) {
    assert.equal(
      call.headers['User-Agent'],
      'CyclopsView/0.1 (+https://github.com/CaptPat/gods-eye-view)',
    );
  }
  assert.equal(body.gdacs.status, 'ok');
  assert.deepEqual(
    body.gdacs.events.map((event) => event.id),
    [
      'TC-1001320',
      'TC-1001321',
      'FL-1103888',
      'DR-1023877',
      'DR-1018431',
      'WF-1031964',
    ],
  );
  assert.equal(body.gdacs.events[1].track[0].length, 11);
  assert.equal((await readdir(path.join(cacheDir, 'zones'))).length, 9);
});

test('sources refresh on their own cadence; zone shapes come from memory, then disk, until 7 days old', async (t) => {
  const cacheDir = await tempDir(t);
  const net = upstream();
  const clock = { now: Date.now() };
  const handler = makeHandler(net, cacheDir, clock);
  await invoke(handler);
  await invoke(handler);
  assert.equal(
    net.count('/alerts/active'),
    1,
    'a second request inside five minutes reuses the snapshot',
  );

  clock.now += NWS_TTL_MS;
  await invoke(handler);
  assert.equal(net.count('/alerts/active'), 2);
  assert.equal(net.count('/EVENTS4APP'), 1, 'GDACS refreshes every 15 minutes');
  assert.equal(net.count(ZONE_PREFIX), 9, 'zone shapes are not refetched');
  clock.now += GDACS_TTL_MS;
  await invoke(handler);
  assert.equal(net.count('/EVENTS4APP'), 2);

  const coldNet = upstream();
  const cold = makeHandler(coldNet, cacheDir, clock);
  assert.equal(Object.keys((await invoke(cold)).json().nws.zones).length, 9);
  assert.equal(
    coldNet.count(ZONE_PREFIX),
    0,
    'a restarted proxy reads zone shapes from disk',
  );

  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * MINUTE);
  await utimes(
    path.join(cacheDir, 'zones', 'forecast_AKZ844.json'),
    eightDaysAgo,
    eightDaysAgo,
  );
  const agedNet = upstream();
  await invoke(makeHandler(agedNet, cacheDir, clock));
  assert.equal(agedNet.count(ZONE_PREFIX), 1);
  assert.equal(
    agedNet.count('/zones/forecast/AKZ844'),
    1,
    'only the expired shape is refetched',
  );
  assert.ok(ZONE_TTL_MS === 7 * 24 * 60 * MINUTE);
});

test('the zone cache prunes shapes older than 7 days on the first refresh', async (t) => {
  const cacheDir = await tempDir(t);
  await mkdir(path.join(cacheDir, 'zones'), { recursive: true });
  const old = path.join(cacheDir, 'zones', 'forecast_XXZ999.json');
  await writeFile(old, '[]');
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * MINUTE);
  await utimes(old, eightDaysAgo, eightDaysAgo);
  await invoke(makeHandler(upstream(), cacheDir, { now: Date.now() }));
  const names = await readdir(path.join(cacheDir, 'zones'));
  assert.equal(names.includes('forecast_XXZ999.json'), false);
  assert.equal(names.length, 9);
});

test('a 429 on a zone backs off the remaining zones and reports unmapped alerts until it clears', async (t) => {
  const cacheDir = await tempDir(t);
  let throttled = true;
  const net = upstream({
    '/zones/forecast/AKZ830': () =>
      throttled
        ? new Response('slow down', { status: 429 })
        : Response.json(ZONES['forecast/AKZ830']),
  });
  const clock = { now: Date.now() };
  const handler = makeHandler(net, cacheDir, clock, { zoneConcurrency: 1 });
  const first = (await invoke(handler)).json();
  assert.equal(
    net.count(ZONE_PREFIX),
    3,
    'AKZ843, AKZ844, then the throttled AKZ830 stops the queue',
  );
  assert.deepEqual(Object.keys(first.nws.zones).sort(), [
    'forecast/AKZ843',
    'forecast/AKZ844',
  ]);
  assert.equal(
    first.nws.unmappedAlerts,
    3,
    'Wind Advisory, Red Flag Warning and Heat Advisory have no shape yet',
  );
  assert.ok(
    ZONE_BACKOFF_MS < NWS_TTL_MS,
    'the backoff ends the round; the next refresh retries',
  );

  throttled = false;
  clock.now += NWS_TTL_MS;
  // NWS data is still servable, so this call returns immediately and the
  // retry runs in the background (real disk I/O for the remaining zones);
  // poll until it settles rather than pinning a fixed sleep.
  const later = await waitFor(handler, (body) => body.nws.unmappedAlerts === 0);
  assert.equal(later.nws.unmappedAlerts, 0);
  assert.equal(Object.keys(later.nws.zones).length, 9);
});

test('zone resolution stops at its deadline and leaves the rest for the next refresh', async (t) => {
  const net = upstream();
  const body = (
    await invoke(
      makeHandler(
        net,
        await tempDir(t),
        { now: Date.now() },
        { zoneDeadlineMs: 0 },
      ),
    )
  ).json();
  assert.equal(net.count(ZONE_PREFIX), 0);
  assert.deepEqual(body.nws.zones, {});
  assert.equal(
    body.nws.unmappedAlerts,
    5,
    'only the Special Weather Statement carries its own polygon',
  );
});

test('a failed source is served stale for an hour, then unavailable; both unavailable is 502', async (t) => {
  let nwsUp = true;
  let gdacsUp = true;
  const net = upstream({
    '/alerts/active': () =>
      nwsUp ? Response.json(ALERTS) : new Response('down', { status: 503 }),
    '/EVENTS4APP': () =>
      gdacsUp ? Response.json(EVENTS) : new Response('down', { status: 500 }),
  });
  const clock = { now: Date.now() };
  const handler = makeHandler(net, await tempDir(t), clock);
  await invoke(handler);

  nwsUp = false;
  clock.now += NWS_TTL_MS;
  // Data is still servable at this instant, so this response is immediate
  // and reflects the pre-refresh state; the failing refresh runs in the
  // background. Poll until it settles rather than pinning a fixed sleep.
  const stale = await waitFor(handler, (body) => body.nws.status === 'stale');
  assert.equal(stale.nws.status, 'stale');
  assert.equal(stale.nws.alerts.length, 6);
  assert.equal(stale.gdacs.status, 'ok');

  clock.now += STALE_MAX_MS;
  const expired = (await invoke(handler)).json();
  assert.equal(expired.nws.status, 'unavailable');
  assert.deepEqual(expired.nws.alerts, []);
  assert.equal(
    expired.gdacs.status,
    'ok',
    'GDACS refreshed on its own cadence',
  );

  gdacsUp = false;
  const cold = makeHandler(net, await tempDir(t), clock);
  const failed = await invoke(cold);
  assert.equal(failed.status, 502);
  assert.deepEqual(failed.json(), {
    error: 'Severe weather sources unavailable',
  });
});

test('GDACS events survive a cyclone-map failure without shapes', async (t) => {
  const net = upstream({
    '/MAP?eventtype=TC': () => new Response('down', { status: 500 }),
  });
  const body = (
    await invoke(makeHandler(net, await tempDir(t), { now: Date.now() }))
  ).json();
  assert.equal(body.gdacs.status, 'ok');
  assert.equal(body.gdacs.events.length, 6);
  assert.deepEqual(body.gdacs.events[1].track, []);
});

test('a slow or unreachable source does not delay one that already answered', async (t) => {
  assert.equal(RESPONSE_BUDGET_MS, 25_000);
  const cacheDir = await tempDir(t);
  let releaseGdacs = () => {};
  const gate = new Promise((resolve) => {
    releaseGdacs = resolve;
  });
  t.after(releaseGdacs);
  const net = upstream({
    '/EVENTS4APP': async () => {
      await gate;
      return Response.json(EVENTS);
    },
  });
  const clock = { now: Date.now() };
  // A generous budget: NWS still has to resolve 9 zones over real disk I/O
  // on a cold build, which can take a while under a loaded test run. GDACS
  // never resolves at all, so any bounded completion proves the fix — the
  // pre-fix behaviour was an unbounded wait on GDACS.
  const handler = makeHandler(net, cacheDir, clock, {
    responseBudgetMs: 300,
  });
  const started = Date.now();
  const body = (await invoke(handler)).json();
  const elapsed = Date.now() - started;
  assert.equal(body.nws.status, 'ok');
  assert.equal(body.nws.alerts.length, 6);
  assert.equal(body.gdacs.status, 'unavailable');
  assert.ok(
    elapsed < 3000,
    `a cold response must be capped near the budget, not wait on GDACS forever (took ${elapsed}ms)`,
  );
});

test('with cached data present, a slow refresh does not delay the response at all', async (t) => {
  const cacheDir = await tempDir(t);
  let gdacsUp = true;
  let gdacsHang = false;
  const net = upstream({
    '/EVENTS4APP': async () => {
      if (gdacsHang) return new Promise(() => {});
      return gdacsUp
        ? Response.json(EVENTS)
        : new Response('down', { status: 500 });
    },
  });
  const clock = { now: Date.now() };
  const handler = makeHandler(net, cacheDir, clock);
  await invoke(handler);

  // First, let GDACS genuinely become stale (a settled failed refresh).
  gdacsUp = false;
  clock.now += GDACS_TTL_MS;
  const settled = await waitFor(
    handler,
    (body) => body.gdacs.status === 'stale',
  );
  assert.equal(settled.gdacs.status, 'stale', 'sanity: now genuinely stale');

  // Now hang the next refresh indefinitely: the already-stale data must
  // still answer immediately, without waiting on it.
  gdacsHang = true;
  clock.now += GDACS_TTL_MS;
  const started = Date.now();
  const body = (await invoke(handler)).json();
  const elapsed = Date.now() - started;
  assert.equal(body.gdacs.status, 'stale');
  assert.equal(body.gdacs.events.length, 6);
  assert.ok(
    elapsed < 1000,
    `stale cached data must be served immediately, took ${elapsed}ms`,
  );
});

test('the zone deadline aborts in-flight zone fetches instead of waiting out their duration', async (t) => {
  const cacheDir = await tempDir(t);
  const zoneDeadlineMs = 40;
  const fetchImpl = async (url, init) => {
    const href = String(url);
    if (href === 'https://api.weather.gov/alerts/active')
      return Response.json(ALERTS);
    if (href.startsWith(ZONE_PREFIX)) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const zone = ZONES[href.slice(ZONE_PREFIX.length)];
          resolve(
            zone ? Response.json(zone) : new Response('{}', { status: 404 }),
          );
        }, 500);
        init.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    }
    if (href.endsWith('/EVENTS4APP')) return Response.json(EVENTS);
    if (href.endsWith('/MAP?eventtype=TC')) return Response.json(CYCLONES);
    throw new Error(`unexpected upstream ${href}`);
  };
  const handler = createSevereWeatherHandler({
    fetchImpl,
    cacheDir,
    now: () => Date.now(),
    limiter: () => true,
    log: () => {},
    zoneDeadlineMs,
  });
  const started = Date.now();
  const body = (await invoke(handler)).json();
  const elapsed = Date.now() - started;
  assert.deepEqual(
    body.nws.zones,
    {},
    'zones aborted at the deadline are not remembered or cached',
  );
  assert.equal(
    body.nws.unmappedAlerts,
    5,
    'only the Special Weather Statement carries its own polygon',
  );
  assert.ok(
    elapsed < 300,
    `the build must finish near the ${zoneDeadlineMs}ms deadline, not the 500ms fetch duration (took ${elapsed}ms)`,
  );
});

test('no duplicate upstream refresh is started while a background refresh is already in flight', async (t) => {
  const cacheDir = await tempDir(t);
  let gdacsCalls = 0;
  let gdacsGate = null; // null: answer immediately; a pending promise: hang until released
  let releaseGdacs = () => {};
  const net = upstream({
    '/EVENTS4APP': async () => {
      gdacsCalls += 1;
      if (gdacsGate) await gdacsGate;
      return Response.json(EVENTS);
    },
  });
  const clock = { now: Date.now() };
  const handler = makeHandler(net, cacheDir, clock);

  // Prime with a normal, fully-successful request first: NWS then already
  // has servable data (no zone I/O below) and GDACS answered once.
  await invoke(handler);
  assert.equal(gdacsCalls, 1);

  clock.now += GDACS_TTL_MS; // GDACS due again; NWS stays fresh and servable
  gdacsGate = new Promise((resolve) => {
    releaseGdacs = resolve;
  });
  const first = invoke(handler); // NWS answers immediately; GDACS's refresh starts in the background
  await new Promise((resolve) => setTimeout(resolve, 15));
  const second = invoke(handler); // arrives while that refresh is still in flight
  await Promise.all([first, second]);
  releaseGdacs();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(
    gdacsCalls,
    2,
    'the priming call plus exactly one background refresh, even though two requests arrived while it was in flight',
  );
});

test('data older than 60 minutes reads as unavailable even when a refresh is not yet due again', async (t) => {
  const cacheDir = await tempDir(t);
  let nwsUp = true;
  const net = upstream({
    '/alerts/active': () =>
      nwsUp ? Response.json(ALERTS) : new Response('down', { status: 503 }),
  });
  const clock = { now: Date.now() };
  const handler = makeHandler(net, cacheDir, clock);
  await invoke(handler);

  nwsUp = false;
  clock.now += 12 * NWS_TTL_MS; // exactly STALE_MAX_MS (60 min) since the last success
  // Data is still (barely) servable at this instant, so this call returns
  // immediately and the failing refresh settles in the background; poll
  // until it does rather than pinning a fixed sleep.
  const atBoundary = await waitFor(
    handler,
    (body) => body.nws.status === 'stale',
  );
  assert.equal(
    atBoundary.nws.status,
    'stale',
    'exactly 60 minutes old is still within the stale window',
  );

  clock.now += 2 * MINUTE; // past STALE_MAX_MS, but not yet due for another refresh attempt
  const pastStale = (await invoke(handler)).json();
  assert.equal(
    pastStale.nws.status,
    'unavailable',
    'data older than 60 minutes must not read as stale, refresh due or not',
  );
  assert.deepEqual(pastStale.nws.alerts, []);
});

test('a non-ENOENT disk error reading one zone is a cache miss, not a failure of the whole NWS refresh', async (t) => {
  const cacheDir = await tempDir(t);
  await mkdir(path.join(cacheDir, 'zones'), { recursive: true });
  // A directory where the zone JSON file is expected: readFile() throws EISDIR, not ENOENT.
  await mkdir(path.join(cacheDir, 'zones', 'forecast_AKZ844.json'));
  const body = (
    await invoke(makeHandler(upstream(), cacheDir, { now: Date.now() }))
  ).json();
  assert.equal(
    body.nws.status,
    'ok',
    'one bad disk entry is a cache miss, not a whole-refresh failure',
  );
  assert.ok(
    Object.keys(body.nws.zones).length >= 8,
    'every other zone still resolves',
  );
});

test('a prune readdir failure is logged and does not fail the NWS refresh', async (t) => {
  const cacheDir = await tempDir(t);
  await mkdir(cacheDir, { recursive: true });
  // A file where the zones directory is expected: readdir() throws ENOTDIR, not ENOENT.
  await writeFile(path.join(cacheDir, 'zones'), 'not a directory');
  const body = (
    await invoke(makeHandler(upstream(), cacheDir, { now: Date.now() }))
  ).json();
  assert.equal(body.nws.status, 'ok');
});

test('methods, paths, rate limits and plugin registration', async (t) => {
  const cacheDir = await tempDir(t);
  const handler = makeHandler(upstream(), cacheDir, { now: Date.now() });
  assert.equal((await invoke(handler, '/', 'POST')).status, 405);
  assert.equal((await invoke(handler, '/zones')).status, 404);
  const limited = createSevereWeatherHandler({
    fetchImpl: upstream().fetchImpl,
    cacheDir,
    limiter: () => false,
    log: () => {},
  });
  const refused = await invoke(limited);
  assert.equal(refused.status, 429);
  assert.equal(refused.headers['Retry-After'], '10');

  const plugin = createViteConfig({ mode: 'test' }).plugins.find(
    (p) => p.name === 'severe-weather-proxy',
  );
  assert.ok(plugin, 'severe-weather-proxy must be registered');
  const routes = new Map();
  plugin.configureServer({
    middlewares: { use: (route, fn) => routes.set(route, fn) },
  });
  assert.equal(typeof routes.get('/api/severe-weather'), 'function');
});
