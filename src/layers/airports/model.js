/** Pure Airports model: layer meta, size styling, card text and snapshot parsing. */
import { AIRPORT_FIELDS } from './source.js';

export const AIRPORTS_META = Object.freeze({
  id: 'airports',
  name: 'Airports',
  icon: '✈️',
  source: 'OurAirports',
  color: '#9ec5ff',
  selectedSourceId: 'airports-selected',
  loadingLabel: 'Loading airports',
  unavailableText: 'Airport data unavailable',
  refreshFailedText: 'Airport refresh failed',
});

const SIZE_STYLES = Object.freeze({
  large: Object.freeze({ color: '#ffffff', pixelSize: 7 }),
  medium: Object.freeze({ color: '#9ec5ff', pixelSize: 5 }),
});

const TITLE_CHARS = 34;
const clip = (text, limit) =>
  text.length > limit ? `${text.slice(0, limit - 1)}…` : text;

export function buildAirportCard(record) {
  const codes =
    [record.icao && `ICAO ${record.icao}`, record.iata && `IATA ${record.iata}`]
      .filter(Boolean)
      .join(' · ') || 'No ICAO or IATA code';
  const kind = `${record.size === 'large' ? 'Large' : 'Medium'} airport${
    record.scheduled ? ' · scheduled service' : ''
  }`;
  const place = [record.city, record.country].filter(Boolean).join(', ');
  const elevation = Number.isFinite(record.elevationFt)
    ? `${record.elevationFt.toLocaleString('en-US')} ft`
    : null;
  const where = [place || null, elevation].filter(Boolean).join(' · ');
  const details = [codes, kind];
  if (where) details.push(where);
  return {
    title: clip(record.name, TITLE_CHARS),
    details,
    url:
      record.wikipedia ??
      `https://ourairports.com/airports/${encodeURIComponent(record.id)}/`,
    accessibilityLabel: record.wikipedia
      ? `Open the Wikipedia article on ${record.name}`
      : `Open the OurAirports page for ${record.name}`,
  };
}

const isRecord = (record) =>
  typeof record.id === 'string' &&
  record.id !== '' &&
  typeof record.name === 'string' &&
  Object.hasOwn(SIZE_STYLES, record.size) &&
  Number.isFinite(record.lat) &&
  Number.isFinite(record.lon) &&
  Math.abs(record.lat) <= 90 &&
  Math.abs(record.lon) <= 180;

/** `{ fields, rows }` snapshot → styled `{ records, stale }`, or null when the shape is wrong. */
export function parseAirportSnapshot(json) {
  if (
    JSON.stringify(json?.fields) !== JSON.stringify(AIRPORT_FIELDS) ||
    !Array.isArray(json.rows)
  )
    return null;
  return {
    records: json.rows
      .filter(Array.isArray)
      .map((row) =>
        Object.fromEntries(
          AIRPORT_FIELDS.map((field, index) => [field, row[index] ?? null]),
        ),
      )
      .filter(isRecord)
      .map((record) => ({ ...record, ...SIZE_STYLES[record.size] })),
    stale: false,
  };
}
