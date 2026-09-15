/** Pure model for the heritage layers: meta, compact rows, styling and card text. */

const meta = (id, name, icon, color, noun) =>
  Object.freeze({
    id,
    name,
    icon,
    source: 'Wikidata',
    color,
    selectedSourceId: `${id}-selected`,
    loadingLabel: `Loading ${name.toLowerCase()}`,
    unavailableText: `${noun} data unavailable`,
    refreshFailedText: `${noun} refresh failed`,
  });

export const HERITAGE_LAYERS = Object.freeze({
  worldHeritage: meta(
    'world-heritage',
    'World Heritage Sites',
    '🏛️',
    '#d4af37',
    'World heritage',
  ),
  forts: meta(
    'forts-castles',
    'Forts & Castles',
    '🏰',
    '#b5543c',
    'Fort and castle',
  ),
  parks: meta(
    'parks-monuments',
    'National Parks & Monuments',
    '🏞️',
    '#52b788',
    'Park and monument',
  ),
});

export const HERITAGE_FIELDS = Object.freeze({
  worldHeritage: Object.freeze([
    'id',
    'name',
    'lat',
    'lon',
    'countries',
    'year',
    'wiki',
    'description',
  ]),
  forts: Object.freeze(['id', 'name', 'kind', 'lat', 'lon', 'country', 'wiki']),
  parks: Object.freeze([
    'id',
    'name',
    'kind',
    'lat',
    'lon',
    'country',
    'year',
    'wiki',
    'description',
  ]),
});

export const FORT_COLORS = Object.freeze({
  castle: '#b5543c',
  fort: '#6b8e23',
  fortification: '#c2b280',
  'star-fort': '#ff8c42',
});

const PARK_COLORS = Object.freeze({ park: '#52b788', monument: '#2a9d8f' });
const FORT_LABELS = Object.freeze({
  castle: 'Castle',
  fort: 'Fort',
  fortification: 'Fortification',
  'star-fort': 'Star fort',
});
/** An item in several fort classes reads as its most specific one. */
const FORT_KIND_PRIORITY = Object.freeze([
  'star-fort',
  'castle',
  'fort',
  'fortification',
]);
const WIKIPEDIA = 'https://en.wikipedia.org/wiki/';
const TITLE_CHARS = 34;
const DESCRIPTION_CHARS = 64;

const clip = (text, limit) =>
  text.length > limit ? `${text.slice(0, limit - 1)}…` : text;

function wikiTitle(url) {
  return typeof url === 'string' && url.startsWith(WIKIPEDIA)
    ? url.slice(WIKIPEDIA.length)
    : null;
}

function primaryKind(kind, kinds = []) {
  if (kind === 'forts')
    return FORT_KIND_PRIORITY.find((k) => kinds.includes(k)) ?? 'fortification';
  if (kind === 'parks') return kinds.includes('park') ? 'park' : 'monument';
  return null;
}

/** Normalised Wikidata records → compact rows in HERITAGE_FIELDS[kind] order. */
export function toHeritageRows(kind, records) {
  const fields = HERITAGE_FIELDS[kind];
  if (!fields) throw new TypeError(`Unknown heritage layer: ${kind}`);
  return records.map((record) => {
    const values = {
      id: record.id,
      name: record.name,
      kind: primaryKind(kind, record.kinds),
      lat: record.lat,
      lon: record.lon,
      countries: record.countries ?? [],
      country: record.country ?? null,
      year: record.year ?? null,
      wiki: wikiTitle(record.wikipedia),
      description: record.description ?? null,
    };
    return fields.map((field) => values[field]);
  });
}

function link(record) {
  return record.wiki
    ? {
        url: `${WIKIPEDIA}${record.wiki}`,
        accessibilityLabel: `Open the Wikipedia article on ${record.name}`,
      }
    : {
        url: `https://www.wikidata.org/wiki/${record.id}`,
        accessibilityLabel: `Open the Wikidata entry on ${record.name}`,
      };
}

const established = (year) => (year ? ` · established ${year}` : '');

export function buildWorldHeritageCard(record) {
  const details = [`World Heritage Site${established(record.year)}`];
  if (record.countries?.length) details.push(record.countries.join(', '));
  if (record.description)
    details.push(clip(record.description, DESCRIPTION_CHARS));
  return { title: clip(record.name, TITLE_CHARS), details, ...link(record) };
}

export function buildFortCard(record) {
  const kind = FORT_LABELS[record.kind] ?? FORT_LABELS.fortification;
  return {
    title: clip(record.name, TITLE_CHARS),
    details: [[kind, record.country].filter(Boolean).join(' · ')],
    ...link(record),
  };
}

export function buildParkCard(record) {
  const kind =
    record.kind === 'monument' ? 'National monument' : 'National park';
  const details = [`${kind}${established(record.year)}`];
  if (record.country) details.push(record.country);
  if (record.description)
    details.push(clip(record.description, DESCRIPTION_CHARS));
  return { title: clip(record.name, TITLE_CHARS), details, ...link(record) };
}

const STYLES = Object.freeze({
  worldHeritage: () => ({ color: '#d4af37', pixelSize: 7 }),
  forts: (record) => ({
    color: FORT_COLORS[record.kind] ?? FORT_COLORS.fortification,
    pixelSize: 4,
  }),
  parks: (record) => ({
    color: PARK_COLORS[record.kind] ?? PARK_COLORS.park,
    pixelSize: 6,
  }),
});

const isRecord = (record) =>
  typeof record.id === 'string' &&
  record.id !== '' &&
  typeof record.name === 'string' &&
  Number.isFinite(record.lat) &&
  Number.isFinite(record.lon) &&
  Math.abs(record.lat) <= 90 &&
  Math.abs(record.lon) <= 180;

/** A compact snapshot → styled `{ records, stale }` for one heritage layer, or null. */
export function parseHeritageSnapshot(json, kind) {
  const fields = HERITAGE_FIELDS[kind];
  if (
    !fields ||
    JSON.stringify(json?.fields) !== JSON.stringify(fields) ||
    !Array.isArray(json.rows)
  )
    return null;
  return {
    records: json.rows
      .filter(Array.isArray)
      .map((row) =>
        Object.fromEntries(
          fields.map((field, index) => [field, row[index] ?? null]),
        ),
      )
      .filter(isRecord)
      .map((record) => ({ ...record, ...STYLES[kind](record) })),
    stale: false,
  };
}
