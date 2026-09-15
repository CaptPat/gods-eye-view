/** Pure model for the nuclear layers: layer meta, status and styling, card text. */

const meta = (id, name, icon, color, noun) =>
  Object.freeze({
    id,
    name,
    icon,
    source: 'Wikidata',
    color,
    selectedSourceId: `${id}-selected`,
    loadingLabel: `Loading ${noun}`,
    unavailableText: `Nuclear ${noun.replace(/s$/, '')} data unavailable`,
    refreshFailedText: `Nuclear ${noun.replace(/s$/, '')} refresh failed`,
  });

export const NUCLEAR_LAYERS = Object.freeze({
  plants: Object.freeze({
    ...meta(
      'nuclear-power-plants',
      'Nuclear Power Plants',
      '☢️',
      '#ffd60a',
      'plants',
    ),
  }),
  waste: Object.freeze({
    ...meta(
      'nuclear-waste-sites',
      'Nuclear Waste Sites',
      '⚠️',
      '#c77dff',
      'waste sites',
    ),
  }),
  accidents: Object.freeze({
    ...meta(
      'nuclear-accidents',
      'Nuclear Accidents',
      '💥',
      '#ff5a1f',
      'accidents',
    ),
  }),
});

export const PLANT_STATUS_COLORS = Object.freeze({
  operating: '#ffd60a',
  construction: '#4cc9f0',
  planned: '#b388ff',
  decommissioned: '#8d99ae',
  cancelled: '#5c677d',
  unknown: '#adb5bd',
});

const STATUS_LABELS = Object.freeze({
  operating: 'Operating',
  construction: 'Under construction',
  planned: 'Planned',
  decommissioned: 'Decommissioned',
  cancelled: 'Cancelled',
  unknown: 'Status unknown',
});

const WASTE_COLOR = '#c77dff';
const WASTE_PIXEL_SIZE = 8;
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
const round2 = (value) => Math.round(value * 100) / 100;

/**
 * One status from Wikidata's (often several) states of use. Any unit in use
 * makes the plant operating; otherwise construction, then a retirement year or
 * decommissioned state, then plans, then cancellation.
 */
export function plantStatus({ statuses = [], endYear = null }) {
  const has = (pattern) => statuses.some((status) => pattern.test(status));
  if (has(/\bin use\b|partial operation|starting up/)) return 'operating';
  if (has(/under construction/)) return 'construction';
  if (Number.isFinite(endYear) || has(/decommission/)) return 'decommissioned';
  if (has(/proposed|project|postponed|planned/)) return 'planned';
  if (has(/cancel/)) return 'cancelled';
  return 'unknown';
}

/** 6 px at 100 MW or less, two more per tenfold capacity, capped at 11. */
export function plantPixelSize(capacityMw) {
  if (!Number.isFinite(capacityMw)) return 6;
  const size = round2(2 + 2 * Math.log10(Math.max(capacityMw, 100)));
  return Math.min(11, Math.max(6, size));
}

export function accidentColor(ines) {
  if (!Number.isFinite(ines)) return '#ff9f43';
  if (ines >= 7) return '#ff1f1f';
  if (ines >= 6) return '#ff5a1f';
  if (ines >= 5) return '#ff8c1a';
  if (ines >= 4) return '#ffb020';
  return '#ffd166';
}

export function accidentPixelSize(ines) {
  if (!Number.isFinite(ines)) return 7;
  return Math.min(13, Math.max(7, 7 + (ines - 3) * 1.5));
}

function link(record) {
  return {
    url: record.wikipedia ?? record.wikidata ?? null,
    accessibilityLabel: record.wikipedia
      ? `Open the Wikipedia article on ${record.name}`
      : `Open the Wikidata entry on ${record.name}`,
  };
}

function formatDay(date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '');
  const month = match ? Number(match[2]) : 0;
  if (!match || month < 1 || month > 12) return 'Date unknown';
  if (match[2] === '01' && match[3] === '01') return match[1];
  return `${Number(match[3])} ${MONTHS[month - 1]} ${match[1]}`;
}

const joined = (...parts) => parts.filter(Boolean).join(' · ');

export function buildPlantCard(record) {
  const status = STATUS_LABELS[plantStatus(record)];
  const details = [
    Number.isFinite(record.capacityMw)
      ? `${status} · ${Math.round(record.capacityMw).toLocaleString('en-US')} MW`
      : status,
  ];
  if (record.operator) details.push(record.operator);
  const { startYear: start, endYear: end } = record;
  const years =
    start && end
      ? `In service ${start}–${end}`
      : start
        ? `Since ${start}`
        : end
          ? `Closed ${end}`
          : null;
  const tail = joined(years, record.country);
  if (tail) details.push(tail);
  return { title: clip(record.name, TITLE_CHARS), details, ...link(record) };
}

export function buildWasteCard(record) {
  const kind = record.kinds?.includes('deep-geological')
    ? 'Deep geological repository'
    : 'Radioactive waste repository';
  const details = [`${kind}${record.approximate ? ' (approximate)' : ''}`];
  const where = joined(record.place, record.country);
  if (where) details.push(where);
  if (record.description)
    details.push(clip(record.description, DESCRIPTION_CHARS));
  return { title: clip(record.name, TITLE_CHARS), details, ...link(record) };
}

export function buildAccidentCard(record) {
  const rating = Number.isFinite(record.ines)
    ? `INES ${record.ines}`
    : 'Not rated';
  const details = [`${rating} · ${formatDay(record.date)}`];
  const deaths = Number.isFinite(record.deaths)
    ? `${record.deaths.toLocaleString('en-US')} ${record.deaths === 1 ? 'death' : 'deaths'}`
    : null;
  const toll = joined(deaths, record.country);
  if (toll) details.push(toll);
  if (record.description)
    details.push(clip(record.description, DESCRIPTION_CHARS));
  return { title: clip(record.name, TITLE_CHARS), details, ...link(record) };
}

const isRecord = (record) =>
  typeof record?.id === 'string' &&
  record.id !== '' &&
  typeof record.name === 'string' &&
  Number.isFinite(record.lat) &&
  Number.isFinite(record.lon) &&
  Math.abs(record.lat) <= 90 &&
  Math.abs(record.lon) <= 180;

const STYLES = Object.freeze({
  plants: (record) => ({
    color: PLANT_STATUS_COLORS[plantStatus(record)],
    pixelSize: plantPixelSize(record.capacityMw),
  }),
  waste: () => ({ color: WASTE_COLOR, pixelSize: WASTE_PIXEL_SIZE }),
  accidents: (record) => ({
    color: accidentColor(record.ines),
    pixelSize: accidentPixelSize(record.ines),
  }),
});

/** A bundled snapshot → styled `{ records, stale }` for one layer kind, or null. */
export function parseNuclearSnapshot(json, kind) {
  const style = STYLES[kind];
  if (!style || !Array.isArray(json?.records)) return null;
  return {
    records: json.records
      .filter(isRecord)
      .map((record) => ({ ...record, ...style(record) })),
    stale: false,
  };
}
