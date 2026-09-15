/** Pure UFO Incidents model: layer meta, snapshot parsing and card text. */

export const UFO_INCIDENTS_META = Object.freeze({
  id: 'ufo-incidents',
  name: 'UFO Incidents',
  icon: '🛸',
  source: 'Wikidata',
  color: '#39ff14',
  selectedSourceId: 'ufo-incidents-selected',
  loadingLabel: 'Loading incidents',
  unavailableText: 'UFO incidents unavailable',
  refreshFailedText: 'UFO incidents refresh failed',
});

const KIND_LABELS = Object.freeze({
  sighting: 'Sighting',
  ufo: 'UFO',
  'close-encounter': 'Close encounter',
  abduction: 'Abduction claim',
  crash: 'Crash claim',
});
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const TITLE_CHARS = 34;
const DESCRIPTION_CHARS = 64;

const clip = (text, limit) =>
  text.length > limit ? `${text.slice(0, limit - 1)}…` : text;

/** "1994-09-16" → "16 Sep 1994"; a January 1st date is Wikidata's year-only form. */
export function formatIncidentDate(date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '');
  const month = match ? Number(match[2]) : 0;
  if (!match || month < 1 || month > 12) return 'Date unknown';
  if (match[2] === '01' && match[3] === '01') return match[1];
  return `${Number(match[3])} ${MONTHS[month - 1]} ${match[1]}`;
}

function coordinates(lat, lon) {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(2)}°${ns} ${Math.abs(lon).toFixed(2)}°${ew}`;
}

export function buildUfoCard(incident) {
  const kinds =
    (incident.kinds ?? [])
      .map((kind) => KIND_LABELS[kind])
      .filter(Boolean)
      .join(' / ') || 'Incident';
  const where = incident.place
    ? incident.approximate
      ? `Somewhere in ${incident.place} (approximate)`
      : incident.place
    : `${coordinates(incident.lat, incident.lon)}${incident.approximate ? ' (approximate)' : ''}`;
  const details = [`${kinds} · ${formatIncidentDate(incident.date)}`, where];
  if (incident.description)
    details.push(clip(incident.description, DESCRIPTION_CHARS));
  return {
    title: clip(incident.name, TITLE_CHARS),
    details,
    url: incident.wikipedia ?? incident.wikidata ?? null,
    accessibilityLabel: incident.wikipedia
      ? `Open the Wikipedia article on ${incident.name}`
      : `Open the Wikidata entry on ${incident.name}`,
  };
}

const isIncident = (incident) =>
  typeof incident?.id === 'string' &&
  incident.id !== '' &&
  typeof incident.name === 'string' &&
  Number.isFinite(incident.lat) &&
  Number.isFinite(incident.lon) &&
  Math.abs(incident.lat) <= 90 &&
  Math.abs(incident.lon) <= 180;

/** The bundled snapshot → `{ records, stale }` for the catalog layer, or null. */
export function parseUfoSnapshot(json) {
  if (!Array.isArray(json?.incidents)) return null;
  return {
    records: json.incidents
      .filter(isIncident)
      .map((incident) => ({ ...incident })),
    stale: false,
  };
}
