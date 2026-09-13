// OVERPASS PROXY — which upstream answers count as an answer.
//
// One predicate governs cache reads, writes, and stale fallback. A mirror's
// refusal must neither end the search for healthy alternatives nor persist as
// data under the week/month-long cache TTLs. These cases use no live providers.
//
// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { Readable } from 'node:stream';
import createViteConfig, {
  OVERPASS_UPSTREAMS,
  fetchOverpassPayload,
  isPrivateOverpassHost,
  overpassUpstreams,
  parseOverpassUpstreamsEnv,
  overpassElementCount,
  overpassPayloadIsCacheable,
  overpassPayloadIsData,
  readOverpassDisk,
} from '../vite.config.js';

const ENDPOINTS = ['https://a.example/api', 'https://b.example/api', 'https://c.example/api'];

/** Answer each endpoint from a map of url → {status, body}; record the order. */
function mirrors(byUrl) {
  const tried = [];
  const fetchImpl = async (url) => {
    tried.push(url);
    const answer = byUrl[url];
    if (answer instanceof Error) throw answer;
    return { status: answer.status, headers: { get: () => answer.contentType || 'application/json' } };
  };
  return { fetchImpl, tried, readBody: async (_, __) => byUrl[tried[tried.length - 1]]?.body ?? '' };
}

const run = (byUrl) => {
  const m = mirrors(byUrl);
  return fetchOverpassPayload('data=x', 1e6, {
    endpoints: ENDPOINTS,
    fetchImpl: m.fetchImpl,
    readBody: m.readBody,
    simplify: (body) => body,
  }).then((payload) => ({ payload, tried: m.tried }), (error) => ({ error, tried: m.tried }));
};

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

// ── The fan-out ──────────────────────────────────────────────────────────────

test('a refusal moves to the next mirror instead of ending the fan-out', async () => {
  // The exact shape measured against the live mirrors.
  const { payload, tried } = await run({
    [ENDPOINTS[0]]: { status: 406, contentType: 'text/html', body: '<!DOCTYPE HTML><title>406</title>' },
    [ENDPOINTS[1]]: DATA,
    [ENDPOINTS[2]]: DATA,
  });

  assert.equal(payload.status, 200);
  assert.equal(payload.endpoint, ENDPOINTS[1]);
  assert.deepEqual(tried, ENDPOINTS.slice(0, 2), 'the healthy mirror must be reached, and no further');
});

test('the first mirror to answer wins, and the rest are left alone', async () => {
  const { payload, tried } = await run({
    [ENDPOINTS[0]]: DATA, [ENDPOINTS[1]]: DATA, [ENDPOINTS[2]]: DATA,
  });

  assert.equal(payload.endpoint, ENDPOINTS[0]);
  assert.deepEqual(tried, [ENDPOINTS[0]]);
});

test('a refusal every mirror agrees on is reported, not swallowed', async () => {
  // A genuinely bad query must still say what upstream said — but only after
  // every mirror has had its chance to answer it.
  const refusal = { status: 400, body: 'line 1: parse error' };
  const { payload, tried } = await run({
    [ENDPOINTS[0]]: refusal, [ENDPOINTS[1]]: refusal, [ENDPOINTS[2]]: refusal,
  });

  assert.equal(payload.status, 400);
  assert.equal(payload.endpoint, ENDPOINTS[0], 'the FIRST refusal is the one reported');
  assert.deepEqual(tried, ENDPOINTS);
  assert.equal(overpassPayloadIsData(payload), false, 'so it is neither cached nor served as data');
});

test('a mirror that throws is no different from one that refuses', async () => {
  const { payload, tried } = await run({
    [ENDPOINTS[0]]: new Error('ECONNRESET'),
    [ENDPOINTS[1]]: { status: 503, body: 'busy' },
    [ENDPOINTS[2]]: DATA,
  });

  assert.equal(payload.endpoint, ENDPOINTS[2]);
  assert.deepEqual(tried, ENDPOINTS);
});

test('when every mirror is unreachable the caller gets a throw, not a payload', async () => {
  const { error, payload } = await run({
    [ENDPOINTS[0]]: new Error('ECONNRESET'),
    [ENDPOINTS[1]]: new Error('ETIMEDOUT'),
    [ENDPOINTS[2]]: new Error('ENOTFOUND'),
  });

  assert.equal(payload, undefined);
  assert.match(error.message, /ENOTFOUND/);
});

test('production reader rotates past oversized, runtime-error and rate-limited bodies', async () => {
  for (const [status, body] of [
    [200, 'x'.repeat(200)], [200, '{"remark":"runtime error: timed out","elements":[]}'],
    [200, 'rate_limited'], [429, 'busy'], [403, 'forbidden'],
  ]) {
    const tried = [];
    const payload = await fetchOverpassPayload('data=x', 100, {
      endpoints: ENDPOINTS,
      fetchImpl: async (url) => {
        tried.push(url);
        return new Response(tried.length === 1 ? body : DATA.body, {
          status: tried.length === 1 ? status : 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    assert.equal(payload.body, DATA.body);
    assert.deepEqual(tried, ENDPOINTS.slice(0, 2));
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
  for (const status of [406, 503, 429]) {
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
      // One pass through the mirror list, shared by both callers — not one
      // sequence each. Derived from the list so adding a mirror cannot silently
      // turn a coalescing regression into a passing test.
      assert.equal(fetches, overpassUpstreams().length, 'one shared, bounded mirror sequence');
      assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), stale);
    } finally {
      release.resolve();
      mock.mock.restore();
      await unlink(file);
    }
  }
});

// MIRROR LIST AND SELF-HOSTED OVERRIDE.
//
// fetchOverpassPayload rotates through the endpoint list on any refusal, so the
// list's value is the number of operators that can answer independently, not
// its length. Measured 2026-09-12, the four public entries are two operators:
//
//   overpass-api.de / lz4.overpass-api.de   same operator (cert gall.openstreetmap.de)
//   overpass.kumi.systems / .private.coffee same machine  (both -> one address)
//
// On a network where both refuse, every Overpass-backed layer (traffic, mapped
// installations, annotation boundaries) is permanently empty and the disk cache
// is never written. The answer is a self-hosted instance supplied through
// GEV_OVERPASS_UPSTREAMS — deployment config, never source, because this
// repository is public and an operator's internal addresses are not.
//
// Alias groups are asserted as data, not resolved at test time: no DNS, no live
// providers, and a future alias must be recorded here to stay honest.
const OVERPASS_ALIAS_GROUPS = Object.freeze({
  'overpass-api.de': 'overpass-api.de',
  'lz4.overpass-api.de': 'overpass-api.de',
  'overpass.kumi.systems': 'shared-community-host',
  'overpass.private.coffee': 'shared-community-host',
});

/** Collapse mirror URLs to the operators that can answer independently. */
function overpassOperators(upstreams) {
  return new Set(upstreams.map((url) => {
    const { hostname } = new URL(url);
    return OVERPASS_ALIAS_GROUPS[hostname] ?? hostname;
  }));
}

test('the public list alone cannot survive both its operators failing', async () => {
  // Not a defect to fix by adding public mirrors — it is why the override
  // exists. Asserted so the limitation stays visible rather than assumed away.
  assert.equal(overpassOperators(OVERPASS_UPSTREAMS).size, 2);
});

test('a self-hosted endpoint is tried before the public mirrors', async () => {
  const previous = process.env.GEV_OVERPASS_UPSTREAMS;
  process.env.GEV_OVERPASS_UPSTREAMS = 'http://10.0.0.5:12345/api/interpreter';
  try {
    const list = overpassUpstreams();
    assert.equal(list[0], 'http://10.0.0.5:12345/api/interpreter', 'override leads');
    assert.deepEqual(list.slice(1), OVERPASS_UPSTREAMS, 'public mirrors remain as fallback');
    assert.equal(overpassOperators(list).size, 3, 'a third independent operator');
  } finally {
    if (previous === undefined) delete process.env.GEV_OVERPASS_UPSTREAMS;
    else process.env.GEV_OVERPASS_UPSTREAMS = previous;
  }
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

test('every public mirror is a distinct https interpreter endpoint', async () => {
  for (const url of OVERPASS_UPSTREAMS) {
    const parsed = new URL(url);
    assert.equal(parsed.protocol, 'https:', `${url} must be https`);
    assert.ok(parsed.pathname.endsWith('/interpreter'), `${url} must target /interpreter`);
  }
  assert.equal(new Set(OVERPASS_UPSTREAMS).size, OVERPASS_UPSTREAMS.length);
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
