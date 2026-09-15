/**
 * Wikidata SPARQL bindings → one located record per item, with declared extra
 * fields. Shared by the bundled Wikidata point layers. Pure: no network, no Cesium.
 *
 * Expected variables: `item`, `itemLabel`, and optionally `itemDescription`,
 * `clsLabel`, `coord`, `placeCoord`, `placeLabel`, `date`, `article`, plus
 * whatever each field names in `variable`.
 */

const ENTITY_PREFIX = 'http://www.wikidata.org/entity/';
const ENGLISH_WIKIPEDIA = 'https://en.wikipedia.org/wiki/';
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

function parsePoint(text) {
  const match = WKT_POINT.exec(text ?? '');
  if (!match) return null;
  const lon = Number(match[1]);
  const lat = Number(match[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat: round5(lat), lon: round5(lon) };
}

/** A raw binding value as a field type; null when it does not parse or is an unlabelled QID. */
function typedValue(type, raw) {
  if (type === 'number') {
    const number = Number(raw);
    return Number.isFinite(number) ? number : null;
  }
  if (type === 'year') {
    const match = /^(\d{4})-\d{2}-\d{2}T/.exec(raw);
    return match ? Number(match[1]) : null;
  }
  return BARE_QID.test(raw) ? null : raw;
}

function pickValue(spec, values) {
  if (spec.type === 'list') return values;
  if (!values.length) return null;
  if (spec.pick === 'max') return Math.max(...values);
  if (spec.pick === 'min') return Math.min(...values);
  return values[0];
}

function compareByName(a, b) {
  return a.name.localeCompare(b.name);
}

function compareByDate(a, b) {
  if (a.date !== b.date) {
    if (a.date === null) return 1;
    if (b.date === null) return -1;
    return a.date < b.date ? -1 : 1;
  }
  return compareByName(a, b);
}

/**
 * @param {object} json SPARQL JSON results
 * @param {object} [options]
 * @param {Record<string, string>} [options.kindByClass] class label → kind
 * @param {Record<string, {variable: string, type?: 'text'|'number'|'year'|'list', pick?: 'first'|'min'|'max'}>} [options.fields]
 * @param {'name'|'date'} [options.sort]
 * @returns {Array<object>|null}
 */
export function normalizeWikidataPoints(
  json,
  { kindByClass = {}, fields = {}, sort = 'name' } = {},
) {
  const bindings = json?.results?.bindings;
  if (!Array.isArray(bindings)) return null;
  const fieldEntries = Object.entries(fields);
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
        values: Object.fromEntries(fieldEntries.map(([name]) => [name, []])),
      };
      items.set(id, item);
    }
    const kind = kindByClass[value(binding, 'clsLabel')];
    if (kind) item.kinds.add(kind);
    item.coord ??= parsePoint(value(binding, 'coord'));
    item.placeCoord ??= parsePoint(value(binding, 'placeCoord'));
    const place = value(binding, 'placeLabel');
    if (!item.place && place && !BARE_QID.test(place)) item.place = place;
    const date = value(binding, 'date');
    if (!item.date && /^\d{4}-\d{2}-\d{2}T/.test(date ?? ''))
      item.date = date.slice(0, 10);
    const article = value(binding, 'article');
    if (!item.wikipedia && article?.startsWith(ENGLISH_WIKIPEDIA))
      item.wikipedia = article;
    for (const [name, spec] of fieldEntries) {
      const raw = value(binding, spec.variable);
      if (raw === null) continue;
      const typed = typedValue(spec.type ?? 'text', raw);
      if (typed !== null && !item.values[name].includes(typed))
        item.values[name].push(typed);
    }
  }
  const records = [];
  for (const item of items.values()) {
    const location = item.coord ?? item.placeCoord;
    if (!item.name || BARE_QID.test(item.name) || !location) continue;
    const record = {
      id: item.id,
      name: item.name,
      description: item.description,
      kinds: [...item.kinds],
      date: item.date,
      lat: location.lat,
      lon: location.lon,
      place: item.place,
      approximate: !item.coord,
      wikipedia: item.wikipedia,
      wikidata: `https://www.wikidata.org/wiki/${item.id}`,
    };
    for (const [name, spec] of fieldEntries)
      record[name] = pickValue(spec, item.values[name]);
    records.push(record);
  }
  return records.sort(sort === 'date' ? compareByDate : compareByName);
}
