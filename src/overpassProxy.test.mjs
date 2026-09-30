// OVERPASS PROXY — which upstream answers count as an answer.
//
// One predicate governs cache reads, writes, and stale fallback. A configured
// upstream's refusal is never data, and only operator-supplied alternatives
// may be tried. These cases use no live providers.
//
// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { Readable } from 'node:stream';
import createViteConfig, {
  fetchOverpassPayload,
  isPrivateOverpassHost,
  overpassUpstreams,
  parseOverpassUpstreamsEnv,
  overpassElementCount,
  overpassPayloadIsCacheable,
  overpassPayloadIsData,
  readOverpassDisk,
} from '../vite.config.js';

const DATA = { status: 200, body: '{"elements":[]}' };

test('disk cache rejects old refusals for fresh and stale reads but preserves last-good data', async () => {
  const key = `overpass-cache-regression-${randomUUID()}`;
  const directory = path.join(process.cwd(), '.gev-cache', 'overpass');
  const file = path.join(directory, `${createHash('sha1').update(key).digest('hex')}.json`);
  await mkdir(directory, { recursive: true });
  try {
    for (const refusal of [
      { status: 406 }, { status: 429 }, { status: 503 },
      { status: 200, rateLimited: true }, { status: 200, runtimeError: true },
    ]) {
      await writeFile(file, JSON.stringify({ ...DATA, cachedAt: Date.now(), ...refusal }));
      assert.equal(await readOverpassDisk(key, 60000), null, `fresh ${JSON.stringify(refusal)}`);
      assert.equal(await readOverpassDisk(key, Infinity), null, `stale ${JSON.stringify(refusal)}`);
    }
    const good = { ...DATA, cachedAt: Date.now() - 120000 };
    await writeFile(file, JSON.stringify(good));
    assert.equal(await readOverpassDisk(key, 60000), null, 'expired good data misses normal TTL');
    assert.deepEqual(await readOverpassDisk(key, Infinity), good, 'last-good data survives an outage');
    await writeFile(file, '{invalid');
    assert.equal(await readOverpassDisk(key, Infinity), null, 'corrupt cache is ignored');
  } finally {
    await unlink(file);
  }
});

// ── The predicate ────────────────────────────────────────────────────────────

test('only a 2xx that is neither rate-limited nor a runtime error is data', () => {
  assert.equal(overpassPayloadIsData({ status: 200 }), true);
  assert.equal(overpassPayloadIsData({ status: 204 }), true);

  // The measured refusal, and its neighbours. `< 500` admitted every one.
  for (const status of [400, 403, 406, 410, 429]) {
    assert.equal(overpassPayloadIsData({ status }), false, `${status} is not data`);
  }
  assert.equal(overpassPayloadIsData({ status: 502 }), false);
  // A 200 can still not be data: Overpass reports runtime failures in the body.
  assert.equal(overpassPayloadIsData({ status: 200, runtimeError: true }), false);
  assert.equal(overpassPayloadIsData({ status: 200, rateLimited: true }), false);
  assert.equal(overpassPayloadIsData({}), false);
  assert.equal(overpassPayloadIsData(null), false);
});

// Configured endpoints replace defaults; refusals are sanitized and cooled down.
test('configured failover accepts empty data and keeps the application identity', async () => {
  const endpoints = ['https://first.example/query?secret=one', 'http://localhost:12345/api'];
  const seen = [];
  const payload = await fetchOverpassPayload('data=x', 1024, {
    endpoints,
    fetchImpl: async (url, options) => {
      seen.push(url);
      assert.equal(options.headers['User-Agent'], 'gods-eye-view/0.1 (+https://github.com/bilawalsidhu/gods-eye-view)');
      assert.equal(options.redirect, 'error');
      return new Response(seen.length === 1 ? url : DATA.body, { status: seen.length === 1 ? 406 : 200 });
    },
  });
  assert.deepEqual(seen, endpoints);
  assert.equal(payload.body, DATA.body);
  assert.equal(payload.endpoint, 'configured');
});

test('406 and 429 honor Retry-After across different queries without more egress', async () => {
  for (const status of [406, 429]) {
    const endpoint = `https://cooldown-${status}.example/private?token=secret`;
    let count = 0, now = 1_000_000;
    const options = { endpoints: [endpoint], now: () => now, fetchImpl: async () => {
      count++;
      return new Response(`Refused ${endpoint}`, { status, headers: { 'Retry-After': '90' } });
    } };
    const first = await fetchOverpassPayload('first', 1024, options);
    assert.equal(first.status, status);
    assert.equal(first.retryAfterMs, 90_000);
    assert.doesNotMatch(JSON.stringify(first), /secret|https:/);
    now += 30_000;
    const next = await fetchOverpassPayload('different', 1024, options);
    assert.equal(count, 1);
    assert.equal(next.retryAfterMs, 60_000);
    now += 60_001;
    await fetchOverpassPayload('third', 1024, options);
    assert.equal(count, 2);
  }
});

test('HTTP-date Retry-After is respected, and absent delays use bounded backoff', async () => {
  let now = Date.parse('2026-09-23T12:00:00Z');
  const endpoint = 'https://dated.example/api';
  const payload = await fetchOverpassPayload('x', 1024, { endpoints: [endpoint], now: () => now,
    fetchImpl: async () => new Response('busy', { status: 429, headers: { 'Retry-After': 'Wed, 23 Sep 2026 12:02:00 GMT' } }) });
  assert.equal(payload.retryAfterMs, 120_000);
  const options = { endpoints: ['https://bounded.example'], now: () => now,
    fetchImpl: async () => { throw new Error('https://bounded.example/secret'); } };
  for (let i = 0; i < 8; i++) {
    const reply = await fetchOverpassPayload('x', 1024, options);
    assert.ok(reply.retryAfterMs <= 300_000);
    assert.doesNotMatch(reply.body, /secret|https:/);
    now += reply.retryAfterMs + 1;
  }
});

test('production reader rejects oversized, malformed and runtime-failure bodies', async () => {
  for (const [i, body] of ['x'.repeat(200), '{"remark":"runtime error: timed out","elements":[]}', 'rate_limited', '{}', 'not json'].entries()) {
    const endpoints = [`https://bad-${i}.example/`, `https://good-${i}.example/`];
    const seen = [];
    const payload = await fetchOverpassPayload('data=x', 100, { endpoints, fetchImpl: async (url) => {
      seen.push(url); return new Response(seen.length === 1 ? body : DATA.body);
    } });
    assert.equal(payload.body, DATA.body); assert.deepEqual(seen, endpoints);
  }
});

function proxyHandler() {
  const plugin = createViteConfig({ mode: 'test' }).plugins.find(p => p.name === 'overpass-proxy');
  const routes = new Map();
  plugin.configureServer({ middlewares: { use: (route, handler) => routes.set(route, handler) } });
  return routes.get('/api/overpass');
}

function invoke(handler, body) {
  const req = Readable.from([Buffer.from(body)]);
  Object.assign(req, { method: 'POST', headers: {}, socket: { remoteAddress: '127.0.0.1' } });
  return new Promise((resolve, reject) => {
    const res = {
      writeHead(status, headers) { this.status = status; this.headers = headers; },
      end(body) { resolve({ status: this.status, headers: this.headers, body }); },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

test('coalesced outage callers both receive last-good data, never a cached refusal', async (t) => {
  const handler = proxyHandler();
  const prior = process.env.OVERPASS_UPSTREAMS;
  t.after(() => { if (prior === undefined) delete process.env.OVERPASS_UPSTREAMS; else process.env.OVERPASS_UPSTREAMS = prior; });
  // A developer .env may set the fork's self-hosted endpoint; it would lead the chain.
  const priorFork = process.env.GEV_OVERPASS_UPSTREAMS;
  delete process.env.GEV_OVERPASS_UPSTREAMS;
  t.after(() => { if (priorFork !== undefined) process.env.GEV_OVERPASS_UPSTREAMS = priorFork; });
  for (const status of [406, 503, 429]) {
    process.env.OVERPASS_UPSTREAMS = `https://outage-${status}.example/api`;
    const query = `[out:json][timeout:12];node(around:10,30.27,-97.74)["name"="${randomUUID()}"];out;`;
    const body = `data=${encodeURIComponent(query)}`;
    const directory = path.join(process.cwd(), '.gev-cache', 'overpass');
    const file = path.join(directory, `${createHash('sha1').update(body).digest('hex')}.json`);
    await mkdir(directory, { recursive: true });
    const stale = { ...DATA, cachedAt: Date.now() - 40 * 86400000 };
    await writeFile(file, JSON.stringify(stale));
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    let fetches = 0;
    const mock = t.mock.method(globalThis, 'fetch', async () => {
      fetches++;
      entered.resolve();
      await release.promise;
      return new Response('upstream unavailable', { status });
    });
    try {
      const first = invoke(handler, body);
      await entered.promise;
      const second = invoke(handler, body);
      // The second request consumes its in-memory stream and joins the pending
      // promise before releasing upstream. No network or elapsed-time sleep.
      await new Promise(resolve => setImmediate(resolve));
      release.resolve();
      for (const response of await Promise.all([first, second])) {
        assert.equal(response.status, 200, `${status}: both callers use last-good data`);
        assert.equal(response.body, DATA.body);
        assert.equal(response.headers['X-Overpass-Cache'], 'STALE');
      }
      assert.equal(fetches, 1, 'one shared configured request');
      assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), stale);
    } finally {
      release.resolve();
      mock.mock.restore();
      await unlink(file);
    }
  }
});

// ENDPOINT LIST — fork override plus upstream configuration, no public mirrors.
//
// Upstream #742 stopped using public Overpass instances by default; they had
// refused this proxy anyway (measured 2026-09-12: overpass-api.de answered 406
// to its User-Agent, the kumi.systems/private.coffee host 504 after ~60 s). The
// fork's GEV_OVERPASS_UPSTREAMS — deployment config, never source, because this
// repository is public — leads, and upstream's OVERPASS_UPSTREAMS follows.
function withOverpassEnv(env, run) {
  const saved = {};
  for (const key of ['GEV_OVERPASS_UPSTREAMS', 'OVERPASS_UPSTREAMS']) {
    saved[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  try {
    return run();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('no configured endpoint means no Overpass endpoint at all', () => {
  withOverpassEnv({}, () => assert.deepEqual(overpassUpstreams(), []));
});

test('a self-hosted endpoint leads, then upstream-configured ones, deduplicated', () => {
  withOverpassEnv({
    GEV_OVERPASS_UPSTREAMS: 'http://10.0.0.5:12345/api/interpreter',
    OVERPASS_UPSTREAMS: 'https://overpass.example.org/api/interpreter,http://10.0.0.5:12345/api/interpreter',
  }, () => {
    assert.deepEqual(overpassUpstreams(), [
      'http://10.0.0.5:12345/api/interpreter',
      'https://overpass.example.org/api/interpreter',
    ]);
  });
});

test('plaintext is admitted on the LAN and refused to any routable host', async () => {
  for (const host of ['192.168.1.10', '127.0.0.1', '10.1.2.3', '172.16.0.9', 'localhost']) {
    assert.equal(isPrivateOverpassHost(host), true, `${host} is private`);
  }
  for (const host of ['172.32.0.9', '8.8.8.8', 'overpass-api.de', '192.169.0.1']) {
    assert.equal(isPrivateOverpassHost(host), false, `${host} is routable`);
  }

  const refused = [];
  const accepted = parseOverpassUpstreamsEnv([
    'http://10.0.0.5:12345/api/interpreter',
    'https://overpass.example.org/api/interpreter',
    'http://overpass.example.org/api/interpreter',
    'ftp://nope.example/api',
    'not a url',
  ].join(','), (m) => refused.push(m));

  assert.deepEqual(accepted, [
    'http://10.0.0.5:12345/api/interpreter',
    'https://overpass.example.org/api/interpreter',
  ], 'LAN plaintext and public TLS accepted');
  assert.equal(refused.length, 3, 'routable plaintext, non-HTTP and junk all rejected');
  assert.ok(refused.some((m) => /plaintext to routable host/.test(m)));
});

test('an absent or empty override changes nothing', async () => {
  assert.deepEqual(parseOverpassUpstreamsEnv(undefined), []);
  assert.deepEqual(parseOverpassUpstreamsEnv(''), []);
  assert.deepEqual(parseOverpassUpstreamsEnv('  ,  ,'), []);
});

// EMPTY-RESULT POISONING — a 200 that is not an answer about the world.
//
// A mirror whose database lacks the queried region answers 200 with an empty
// `elements` array. overpassPayloadIsData sees a clean 2xx and the entry lands
// on disk for 7 days (30 for boundary queries), so one out-of-region answer
// blanks the layer long after a covering mirror returns. Observed 2026-09-12:
// overpass.osm.ch (a Switzerland-only extract) answered Austin and Tokyo road
// queries with 200 and zero elements while Zurich returned data.
//
// This matters most for a SELF-HOSTED regional instance, which has the same
// shape by design: correct inside its extract, confidently empty outside it.
const json = (elements) => ({ status: 200, body: JSON.stringify({ version: 0.6, elements }) });

test('element count is total — unknown shapes never read as empty', async () => {
  assert.equal(overpassElementCount(json([])), 0);
  assert.equal(overpassElementCount(json([{ id: 1 }, { id: 2 }])), 2);
  assert.equal(overpassElementCount({ status: 200, body: '{not json' }), null, 'unparseable is unknown');
  assert.equal(overpassElementCount({ status: 200, body: '<?xml version="1.0"?><osm/>' }), null, 'xml is unknown');
  assert.equal(overpassElementCount({ status: 200, body: '{"version":0.6}' }), null, 'no elements key is unknown');
  assert.equal(overpassElementCount({ status: 200 }), null, 'missing body is unknown');
});

test('a populated result is always cacheable', async () => {
  assert.equal(overpassPayloadIsCacheable(json([{ id: 1 }]), 'data=roads'), true);
});

test('an unknown-shape body stays cacheable — emptiness was never claimed', async () => {
  assert.equal(overpassPayloadIsCacheable({ status: 200, body: '<?xml version="1.0"?><osm/>' }, 'data=x'), true);
});

test('an empty result is not written to the cache', async () => {
  assert.equal(
    overpassPayloadIsCacheable(json([]), 'data=roads'),
    false,
    'an empty 200 must not hold the layer blank for the disk TTL',
  );
});
