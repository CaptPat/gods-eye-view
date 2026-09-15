/** Pure Offshore Platforms model: layer meta, structure-type styles, card text and snapshot parsing. */

export const OFFSHORE_PLATFORMS_META = Object.freeze({
  id: 'offshore-platforms',
  name: 'Offshore Platforms',
  icon: '🏗️',
  source: 'BSEE',
  color: '#00b4d8',
  selectedSourceId: 'offshore-platforms-selected',
  loadingLabel: 'Loading offshore platforms',
  unavailableText: 'Offshore platform data unavailable',
  refreshFailedText: 'Offshore platform refresh failed',
});

export const PLATFORM_FIELDS = Object.freeze([
  'id',
  'name',
  'lat',
  'lon',
  'area',
  'block',
  'type',
  'installed',
  'waterDepthFt',
  'distanceToShoreNm',
  'operator',
  'products',
  'manned',
  'heliport',
]);

const FLOATING = { color: '#ff006e', pixelSize: 8 };
const TOWER = { color: '#00b4d8', pixelSize: 6 };
const SUBSEA = { color: '#adb5bd', pixelSize: 3 };

/** BSEE structure type codes, from the Platform Structures field values page. */
export const STRUCTURE_TYPES = Object.freeze({
  SPAR: { label: 'SPAR platform', ...FLOATING },
  TLP: { label: 'Tension leg platform', ...FLOATING },
  MTLP: { label: 'Mini tension leg platform', ...FLOATING },
  SEMI: { label: 'Semi-submersible production unit', ...FLOATING },
  FPSO: { label: 'FPSO vessel', ...FLOATING },
  FIXED: { label: 'Fixed leg platform', ...TOWER },
  CT: { label: 'Compliant tower', ...TOWER },
  MOPU: { label: 'Mobile production unit', color: '#ffbe0b', pixelSize: 6 },
  CAIS: { label: 'Caisson', color: '#8ecae6', pixelSize: 4 },
  WP: { label: 'Well protector', color: '#90be6d', pixelSize: 4 },
  SSMNF: { label: 'Subsea manifold', ...SUBSEA },
  SSTMP: { label: 'Subsea template', ...SUBSEA },
  SSANC: { label: 'Subsea anchor', ...SUBSEA },
  UCOMP: { label: 'Underwater completion', ...SUBSEA },
});

export function structureStyle(type) {
  const known = STRUCTURE_TYPES[type];
  if (known) return { ...known };
  return {
    label: type ? `Structure ${type}` : 'Offshore structure',
    ...SUBSEA,
  };
}

const TITLE_CHARS = 34;
const clip = (text, limit) =>
  text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
const joined = (parts) => parts.filter(Boolean).join(' · ');
const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

export function buildOffshorePlatformCard(record) {
  const title = clip(
    [record.area, record.block, record.name].filter(Boolean).join(' ') ||
      'Offshore structure',
    TITLE_CHARS,
  );
  const products = Array.isArray(record.products) ? record.products : [];
  const details = [
    joined([
      structureStyle(record.type).label,
      Number.isFinite(record.waterDepthFt)
        ? `${record.waterDepthFt.toLocaleString('en-US')} ft water`
        : null,
    ]),
    record.operator,
    joined([
      products.length ? capitalize(products.join(', ')) : null,
      record.manned ? 'Manned' : null,
      Number.isFinite(record.distanceToShoreNm)
        ? `${record.distanceToShoreNm} nm offshore`
        : null,
    ]),
    record.installed ? `Installed ${record.installed.slice(0, 4)}` : null,
  ].filter(Boolean);
  return {
    title,
    details,
    url: null,
    accessibilityLabel: `${title} offshore platform`,
  };
}

/** Records → compact rows in `PLATFORM_FIELDS` order. */
export function toPlatformRows(records) {
  return records.map((record) =>
    PLATFORM_FIELDS.map((field) => record[field] ?? null),
  );
}

const isRecord = (record) =>
  typeof record.id === 'string' &&
  record.id !== '' &&
  Number.isFinite(record.lat) &&
  Number.isFinite(record.lon) &&
  Math.abs(record.lat) <= 90 &&
  Math.abs(record.lon) <= 180;

/** `{ fields, rows }` snapshot → styled `{ records, stale }`, or null when the shape is wrong. */
export function parseOffshorePlatformSnapshot(json) {
  if (
    JSON.stringify(json?.fields) !== JSON.stringify(PLATFORM_FIELDS) ||
    !Array.isArray(json.rows)
  )
    return null;
  return {
    records: json.rows
      .filter(Array.isArray)
      .map((row) =>
        Object.fromEntries(
          PLATFORM_FIELDS.map((field, index) => [field, row[index] ?? null]),
        ),
      )
      .filter(isRecord)
      .map((record) => {
        const { color, pixelSize } = structureStyle(record.type);
        return { ...record, color, pixelSize };
      }),
    stale: false,
  };
}
