// OPENSTREETMAP GEOCODE SHAPES — Nominatim hits standing in for Google results.
//
// Google Geocoding answers REQUEST_DENIED when the API is not enabled on the
// key's Cloud project (observed 2026-09-13), and every forward geocoder then
// falls back to Nominatim (src/search/nominatim.js). These cases pin the
// conversion: hits are reshaped into Google's result structure so camera
// framing downstream is unchanged, and the view bias becomes a viewbox.
//
// src/data/fixtures/nominatim-search.json holds real Nominatim jsonv2 responses
// recorded 2026-09-13 (ODbL, © OpenStreetMap contributors). No live providers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boundsToViewbox, osmHitToGoogleResult } from './geocodeOsm.js';
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
