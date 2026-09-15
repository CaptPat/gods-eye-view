/**
 * Wikidata SPARQL bindings (see scripts/build-ufo-incidents.mjs) → one record
 * per notable UFO incident. Wikidata is CC0, so the snapshot can ship with the
 * app. Pure: no network, no Cesium.
 */

const ENTITY_PREFIX = 'http://www.wikidata.org/entity/';
const ENGLISH_WIKIPEDIA = 'https://en.wikipedia.org/wiki/';
const KIND_BY_CLASS = Object.freeze({
  'UFO sighting': 'sighting',
  'UFO incident': 'sighting',
  'unidentified flying object': 'ufo',
  'close encounter': 'close-encounter',
  'alien abduction': 'abduction',
  'UFO crash': 'crash',
});
export const UFO_KINDS = Object.freeze([
  'sighting',
  'ufo',
  'close-encounter',
  'abduction',
  'crash',
]);
const NUMBER = '(-?\\d+(?:\\.\\d+)?(?:[eE][-+]?\\d+)?)';
const WKT_POINT = new RegExp(
  `^Point\\(\\s*${NUMBER}\\s+${NUMBER}\\s*\\)$`,
  'i',
);
const BARE_QID = /^Q\d+$/;

const value = (binding, name) => {
  const text = binding?.[name]?.value;
  return typeof text === 'string' && text.trim() ? text.trim() : null;
};

const round5 = (degrees) => Math.round(degrees * 1e5) / 1e5;

/** A WKT "Point(lon lat)" inside real-world ranges, or null. */
function parsePoint(text) {
  const match = WKT_POINT.exec(text ?? '');
  if (!match) return null;
  const lon = Number(match[1]);
  const lat = Number(match[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat: round5(lat), lon: round5(lon) };
}

/** @returns {Array<object>|null} incidents sorted by date (undated last), then name */
export function normalizeWikidataUfoIncidents(json) {
  const bindings = json?.results?.bindings;
  if (!Array.isArray(bindings)) return null;
  const items = new Map();
  for (const binding of bindings) {
    const uri = value(binding, 'item');
    if (!uri?.startsWith(ENTITY_PREFIX)) continue;
    const id = uri.slice(ENTITY_PREFIX.length);
    let item = items.get(id);
    if (!item) {
      item = {
        id,
        name: value(binding, 'itemLabel'),
        description: value(binding, 'itemDescription'),
        kinds: new Set(),
        date: null,
        coord: null,
        placeCoord: null,
        place: null,
        wikipedia: null,
      };
      items.set(id, item);
    }
    const kind = KIND_BY_CLASS[value(binding, 'clsLabel')];
    if (kind) item.kinds.add(kind);
    item.coord ??= parsePoint(value(binding, 'coord'));
    const placeCoord = parsePoint(value(binding, 'placeCoord'));
    if (!item.placeCoord && placeCoord) item.placeCoord = placeCoord;
    const place = value(binding, 'placeLabel');
    if (!item.place && place && !BARE_QID.test(place)) item.place = place;
    const date = value(binding, 'date');
    if (!item.date && /^\d{4}-\d{2}-\d{2}T/.test(date ?? ''))
      item.date = date.slice(0, 10);
    const article = value(binding, 'article');
    if (!item.wikipedia && article?.startsWith(ENGLISH_WIKIPEDIA))
      item.wikipedia = article;
  }
  const incidents = [];
  for (const item of items.values()) {
    const location = item.coord ?? item.placeCoord;
    if (!item.name || BARE_QID.test(item.name) || !location) continue;
    incidents.push({
      id: item.id,
      name: item.name,
      description: item.description,
      kinds: UFO_KINDS.filter((kind) => item.kinds.has(kind)),
      date: item.date,
      lat: location.lat,
      lon: location.lon,
      place: item.place,
      approximate: !item.coord,
      wikipedia: item.wikipedia,
      wikidata: `https://www.wikidata.org/wiki/${item.id}`,
    });
  }
  return incidents.sort((a, b) => {
    if (a.date !== b.date) {
      if (a.date === null) return 1;
      if (b.date === null) return -1;
      return a.date < b.date ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}
