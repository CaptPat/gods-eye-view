// NOMINATIM PLACE PROVIDER — the keyless geocoder behind Google.
//
// Upstream's keyless provider is Photon. Measured 2026-09-13 from an Austin
// view with the app's own bias string, it placed Dubai in Kenya, Muscat in the
// West Bank and the Eiffel Tower on a mountain in Alberta. The same six queries
// through /api/geocode/search (Nominatim) all resolved correctly, so that route
// is the keyless provider. It answers with the { place, answered } outcome every
// provider composed by createPlaceSearch shares. No live providers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createNominatimGeocoder } from './index.js';
import { createStandalonePlaceSearch } from '../standalone/placeSearch.js';

const AUSTIN_BIAS = '30.1500,-97.9000|30.4000,-97.6000';

// What /api/geocode/search answers.
const ROUTE_DUBAI = {
  status: 'OK',
  source: 'openstreetmap',
  results: [
    {
      formatted_address: 'Dubai, Dubai Emirate, United Arab Emirates',
      geometry: {
        location: { lat: 25.0742823, lng: 55.1885624 },
        viewport: {
          southwest: { lat: 24.6230801, lng: 54.7153981 },
          northeast: { lat: 25.5250676, lng: 56.205298 },
        },
      },
      types: ['locality', 'political'],
      place_id: 'osm:relation/4479752',
      source: 'openstreetmap',
    },
  ],
};
const ROUTE_ZERO = { status: 'ZERO_RESULTS', source: 'openstreetmap', results: [] };
const ROUTE_DOWN = { status: 'UNAVAILABLE', source: 'openstreetmap', results: [] };

/** Answer every request with one fixed reply; record each URL. */
function route(answer) {
  const urls = [];
  const fetchImpl = async (url, init = {}) => {
    urls.push(String(url));
    init.signal?.throwIfAborted();
    if (answer instanceof Error) throw answer;
    return Response.json(answer.body, { status: answer.status ?? 200 });
  };
  return { urls, fetchImpl };
}
const params = (href) => new URL(href, 'http://localhost').searchParams;

test('a found place comes back in the shared place shape, named for the annotation resolver', async () => {
  // The resolver matches OSM features on `name`. Google fills it from
  // address_components, which an OpenStreetMap result does not have.
  const net = route({ body: ROUTE_DUBAI });
  const outcome = await createNominatimGeocoder({ fetchImpl: net.fetchImpl }).geocode('Dubai', { bias: AUSTIN_BIAS });
  assert.equal(outcome.answered, true);
  assert.deepEqual(outcome.place, {
    lat: 25.0742823,
    lng: 55.1885624,
    name: 'Dubai',
    label: 'Dubai, Dubai Emirate, United Arab Emirates',
    types: ['locality', 'political'],
    viewport: {
      southwest: { lat: 24.6230801, lng: 54.7153981 },
      northeast: { lat: 25.5250676, lng: 56.205298 },
    },
  });
});

test('the view bias reaches the route as a Nominatim viewbox, and a missing bias sends none', async () => {
  // Without the viewbox, "6th Street Austin" resolves to Sealy, in Austin County.
  const biased = route({ body: ROUTE_DUBAI });
  await createNominatimGeocoder({ fetchImpl: biased.fetchImpl }).geocode('6th Street Austin', { bias: AUSTIN_BIAS });
  assert.equal(new URL(biased.urls[0], 'http://localhost').pathname, '/api/geocode/search');
  assert.equal(params(biased.urls[0]).get('q'), '6th Street Austin');
  assert.equal(params(biased.urls[0]).get('viewbox'), '-97.9000,30.1500,-97.6000,30.4000');

  const unbiased = route({ body: ROUTE_DUBAI });
  await createNominatimGeocoder({ fetchImpl: unbiased.fetchImpl }).geocode('Dubai');
  assert.equal(params(unbiased.urls[0]).has('viewbox'), false);
});

test('a definitive miss is answered; an outage or a network failure is not', async () => {
  // createPlaceSearch caches answered misses; caching an outage would keep a
  // real place "not found" after the network recovers.
  const miss = await createNominatimGeocoder({ fetchImpl: route({ body: ROUTE_ZERO }).fetchImpl }).geocode('Qwxzyv Nowhereville');
  assert.deepEqual(miss, { place: null, answered: true });
  const outage = await createNominatimGeocoder({ fetchImpl: route({ status: 502, body: ROUTE_DOWN }).fetchImpl }).geocode('Dubai');
  assert.deepEqual(outage, { place: null, answered: false });
  const offline = await createNominatimGeocoder({ fetchImpl: route(new Error('ECONNRESET')).fetchImpl }).geocode('Dubai');
  assert.deepEqual(offline, { place: null, answered: false });
});

test('a cancelled lookup throws instead of reporting a miss, and makes no request', async () => {
  const controller = new AbortController();
  controller.abort();
  const net = route({ body: ROUTE_DUBAI });
  await assert.rejects(
    createNominatimGeocoder({ fetchImpl: net.fetchImpl }).geocode('Dubai', { signal: controller.signal }),
    { name: 'AbortError' },
  );
  assert.equal(net.urls.length, 0);
});

test('the standalone service falls back from a refusing Google to Nominatim, never to Photon', async () => {
  const urls = [];
  const service = createStandalonePlaceSearch({
    resolveApiKey: () => 'fixture',
    fetchImpl: async (url) => {
      const href = String(url);
      urls.push(href);
      if (href.includes('maps.googleapis.com')) return Response.json({ status: 'REQUEST_DENIED', results: [] });
      if (href.startsWith('/api/geocode/search')) return Response.json(ROUTE_DUBAI);
      throw new Error(`unexpected request ${href}`);
    },
  });
  const result = await service.geocode('Dubai');
  assert.equal(result.place.label, 'Dubai, Dubai Emirate, United Arab Emirates');
  assert.equal(result.fallbackUsed, true);
  assert.equal(urls.some((href) => href.includes('photon.komoot.io')), false);
});

test('a keyless standalone service asks Nominatim and issues no Google request', async () => {
  const urls = [];
  const service = createStandalonePlaceSearch({
    fetchImpl: async (url) => {
      urls.push(String(url));
      return Response.json(ROUTE_DUBAI);
    },
  });
  assert.equal((await service.geocode('Dubai')).place.lat, 25.0742823);
  assert.deepEqual(urls.map((href) => new URL(href, 'http://localhost').pathname), ['/api/geocode/search']);
});
