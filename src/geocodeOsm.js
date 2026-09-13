// OpenStreetMap (Nominatim) geocoding shapes shared by the server route and the
// browser provider.
//
// server/providers/geocode.js converts Nominatim hits with osmHitToGoogleResult
// before answering /api/geocode/search, and src/search/nominatim.js turns the
// app's Google-style view bias into a Nominatim viewbox with boundsToViewbox.
// Results take Google's geocode structure so normalizeGooglePlace and the camera
// framing downstream read them unchanged.
//
// This module runs in the browser and in the Vite server, so it must stay free
// of Cesium and `window`.

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
