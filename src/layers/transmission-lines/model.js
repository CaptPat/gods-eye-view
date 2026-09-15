export const TRANSMISSION_META = Object.freeze({
  id: 'transmission-lines',
  name: 'Transmission Lines',
  icon: '🗼',
  source: 'OpenStreetMap',
  color: '#fb5607',
  selectedSourceId: 'transmission-lines-selected',
  zoomMessage: 'Zoom in to load power lines',
  loadingLabel: 'loading power lines',
  emptyMessage: 'No mapped power lines here',
  saturatedMessage: 'Showing the first lines — zoom in for all',
});

export const TRANSMISSION_QUERY = Object.freeze({
  selectors: Object.freeze([
    'way["power"~"^(line|minor_line|cable)$"]',
    'nwr["power"~"^(substation|plant)$"]',
  ]),
  cap: 2500,
  maxViewDegrees: 1.5,
});

const LINE_KINDS = new Set(['line', 'minor_line', 'cable']);
const KIND_LABELS = Object.freeze({
  line: 'Transmission line',
  minor_line: 'Minor line',
  cable: 'Power cable',
  substation: 'Substation',
  plant: 'Power plant',
});

/** Voltage bands, highest first: [minimum kV, colour, line width]. */
export const VOLTAGE_BANDS = Object.freeze([
  [500, '#ff006e', 4],
  [220, '#fb5607', 3],
  [110, '#ffbe0b', 2.5],
  [33, '#8ecae6', 2],
]);
const UNKNOWN_BAND = ['#adb5bd', 1.5];

/** OSM `voltage` (volts, `;`-separated per circuit) as the highest kV, or null. */
export function voltageKv(value) {
  if (typeof value !== 'string') return null;
  const volts = value
    .split(';')
    .map((part) => part.trim())
    .filter((part) => /^\d+(\.\d+)?$/.test(part))
    .map(Number)
    .filter((number) => number > 0);
  return volts.length ? Math.max(...volts) / 1000 : null;
}

export function classifyTransmissionLine(tags) {
  if (!LINE_KINDS.has(tags?.power)) return null;
  const kv = voltageKv(tags.voltage);
  const band = VOLTAGE_BANDS.find(([minimum]) => kv !== null && kv >= minimum);
  const [color, width] = band ? band.slice(1) : UNKNOWN_BAND;
  return { kind: tags.power, voltageKv: kv, color, width };
}

export function classifyTransmissionPoint(tags) {
  const kv = voltageKv(tags?.voltage);
  if (tags?.power === 'substation')
    return {
      kind: 'substation',
      voltageKv: kv,
      color: '#e0e1dd',
      pixelSize: 6,
    };
  if (tags?.power === 'plant')
    return { kind: 'plant', voltageKv: kv, color: '#ffd166', pixelSize: 8 };
  return null;
}

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const joined = (parts) => parts.filter(Boolean).join(' · ');

function summaryLine({ kind, voltageKv: kv, tags }) {
  if (kind === 'plant') {
    const fuel = tags['plant:source']?.replaceAll(';', '/');
    return joined([
      fuel ? `${capitalize(fuel)} power plant` : KIND_LABELS.plant,
      tags['plant:output:electricity'],
    ]);
  }
  if (kind === 'substation')
    return joined([kv !== null ? `${kv} kV` : null, KIND_LABELS.substation]);
  const circuits = Number(tags.circuits);
  return joined([
    kv !== null ? `${kv} kV` : 'Voltage unknown',
    Number.isInteger(circuits) && circuits > 0
      ? `${circuits} circuit${circuits === 1 ? '' : 's'}`
      : null,
    KIND_LABELS[kind],
  ]);
}

export function buildTransmissionCard(feature) {
  const tags = feature.tags ?? {};
  const kv = feature.voltageKv ?? null;
  const fallback = LINE_KINDS.has(feature.kind)
    ? kv !== null
      ? `${kv} kV power line`
      : 'Power line'
    : KIND_LABELS[feature.kind];
  const title = tags.name || fallback;
  return {
    title,
    details: [
      summaryLine({ ...feature, voltageKv: kv, tags }),
      tags.operator,
    ].filter(Boolean),
    url: `https://www.openstreetmap.org/${feature.id}`,
    accessibilityLabel: `Open ${title} on OpenStreetMap`,
  };
}

/** Legend rows for the layer panel. */
export const TRANSMISSION_LEGEND = Object.freeze([
  { label: '500 kV and above', color: '#ff006e' },
  { label: '220–499 kV', color: '#fb5607' },
  { label: '110–219 kV', color: '#ffbe0b' },
  { label: '33–109 kV', color: '#8ecae6' },
  { label: 'Lower or unknown voltage', color: '#adb5bd' },
  { label: 'Substations', color: '#e0e1dd' },
  { label: 'Power plants', color: '#ffd166' },
]);
