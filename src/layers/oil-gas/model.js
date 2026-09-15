export const OIL_GAS_META = Object.freeze({
  id: 'oil-gas',
  name: 'Oil & Gas',
  icon: '🛢️',
  source: 'OpenStreetMap',
  color: '#ffb703',
  selectedSourceId: 'oil-gas-selected',
  zoomMessage: 'Zoom in to load oil and gas infrastructure',
  loadingLabel: 'loading oil and gas infrastructure',
  emptyMessage: 'No mapped oil or gas infrastructure here',
  saturatedMessage: 'Showing the first features — zoom in for all',
});

export const OIL_GAS_QUERY = Object.freeze({
  selectors: Object.freeze([
    'way["man_made"="pipeline"]["substance"!~"^(water|sewage|hot_water|steam|heat)$"]',
    'node["man_made"="petroleum_well"]',
    'nwr["man_made"="offshore_platform"]',
    'nwr["industrial"~"^(refinery|oil|gas)$"]',
  ]),
  cap: 3000,
  maxViewDegrees: 1,
});

const NOT_HYDROCARBON = /^(water|sewage|hot_water|steam|heat)$/;
const OIL =
  /oil|petrol|gasoline|diesel|fuel|kerosene|naphtha|condensate|crude|jet/;
const GAS = /gas|methane|lng|lpg|propane|ethane|butane/;

/** 'oil', 'gas', 'other', 'unknown', or null for water-like pipelines. Refined fuels test as oil first ('gasoline'). */
export function pipelineSubstance(tags) {
  const value = String(tags?.substance ?? tags?.type ?? '')
    .trim()
    .toLowerCase();
  if (!value) return 'unknown';
  if (NOT_HYDROCARBON.test(value)) return null;
  if (OIL.test(value)) return 'oil';
  if (GAS.test(value)) return 'gas';
  return 'other';
}

const PIPELINE_STYLES = Object.freeze({
  gas: { color: '#ffb703', width: 2 },
  oil: { color: '#8338ec', width: 2 },
  other: { color: '#adb5bd', width: 1.5 },
  unknown: { color: '#adb5bd', width: 1.5 },
});

export function classifyOilGasLine(tags) {
  if (tags?.man_made !== 'pipeline') return null;
  const substance = pipelineSubstance(tags);
  if (!substance) return null;
  return { kind: 'pipeline', substance, ...PIPELINE_STYLES[substance] };
}

export function classifyOilGasPoint(tags) {
  if (tags?.man_made === 'petroleum_well')
    return { kind: 'well', color: '#9d4edd', pixelSize: 4 };
  if (tags?.man_made === 'offshore_platform')
    return { kind: 'platform', color: '#00b4d8', pixelSize: 8 };
  if (tags?.industrial === 'refinery')
    return { kind: 'refinery', color: '#f77f00', pixelSize: 9 };
  if (tags?.industrial === 'oil' || tags?.industrial === 'gas')
    return { kind: 'facility', color: '#fb8500', pixelSize: 7 };
  return null;
}

const KIND_LABELS = Object.freeze({
  pipeline: 'Pipeline',
  well: 'Petroleum well',
  platform: 'Offshore platform',
  refinery: 'Refinery',
  facility: 'Oil & gas facility',
});

const humanize = (value) => {
  const text = String(value).replaceAll('_', ' ').replaceAll(';', '/');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

function substanceLabel(tags) {
  const raw = String(tags.substance ?? tags.type ?? '').toLowerCase();
  if (!raw) return 'Substance unknown';
  if (raw === 'gas' || raw === 'natural_gas') return 'Natural gas';
  return humanize(raw);
}

function pipelineLine(tags) {
  const diameter = tags.diameter?.trim();
  return [
    substanceLabel(tags),
    tags.location,
    diameter
      ? /^\d+(\.\d+)?$/.test(diameter)
        ? `${diameter} mm`
        : diameter
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The kind label is repeated in details only when the title is a real name, or when nothing else would show. */
export function buildOilGasCard(feature) {
  const tags = feature.tags ?? {};
  const label = KIND_LABELS[feature.kind] ?? 'Oil & gas feature';
  const title = tags.name || label;
  const first =
    feature.kind === 'pipeline' ? pipelineLine(tags) : tags.name ? label : null;
  const details = [first, tags.operator].filter(Boolean);
  return {
    title,
    details: details.length ? details : [label],
    url: `https://www.openstreetmap.org/${feature.id}`,
    accessibilityLabel: `Open ${title} on OpenStreetMap`,
  };
}

/** Legend rows for the layer panel. */
export const OIL_GAS_LEGEND = Object.freeze([
  { label: 'Gas pipelines', color: '#ffb703' },
  { label: 'Oil and fuel pipelines', color: '#8338ec' },
  { label: 'Other or unknown pipelines', color: '#adb5bd' },
  { label: 'Wells', color: '#9d4edd' },
  { label: 'Offshore platforms', color: '#00b4d8' },
  { label: 'Refineries', color: '#f77f00' },
  { label: 'Oil and gas works', color: '#fb8500' },
]);
