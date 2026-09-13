// GEOCODE SEARCH ROUTE — /api/geocode/search, the server side of the OSM fallback.
//
// The route asks Nominatim from the server so every request carries an
// identifying User-Agent and shares the one-request-per-second queue the regional
// briefing already uses (Nominatim's usage policy is per client, not per route).
// Fixtures are real Nominatim jsonv2 responses recorded 2026-09-13. No live
// providers: global fetch is mocked per test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import createViteConfig from '../vite.config.js';

const NOMINATIM = JSON.parse(readFileSync(new URL('./data/fixtures/nominatim-search.json', import.meta.url), 'utf8'));
const AUSTIN_VIEWBOX = '-97.9000,30.1500,-97.6000,30.4000';

function searchHandler() {
  const plugin = createViteConfig({ mode: 'test' }).plugins.find((p) => p.name === 'geocode-search-proxy');
  assert.ok(plugin, 'the geocode search route must be registered');
  const routes = new Map();
  plugin.configureServer({ middlewares: { use: (route, handler) => routes.set(route, handler) } });
  const handler = routes.get('/api/geocode/search');
  assert.equal(typeof handler, 'function', 'mounted at /api/geocode/search');
  return handler;
}

/** Drive the middleware the way connect does: mount path already stripped. */
function invoke(handler, { method = 'GET', url }) {
  return new Promise((resolve, reject) => {
    const req = { method, url, headers: {}, socket: { remoteAddress: '127.0.0.1' } };
    const res = {
      statusCode: 200,
      headers: {},
      writeHead(status, headers) { this.statusCode = status; Object.assign(this.headers, headers || {}); },
      setHeader(name, value) { this.headers[name] = value; },
      end(body) { resolve({ status: this.statusCode, headers: this.headers, body: body ? JSON.parse(body) : null }); },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

/** Mock Nominatim; record each upstream URL and its headers. */
function mockNominatim(t, answer) {
  const upstream = [];
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    upstream.push({ url: new URL(String(url)), headers: init.headers || {} });
    if (answer instanceof Error) throw answer;
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200, headers: { 'content-type': 'application/json' } });
  });
  return upstream;
}

test('a place search asks Nominatim in English, biased to the view, and answers in Google\'s shape', async (t) => {
  const handler = searchHandler();
  const upstream = mockNominatim(t, { body: NOMINATIM.dubai });
  const response = await invoke(handler, { url: `/?q=Dubai&viewbox=${encodeURIComponent(AUSTIN_VIEWBOX)}` });

  assert.equal(upstream.length, 1);
  const { url, headers } = upstream[0];
  assert.equal(url.origin + url.pathname, 'https://nominatim.openstreetmap.org/search');
  assert.equal(url.searchParams.get('q'), 'Dubai');
  assert.equal(url.searchParams.get('format'), 'jsonv2');
  assert.equal(url.searchParams.get('accept-language'), 'en', 'without it, Dubai comes back in Arabic');
  assert.equal(url.searchParams.get('viewbox'), AUSTIN_VIEWBOX);
  assert.equal(url.searchParams.get('bounded'), '0', 'bias the ranking, do not exclude places outside the view');
  assert.ok(String(headers['User-Agent'] || '').trim(), 'Nominatim policy requires an identifying User-Agent');

  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'OK');
  assert.equal(response.body.source, 'openstreetmap');
  assert.equal(response.body.results[0].formatted_address, 'Dubai, Dubai Emirate, United Arab Emirates');
  assert.equal(response.body.results[0].geometry.location.lat, Number(NOMINATIM.dubai[0].lat));
});

test('no Nominatim hit is a 200 ZERO_RESULTS, not an error', async (t) => {
  const handler = searchHandler();
  mockNominatim(t, { body: [] });
  const response = await invoke(handler, { url: `/?q=${encodeURIComponent(`Nowhere ${randomUUID()}`)}` });
  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ZERO_RESULTS');
  assert.deepEqual(response.body.results, []);
});

test('a Nominatim outage is a 502 UNAVAILABLE, so no caller caches it as not-found', async (t) => {
  const handler = searchHandler();
  mockNominatim(t, { status: 503, body: { error: 'Service Unavailable' } });
  const response = await invoke(handler, { url: `/?q=${encodeURIComponent(`Outage ${randomUUID()}`)}` });
  assert.equal(response.status, 502);
  assert.equal(response.body.status, 'UNAVAILABLE');
  assert.deepEqual(response.body.results, []);
});

test('a repeated search is answered from cache without another Nominatim request', async (t) => {
  // Re-querying Nominatim for the same text on every submit breaks its usage
  // policy and gets the client blocked.
  const handler = searchHandler();
  const upstream = mockNominatim(t, { body: NOMINATIM.eiffel_tower });
  const url = `/?q=${encodeURIComponent(`Eiffel Tower ${randomUUID()}`)}`;
  const first = await invoke(handler, { url });
  const second = await invoke(handler, { url });
  assert.equal(first.body.status, 'OK');
  assert.deepEqual(second.body.results, first.body.results);
  assert.equal(upstream.length, 1);
});

test('a malformed view bias is dropped rather than sent to Nominatim', async (t) => {
  const handler = searchHandler();
  const upstream = mockNominatim(t, { body: NOMINATIM.austin });
  const response = await invoke(handler, { url: `/?q=${encodeURIComponent(`Austin ${randomUUID()}`)}&viewbox=not-a-box` });
  assert.equal(response.body.status, 'OK');
  assert.equal(upstream[0].url.searchParams.has('viewbox'), false);
});

test('a search with no query, or not a GET, never reaches Nominatim', async (t) => {
  const handler = searchHandler();
  const upstream = mockNominatim(t, { body: NOMINATIM.dubai });
  const blank = await invoke(handler, { url: '/?q=%20%20' });
  assert.equal(blank.status, 400);
  const post = await invoke(handler, { method: 'POST', url: '/?q=Dubai' });
  assert.equal(post.status, 405);
  assert.equal(upstream.length, 0);
});
