/** Pure US Pipelines model: layer meta, kind styles, offshore product codes, card text and snapshot parsing. */

export const US_PIPELINES_META = Object.freeze({
  id: 'us-pipelines',
  name: 'US Pipelines',
  icon: '〰️',
  source: 'EIA · BSEE',
  color: '#ffb703',
  selectedSourceId: 'us-pipelines-selected',
  loadingLabel: 'Loading US pipelines',
  unavailableText: 'US pipeline data unavailable',
  refreshFailedText: 'US pipeline refresh failed',
});

export const PIPELINE_FIELDS = Object.freeze([
  'id',
  'kind',
  'name',
  'operator',
  'route',
  'product',
  'sizeIn',
  'status',
  'positions',
]);

export const PIPELINE_KINDS = Object.freeze({
  'gas-interstate': Object.freeze({
    label: 'Interstate natural gas pipeline',
    color: '#ffb703',
    width: 2,
  }),
  'gas-intrastate': Object.freeze({
    label: 'Intrastate natural gas pipeline',
    color: '#ffd166',
    width: 1.5,
  }),
  crude: Object.freeze({
    label: 'Crude oil trunk pipeline',
    color: '#8338ec',
    width: 3,
  }),
  hgl: Object.freeze({
    label: 'Hydrocarbon gas liquids pipeline',
    color: '#06d6a0',
    width: 2.5,
  }),
  'ocs-oil': Object.freeze({
    label: 'Offshore oil pipeline',
    color: '#b388ff',
    width: 1.5,
  }),
  'ocs-gas': Object.freeze({
    label: 'Offshore gas pipeline',
    color: '#ffe066',
    width: 1.5,
  }),
});

/**
 * BSEE Pipeline Masters product codes that carry hydrocarbons, as
 * `[kind, label]`. Water, chemicals, cables, umbilicals, casings, service,
 * test, spare and tow-route codes are deliberately absent.
 */
const OCS_PRODUCTS = Object.freeze({
  BLKO: ['oil', 'Bulk oil (full well stream)'],
  BLOH: ['oil', 'Bulk oil (H2S)'],
  OIL: ['oil', 'Oil, after first processing'],
  OILH: ['oil', 'Processed oil (H2S)'],
  'O/W': ['oil', 'Oil and water'],
  COND: ['oil', 'Condensate'],
  'G/O': ['oil', 'Gas and oil'],
  'G/OH': ['oil', 'Gas and oil (H2S)'],
  BLKG: ['gas', 'Bulk gas (full well stream)'],
  BLGH: ['gas', 'Bulk gas (H2S)'],
  GAS: ['gas', 'Gas, after first processing'],
  GASH: ['gas', 'Processed gas (H2S)'],
  'G/C': ['gas', 'Gas and condensate'],
  'G/CH': ['gas', 'Gas and condensate (H2S)'],
  LIFT: ['gas', 'Gas lift'],
  SPLY: ['gas', 'Supply gas'],
  INJ: ['gas', 'Gas injection'],
  NGER: ['gas', 'Natural gas enhanced recovery'],
  FLG: ['gas', 'Flare gas'],
  NGL: ['gas', 'Natural gas liquids'],
  LPRO: ['gas', 'Liquid propane'],
  LGER: ['gas', 'Liquid gas enhanced recovery'],
});

/** `{ kind: 'oil' | 'gas', label }` for a hydrocarbon product code, else null. */
export function ocsProduct(code) {
  const entry = Object.hasOwn(OCS_PRODUCTS, code ?? '')
    ? OCS_PRODUCTS[code]
    : null;
  return entry ? { kind: entry[0], label: entry[1] } : null;
}

const TITLE_CHARS = 34;
const clip = (text, limit) =>
  text.length > limit ? `${text.slice(0, limit - 1)}…` : text;

export function buildPipelineCard(record) {
  const label = PIPELINE_KINDS[record.kind]?.label ?? 'Pipeline';
  let title;
  let details;
  if (String(record.kind).startsWith('ocs-')) {
    const segment = String(record.id ?? '').replace(/^ocs\//, '');
    title = `Offshore segment ${segment}`;
    details = [
      [
        ocsProduct(record.product)?.label ?? label,
        Number.isFinite(record.sizeIn) ? `${record.sizeIn}-inch` : null,
        record.status === 'OUT' ? 'Out of service' : null,
      ]
        .filter(Boolean)
        .join(' · '),
      record.route,
      record.operator,
    ];
  } else {
    title = record.name || record.operator || label;
    details = [label, record.name ? record.operator : null];
  }
  title = clip(title, TITLE_CHARS);
  return {
    title,
    details: details.filter(Boolean),
    url: null,
    accessibilityLabel: `${title} pipeline`,
  };
}

/** Records → compact rows in `PIPELINE_FIELDS` order. */
export function toPipelineRows(records) {
  return records.map((record) =>
    PIPELINE_FIELDS.map((field) => record[field] ?? null),
  );
}

const isRecord = (record) =>
  typeof record.id === 'string' &&
  record.id !== '' &&
  Object.hasOwn(PIPELINE_KINDS, record.kind ?? '') &&
  Array.isArray(record.positions) &&
  record.positions.length >= 4 &&
  record.positions.length % 2 === 0 &&
  record.positions.every(Number.isFinite);

/** `{ fields, rows }` snapshot → styled `{ records, stale }`, or null when the shape is wrong. */
export function parsePipelineSnapshot(json) {
  if (
    JSON.stringify(json?.fields) !== JSON.stringify(PIPELINE_FIELDS) ||
    !Array.isArray(json.rows)
  )
    return null;
  return {
    records: json.rows
      .filter(Array.isArray)
      .map((row) =>
        Object.fromEntries(
          PIPELINE_FIELDS.map((field, index) => [field, row[index] ?? null]),
        ),
      )
      .filter(isRecord)
      .map((record) => {
        const { color, width } = PIPELINE_KINDS[record.kind];
        return { ...record, color, width };
      }),
    stale: false,
  };
}
