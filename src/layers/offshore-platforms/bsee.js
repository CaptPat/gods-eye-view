/**
 * BSEE Data Center platform files (fixed-width) and company list (quoted
 * delimited), joined into one record per standing offshore structure.
 * Layouts are 1-based `[field, start, length]` columns from the BSEE field
 * definition pages; only the fields the layer uses are read.
 */

export const PLATFORM_LOCATION_LAYOUT = Object.freeze([
  ['districtCode', 1, 3],
  ['complexId', 4, 8],
  ['structureNumber', 12, 3],
  ['areaCode', 15, 2],
  ['blockNumber', 17, 6],
  ['structureName', 23, 15],
  ['longitude', 86, 14],
  ['latitude', 100, 13],
]);

export const PLATFORM_STRUCTURE_LAYOUT = Object.freeze([
  ['areaCode', 1, 2],
  ['blockNumber', 3, 6],
  ['complexId', 9, 8],
  ['installDate', 20, 11],
  ['removalDate', 44, 11],
  ['structureName', 67, 15],
  ['structureNumber', 82, 3],
  ['structureType', 85, 5],
]);

export const PLATFORM_MASTER_LAYOUT = Object.freeze([
  ['complexId', 1, 8],
  ['condnProdFlag', 12, 1],
  ['distanceToShore', 13, 4],
  ['gasProdFlag', 19, 1],
  ['companyNumber', 21, 5],
  ['manned24HrFlag', 26, 1],
  ['heliportFlag', 48, 1],
  ['waterDepth', 51, 5],
  ['oilProdFlag', 68, 1],
  ['areaCode', 88, 2],
  ['blockNumber', 90, 6],
]);

const MONTHS = Object.freeze({
  JAN: '01',
  FEB: '02',
  MAR: '03',
  APR: '04',
  MAY: '05',
  JUN: '06',
  JUL: '07',
  AUG: '08',
  SEP: '09',
  OCT: '10',
  NOV: '11',
  DEC: '12',
});

const round5 = (value) => Math.round(value * 1e5) / 1e5 + 0;

/** `01-JAN-1988` → `1988-01-01`, or null. */
export function parseBseeDate(value) {
  const match = /^(\d{2})-([A-Z]{3})-(\d{4})$/.exec(String(value ?? '').trim());
  if (!match || !MONTHS[match[2]]) return null;
  return `${match[3]}-${MONTHS[match[2]]}-${match[1]}`;
}

/** One trimmed-field object per non-blank line. */
export function parseFixedWidth(text, layout) {
  const records = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const record = {};
    for (const [field, start, length] of layout)
      record[field] = line.slice(start - 1, start - 1 + length).trim();
    records.push(record);
  }
  return records;
}

/** Fields of one comma-separated line with double-quoted values. */
export function splitQuoted(line) {
  const fields = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      fields.push(field);
      field = '';
    } else field += char;
  }
  fields.push(field);
  return fields;
}

/**
 * Company number → current name. The list keeps every historical name with
 * start and end dates; a row without an end date is current, otherwise the
 * latest start wins.
 */
export function parseCompanies(text) {
  const best = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [number, start = '', name = '', , end = ''] = splitQuoted(line);
    if (!number || !name) continue;
    const rank = `${end ? '0' : '1'}${start}`;
    const previous = best.get(number);
    if (!previous || rank > previous.rank) best.set(number, { rank, name });
  }
  return new Map([...best].map(([number, { name }]) => [number, name]));
}

const keyOf = (record) =>
  `${Number(record.complexId)}-${Number(record.structureNumber)}`;

const wholeNumber = (value) => {
  const text = String(value ?? '').trim();
  return /^\d+$/.test(text) ? Number(text) : null;
};

/** Standing structures (no removal date) that have a location, with their complex's details. */
export function joinPlatforms({
  locations,
  structures,
  masters,
  companies = new Map(),
}) {
  const structureByKey = new Map(
    structures.map((structure) => [keyOf(structure), structure]),
  );
  const masterById = new Map(
    masters.map((master) => [String(Number(master.complexId)), master]),
  );
  const records = [];
  const seen = new Set();
  for (const location of locations) {
    const lat = Number(location.latitude);
    const lon = Number(location.longitude);
    if (
      !location.latitude ||
      !location.longitude ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      (lat === 0 && lon === 0)
    )
      continue;
    const id = keyOf(location);
    if (seen.has(id)) continue;
    const structure = structureByKey.get(id);
    if (!structure || structure.removalDate) continue;
    seen.add(id);
    const master = masterById.get(String(Number(location.complexId)));
    records.push({
      id,
      name: location.structureName || structure.structureName || null,
      lat: round5(lat),
      lon: round5(lon),
      area: location.areaCode || structure.areaCode || null,
      block: location.blockNumber || structure.blockNumber || null,
      type: structure.structureType || null,
      installed: parseBseeDate(structure.installDate),
      waterDepthFt: wholeNumber(master?.waterDepth),
      distanceToShoreNm: wholeNumber(master?.distanceToShore),
      operator: companies.get(master?.companyNumber) ?? null,
      products: [
        ['oil', master?.oilProdFlag],
        ['gas', master?.gasProdFlag],
        ['condensate', master?.condnProdFlag],
      ]
        .filter(([, flag]) => flag === 'Y')
        .map(([product]) => product),
      manned: master?.manned24HrFlag === 'Y',
      heliport: master?.heliportFlag === 'Y',
    });
  }
  return records;
}
