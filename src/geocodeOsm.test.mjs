// OPENSTREETMAP GEOCODE FALLBACK — search keeps working when Google refuses.
//
// Google Geocoding answers REQUEST_DENIED when the API is not enabled on the
// key's Cloud project (observed 2026-09-13). Every forward geocoder — the search
// box, voice annotations, voice radio — then reported "not found" for any place.
// These cases pin the fallback: Nominatim hits are reshaped into Google's result
// structure so camera framing downstream is unchanged, the current view biases
// the search, and only a miss both providers agree on is ZERO_RESULTS.
//
// src/data/fixtures/nominatim-search.json holds real Nominatim jsonv2 responses
// recorded 2026-09-13 (ODbL, © OpenStreetMap contributors). No live providers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boundsToViewbox, geocodeWithFallback, osmHitToGoogleResult } from './geocodeOsm.js';
import { geocodeNavigationMode } from './locations.js';

const NOMINATIM = JSON.parse(readFileSync(new URL('./data/fixtures/nominatim-search.json', import.meta.url), 'utf8'));
const hit = (id) => NOMINATIM[id][0];

/** Great-circle diagonal of a Google-shaped viewport, in km. */
function diagonalKm({ southwest: sw, northeast: ne }) {
  const rad = (d) => (d * Math.PI) / 180;
  const a = Math.sin(rad(ne.lat - sw.lat) / 2) ** 2
    + Math.cos(rad(sw.lat)) * Math.cos(rad(ne.lat)) * Math.sin(rad(ne.lng - sw.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

// ── View bias ────────────────────────────────────────────────────────────────

test('a view bias becomes a Nominatim viewbox in west,south,east,north order', () => {
  // viewportBias() emits Google's "swLat,swLng|neLat,neLng". Nominatim wants
  // lon/lat corner pairs; swapping them biases the search to the wrong side of
  // the planet, which is how "6th Street Austin" lands in Sealy.
  assert.equal(boundsToViewbox('30.1500,-97.9000|30.4000,-97.6000'), '-97.9000,30.1500,-97.6000,30.4000');
});

test('a missing or malformed view bias yields no viewbox', () => {
  assert.equal(boundsToViewbox(null), null);
  assert.equal(boundsToViewbox(''), null);
  assert.equal(boundsToViewbox('garbage'), null);
  assert.equal(boundsToViewbox('30.1,NaN|30.4,-97.6'), null);
});

// ── Conversion ───────────────────────────────────────────────────────────────

test('OSM hits frame like the Google results they stand in for', () => {
  // A category that falls through to precise-place flies to building range:
  // a park becomes a random rooftop and a country becomes a street corner.
  for (const [id, want] of [
    ['japan', 'region-overview'],
    ['texas', 'region-overview'],
    ['austin', 'city-overview'],
    ['dubai', 'city-overview'],
    ['hyde_park_london_suburb', 'neighborhood-close'],
    ['sixth_street_austin_bias', 'street-corridor'],
    ['zilker_park', 'area-overview'],
    ['rocky_mountains', 'area-overview'],
    ['eiffel_tower', 'precise-place'],
  ]) {
    const result = osmHitToGoogleResult(hit(id));
    assert.ok(result, `${id} must convert`);
    assert.equal(geocodeNavigationMode(result.types), want, id);
  }
});

test('the converted result carries Google\'s location, viewport and label', () => {
  // Nominatim's boundingbox is [south, north, west, east]; Google's viewport is
  // southwest/northeast corners. Mixing the order frames a box across the sea.
  const result = osmHitToGoogleResult(hit('dubai'));
  assert.equal(result.formatted_address, 'Dubai, Dubai Emirate, United Arab Emirates');
  assert.equal(result.geometry.location.lat, 25.0742823);
  assert.equal(result.geometry.location.lng, 55.1885624);
  assert.deepEqual(result.geometry.viewport, {
    southwest: { lat: 24.6230801, lng: 54.7153981 },
    northeast: { lat: 25.5250676, lng: 56.205298 },
  });
});

test('a point-sized natural feature gets a regional viewport, not an 11 m one', () => {
  // Nominatim returns the Rocky Mountains as a single node. Framing that box
  // literally puts the camera at rooftop height over one spot in Wyoming.
  const result = osmHitToGoogleResult(hit('rocky_mountains'));
  assert.ok(diagonalKm(result.geometry.viewport) >= 150,
    `expected a regional span, got ${diagonalKm(result.geometry.viewport).toFixed(3)} km`);
});

test('a hit without usable coordinates converts to nothing, not a NaN camera target', () => {
  assert.equal(osmHitToGoogleResult({ ...hit('dubai'), lat: 'not-a-number' }), null);
  assert.equal(osmHitToGoogleResult(null), null);
});

// ── Fallback order ───────────────────────────────────────────────────────────

const GOOGLE = 'maps.googleapis.com/maps/api/geocode/json';
const OSM_ROUTE = '/api/geocode/search';
const AUSTIN_BIAS = '30.1500,-97.9000|30.4000,-97.6000';

// Google's documented response structures.
const GOOGLE_DENIED = {
  error_message: 'This API is not activated on your API project. You may need to enable this API in the Google Cloud Console.',
  results: [],
  status: 'REQUEST_DENIED',
};
const GOOGLE_ZERO = { results: [], status: 'ZERO_RESULTS' };
const GOOGLE_DUBAI = {
  results: [{
    address_components: [
      { long_name: 'Dubai', short_name: 'Dubai', types: ['locality', 'political'] },
      { long_name: 'Dubai', short_name: 'Dubai', types: ['administrative_area_level_1', 'political'] },
      { long_name: 'United Arab Emirates', short_name: 'AE', types: ['country', 'political'] },
    ],
    formatted_address: 'Dubai - United Arab Emirates',
    geometry: {
      bounds: { northeast: { lat: 25.3585607, lng: 55.5645216 }, southwest: { lat: 24.7921359, lng: 54.8904543 } },
      location: { lat: 25.2048493, lng: 55.2707828 },
      location_type: 'APPROXIMATE',
      viewport: { northeast: { lat: 25.3585607, lng: 55.5645216 }, southwest: { lat: 24.7921359, lng: 54.8904543 } },
    },
    place_id: 'ChIJRcbZaklDXz4RYlEphFBu5r0',
    types: ['locality', 'political'],
  }],
  status: 'OK',
};
// What the /api/geocode/search route answers.
const ROUTE_DUBAI = {
  status: 'OK',
  source: 'openstreetmap',
  results: [{
    formatted_address: 'Dubai, Dubai Emirate, United Arab Emirates',
    geometry: {
      location: { lat: 25.0742823, lng: 55.1885624 },
      viewport: { southwest: { lat: 24.6230801, lng: 54.7153981 }, northeast: { lat: 25.5250676, lng: 56.205298 } },
    },
    types: ['locality', 'political'],
    place_id: 'osm:relation/4479752',
    source: 'openstreetmap',
  }],
};
const ROUTE_ZERO = { status: 'ZERO_RESULTS', source: 'openstreetmap', results: [] };
const ROUTE_DOWN = { status: 'UNAVAILABLE', source: 'openstreetmap', results: [] };

/** Answer each request by URL substring with a real Response; record every URL. */
function fakeNetwork(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const href = String(url);
    calls.push(href);
    if (init.signal?.aborted) throw Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
    for (const [match, answer] of routes) {
      if (!href.includes(match)) continue;
      if (answer instanceof Error) throw answer;
      return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`unexpected request ${href}`);
  };
  return { fetchImpl, calls };
}
const params = (href) => new URL(href, 'http://localhost').searchParams;

test('when Google has the place, OpenStreetMap is never asked', async () => {
  const net = fakeNetwork([[GOOGLE, { body: GOOGLE_DUBAI }]]);
  const outcome = await geocodeWithFallback('Dubai', { apiKey: 'k', biasRect: AUSTIN_BIAS, fetchImpl: net.fetchImpl });
  assert.equal(outcome.status, 'OK');
  assert.equal(outcome.source, 'google');
  assert.equal(outcome.result.formatted_address, 'Dubai - United Arab Emirates');
  assert.equal(net.calls.some((c) => c.includes(OSM_ROUTE)), false);
});

test('a Google REQUEST_DENIED falls through to OpenStreetMap, both biased to the view', async () => {
  const net = fakeNetwork([[GOOGLE, { body: GOOGLE_DENIED }], [OSM_ROUTE, { body: ROUTE_DUBAI }]]);
  const outcome = await geocodeWithFallback('Dubai', { apiKey: 'k', biasRect: AUSTIN_BIAS, fetchImpl: net.fetchImpl });
  assert.equal(outcome.status, 'OK');
  assert.equal(outcome.source, 'openstreetmap');
  assert.equal(outcome.result.formatted_address, 'Dubai, Dubai Emirate, United Arab Emirates');
  const google = net.calls.find((c) => c.includes(GOOGLE));
  const osm = net.calls.find((c) => c.includes(OSM_ROUTE));
  assert.equal(params(google).get('bounds'), AUSTIN_BIAS, 'Google keeps its view bias');
  assert.equal(params(osm).get('q'), 'Dubai');
  assert.equal(params(osm).get('viewbox'), '-97.9000,30.1500,-97.6000,30.4000', 'OSM gets the same bias');
});

test('with no Google key the search goes straight to OpenStreetMap', async () => {
  const net = fakeNetwork([[OSM_ROUTE, { body: ROUTE_DUBAI }]]);
  const outcome = await geocodeWithFallback('Dubai', { apiKey: '', fetchImpl: net.fetchImpl });
  assert.equal(outcome.status, 'OK');
  assert.equal(outcome.source, 'openstreetmap');
  assert.equal(net.calls.some((c) => c.includes(GOOGLE)), false, 'no keyless request to Google');
});

test('a miss from every provider that answered is ZERO_RESULTS', async () => {
  const net = fakeNetwork([[GOOGLE, { body: GOOGLE_ZERO }], [OSM_ROUTE, { body: ROUTE_ZERO }]]);
  const outcome = await geocodeWithFallback('Qwxzyv Nowhere', { apiKey: 'k', fetchImpl: net.fetchImpl });
  assert.equal(outcome.status, 'ZERO_RESULTS');
  assert.equal(outcome.result, null);
});

test('an outage is reported as UNAVAILABLE, never as not-found', async () => {
  // Voice annotations cache ZERO_RESULTS; caching an outage would keep a real
  // place "not found" after the network recovers.
  const net = fakeNetwork([[GOOGLE, new Error('ECONNRESET')], [OSM_ROUTE, { status: 502, body: ROUTE_DOWN }]]);
  const outcome = await geocodeWithFallback('Dubai', { apiKey: 'k', fetchImpl: net.fetchImpl });
  assert.equal(outcome.status, 'UNAVAILABLE');
  assert.equal(outcome.result, null);
});

test('a cancelled search stops without falling back', async () => {
  // A superseded search must not resolve later and move the camera.
  const controller = new AbortController();
  controller.abort();
  const net = fakeNetwork([[GOOGLE, { body: GOOGLE_DENIED }], [OSM_ROUTE, { body: ROUTE_DUBAI }]]);
  await assert.rejects(
    geocodeWithFallback('Dubai', { apiKey: 'k', signal: controller.signal, fetchImpl: net.fetchImpl }),
    { name: 'AbortError' },
  );
  assert.equal(net.calls.some((c) => c.includes(OSM_ROUTE)), false);
});
