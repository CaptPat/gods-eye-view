// OpenStreetMap fallback for forward geocoding — the search box, voice
// annotations and voice radio.
//
// Google Geocoding stays first: its matcher is better and the callers were tuned
// against its output. When it refuses (REQUEST_DENIED — the API is not enabled on
// the key's Cloud project, or quota), finds nothing, fails, or there is no key,
// the place is looked up through /api/geocode/search, which asks Nominatim from
// the server. Nominatim hits are reshaped into Google's result structure so each
// caller keeps its own framing and labelling logic unchanged.
//
// This module runs in the browser and in the Vite server (the route converts
// hits with osmHitToGoogleResult), so it must stay free of Cesium and `window`.

const GOOGLE_GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const OSM_SEARCH_ROUTE = '/api/geocode/search';

/**
 * Google's view bias "swLat,swLng|neLat,neLng" (as emitted by viewportBias) as a
 * Nominatim viewbox "west,south,east,north".
 * @param {string|null|undefined} biasRect
 * @returns {string|null} null for a missing or malformed bias
 */
export function boundsToViewbox(biasRect) {
  const corners = String(biasRect || '').split('|');
  if (corners.length !== 2) return null;
  const [sw, ne] = corners.map((corner) => corner.split(',').map((part) => part.trim()));
  if (sw.length !== 2 || ne.length !== 2) return null;
  const [south, west] = sw;
  const [north, east] = ne;
  if (![south, west, north, east].every((value) => value !== '' && Number.isFinite(Number(value)))) return null;
  return `${west},${south},${east},${north}`;
}

// Nominatim `addresstype` → the Google types that drive camera framing
// (geocodeNavigationMode in locations.js).
const ADDRESS_TYPE_TO_GOOGLE = {
  country: ['country', 'political'],
  state: ['administrative_area_level_1', 'political'],
  province: ['administrative_area_level_1', 'political'],
  region: ['administrative_area_level_1', 'political'],
  state_district: ['administrative_area_level_2', 'political'],
  county: ['administrative_area_level_2', 'political'],
  district: ['administrative_area_level_2', 'political'],
  city: ['locality', 'political'],
  town: ['locality', 'political'],
  village: ['locality', 'political'],
  hamlet: ['locality', 'political'],
  municipality: ['locality', 'political'],
  suburb: ['sublocality', 'political'],
  borough: ['sublocality', 'political'],
  quarter: ['sublocality', 'political'],
  city_district: ['sublocality', 'political'],
  neighbourhood: ['neighborhood', 'political'],
  postcode: ['postal_code'],
  road: ['route'],
};

// Nominatim `category/type` for features Google frames as areas, not points.
const CATEGORY_TYPE_TO_GOOGLE = {
  'aeroway/aerodrome': ['airport'],
  'amenity/college': ['university'],
  'amenity/grave_yard': ['cemetery'],
  'amenity/university': ['university'],
  'boundary/national_park': ['park'],
  'boundary/protected_area': ['park'],
  'landuse/cemetery': ['cemetery'],
  'leisure/garden': ['park'],
  'leisure/nature_reserve': ['park'],
  'leisure/park': ['park'],
  'leisure/stadium': ['stadium'],
  'shop/mall': ['shopping_mall'],
  'tourism/theme_park': ['amusement_park'],
  'tourism/zoo': ['zoo'],
};

// Smallest believable span (bbox diagonal, km) per Google type. Nominatim often
// returns a feature as a single node — the Rocky Mountains come back ~11 m
// across — and framing that literally flies the camera to rooftop height.
const MIN_SPAN_KM = [
  ['country', 1500],
  ['administrative_area_level_1', 500],
  ['natural_feature', 250],
  ['administrative_area_level_2', 150],
  ['locality', 25],
  ['sublocality', 6],
  ['postal_code', 5],
  ['neighborhood', 3],
  ['route', 2],
  ['park', 2],
  ['airport', 2],
  ['university', 2],
  ['stadium', 2],
  ['zoo', 2],
  ['amusement_park', 2],
  ['cemetery', 2],
  ['shopping_mall', 2],
];
const PRECISE_MIN_SPAN_KM = 0.3;
const KM_PER_DEGREE_LAT = 111.32;

function diagonalKm(south, west, north, east) {
  const rad = (degrees) => (degrees * Math.PI) / 180;
  const a = Math.sin(rad(north - south) / 2) ** 2
    + Math.cos(rad(south)) * Math.cos(rad(north)) * Math.sin(rad(east - west) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

function googleTypesFor(hit, extentKm) {
  const addressType = String(hit.addresstype || '').toLowerCase();
  if (ADDRESS_TYPE_TO_GOOGLE[addressType]) return ADDRESS_TYPE_TO_GOOGLE[addressType];
  const category = String(hit.category ?? hit.class ?? '').toLowerCase();
  const type = String(hit.type || '').toLowerCase();
  if (CATEGORY_TYPE_TO_GOOGLE[`${category}/${type}`]) return CATEGORY_TYPE_TO_GOOGLE[`${category}/${type}`];
  if (category === 'natural') return ['natural_feature'];
  if (category === 'highway') return ['route'];
  // A generic administrative boundary carries no usable rank (Dubai comes back
  // as place_rank 25), so its own extent says whether it is a city or a region.
  if (category === 'boundary' && type === 'administrative') {
    if (extentKm < 250) return ['locality', 'political'];
    if (extentKm < 800) return ['administrative_area_level_2', 'political'];
    return ['administrative_area_level_1', 'political'];
  }
  return ['point_of_interest', 'establishment'];
}

function minimumSpanKm(types) {
  return MIN_SPAN_KM.find(([type]) => types.includes(type))?.[1] ?? PRECISE_MIN_SPAN_KM;
}

/**
 * One Nominatim jsonv2 search hit as a Google Geocoding result:
 * { formatted_address, geometry: { location, viewport }, types, place_id, source }.
 * @param {object|null} hit
 * @returns {object|null} null when the hit has no usable coordinates
 */
export function osmHitToGoogleResult(hit) {
  const lat = Number(hit?.lat);
  const lng = Number(hit?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  // Nominatim's boundingbox is [south, north, west, east].
  const [south, north, west, east] = Array.isArray(hit.boundingbox) ? hit.boundingbox.map(Number) : [];
  const hasBox = [south, north, west, east].every(Number.isFinite);
  const extentKm = hasBox ? diagonalKm(south, west, north, east) : 0;
  const types = googleTypesFor(hit, extentKm);

  let viewport = hasBox
    ? { southwest: { lat: south, lng: west }, northeast: { lat: north, lng: east } }
    : null;
  const minSpanKm = minimumSpanKm(types);
  if (!viewport || extentKm < minSpanKm) {
    const halfLat = (minSpanKm / Math.SQRT2 / 2) / KM_PER_DEGREE_LAT;
    const halfLng = halfLat / Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
    viewport = {
      southwest: { lat: Math.max(lat - halfLat, -90), lng: lng - halfLng },
      northeast: { lat: Math.min(lat + halfLat, 90), lng: lng + halfLng },
    };
  }

  return {
    formatted_address: String(hit.display_name || hit.name || ''),
    geometry: { location: { lat, lng }, viewport },
    types,
    place_id: hit.osm_type && hit.osm_id != null ? `osm:${hit.osm_type}/${hit.osm_id}` : `osm:${hit.place_id}`,
    source: 'openstreetmap',
  };
}

function isAbort(error, signal) {
  return error?.name === 'AbortError' || signal?.aborted === true;
}

async function searchOpenStreetMap(query, biasRect, signal, fetchFn) {
  const params = new URLSearchParams({ q: query });
  const viewbox = boundsToViewbox(biasRect);
  if (viewbox) params.set('viewbox', viewbox);
  try {
    const response = await fetchFn(`${OSM_SEARCH_ROUTE}?${params}`, { signal });
    const data = await response.json().catch(() => null);
    if (response.ok && data?.status === 'OK' && data.results?.length) {
      return { status: 'OK', result: data.results[0], source: 'openstreetmap' };
    }
    if (response.ok && data?.status === 'ZERO_RESULTS') {
      return { status: 'ZERO_RESULTS', result: null, source: 'openstreetmap' };
    }
    return { status: 'UNAVAILABLE', result: null, source: 'openstreetmap' };
  } catch (error) {
    if (isAbort(error, signal)) throw error;
    return { status: 'UNAVAILABLE', result: null, source: 'openstreetmap' };
  }
}

/**
 * Forward-geocode a place name: Google first, OpenStreetMap when Google cannot
 * answer. Rejects with the AbortError when `signal` aborts, and never falls back
 * after an abort, so a superseded lookup cannot move the camera later.
 *
 * status: 'OK' with a Google-shaped `result`; 'ZERO_RESULTS' when a provider that
 * actually answered found nothing; 'UNAVAILABLE' when no provider could answer —
 * a transient state callers must not cache as not-found.
 *
 * @param {string} query
 * @param {{apiKey?: string, biasRect?: string|null, signal?: AbortSignal, fetchImpl?: typeof fetch}} [options]
 * @returns {Promise<{status: 'OK'|'ZERO_RESULTS'|'UNAVAILABLE', result: object|null, source: 'google'|'openstreetmap'|null}>}
 */
export async function geocodeWithFallback(query, { apiKey = '', biasRect = null, signal, fetchImpl } = {}) {
  const fetchFn = fetchImpl || globalThis.fetch;
  let googleFoundNothing = false;
  if (apiKey) {
    try {
      let url = `${GOOGLE_GEOCODE_URL}?address=${encodeURIComponent(query)}&key=${apiKey}`;
      if (biasRect) url += `&bounds=${biasRect}`;
      const response = await fetchFn(url, { signal });
      const data = await response.json();
      if (data?.status === 'OK' && data.results?.length) {
        return { status: 'OK', result: data.results[0], source: 'google' };
      }
      googleFoundNothing = data?.status === 'ZERO_RESULTS';
    } catch (error) {
      if (isAbort(error, signal)) throw error;
    }
  }
  const osm = await searchOpenStreetMap(query, biasRect, signal, fetchFn);
  if (osm.status !== 'UNAVAILABLE') return osm;
  if (googleFoundNothing) return { status: 'ZERO_RESULTS', result: null, source: 'google' };
  return { status: 'UNAVAILABLE', result: null, source: null };
}
