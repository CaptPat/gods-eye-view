/**
 * Build-time normalizers for the US Pipelines snapshot: EIA natural gas, crude
 * oil and hydrocarbon gas liquids pipelines (ArcGIS GeoJSON), and BSEE
 * offshore segments (BOEM map geometry joined to the Pipeline Masters file).
 * Positions are flat `[lon, lat, …]` lists rounded to 0.001°.
 */
import { splitQuoted } from '../offshore-platforms/bsee.js';
import { ocsProduct } from './model.js';

/** Offshore segments in service or temporarily out of service. */
export const OCS_KEPT_STATUSES = Object.freeze(['ACT', 'OUT']);

const EMPTY = Object.freeze({
  name: null,
  operator: null,
  route: null,
  product: null,
  sizeIn: null,
  status: null,
});

const round3 = (value) => Math.round(value * 1000) / 1000 + 0;
const text = (value) =>
  typeof value === 'string' && value.trim() ? value.trim() : null;
const featuresOf = (geojson) =>
  Array.isArray(geojson?.features) ? geojson.features : [];

function lineParts(geometry) {
  if (geometry?.type === 'LineString') return [geometry.coordinates];
  if (geometry?.type === 'MultiLineString') return geometry.coordinates;
  return [];
}

/** Rounded positions without repeated vertices, or null when fewer than two remain. */
function flatPositions(part) {
  const positions = [];
  for (const vertex of Array.isArray(part) ? part : []) {
    if (!Number.isFinite(vertex?.[0]) || !Number.isFinite(vertex?.[1]))
      continue;
    const lon = round3(vertex[0]);
    const lat = round3(vertex[1]);
    const count = positions.length;
    if (count && positions[count - 2] === lon && positions[count - 1] === lat)
      continue;
    positions.push(lon, lat);
  }
  return positions.length >= 4 ? positions : null;
}

function recordsFor(feature, idPrefix, fields) {
  const parts = lineParts(feature?.geometry).map(flatPositions).filter(Boolean);
  return parts.map((positions, index) => ({
    ...EMPTY,
    ...fields,
    id: parts.length > 1 ? `${idPrefix}-${index}` : idPrefix,
    positions,
  }));
}

/** EIA natural gas interstate and intrastate pipelines. */
export function normalizeEiaGas(geojson) {
  const records = [];
  for (const feature of featuresOf(geojson)) {
    const properties = feature?.properties ?? {};
    const kind =
      properties.TYPEPIPE === 'Interstate'
        ? 'gas-interstate'
        : properties.TYPEPIPE === 'Intrastate'
          ? 'gas-intrastate'
          : null;
    if (!kind || properties.FID === undefined) continue;
    records.push(
      ...recordsFor(feature, `gas/${properties.FID}`, {
        kind,
        operator: text(properties.Operator),
      }),
    );
  }
  return records;
}

/** EIA crude oil trunk or HGL pipelines (`kind` is 'crude' or 'hgl'). */
export function normalizeEiaLiquids(geojson, kind) {
  const records = [];
  for (const feature of featuresOf(geojson)) {
    const properties = feature?.properties ?? {};
    if (properties.FID === undefined) continue;
    records.push(
      ...recordsFor(feature, `${kind}/${properties.FID}`, {
        kind,
        name: text(properties.Pipename),
        operator: text(properties.Opername),
      }),
    );
  }
  return records;
}

const place = (name, area, block) =>
  [area, block, name].filter(Boolean).join(' ');

/**
 * BSEE Pipeline Masters (delimited) → segment number → master details.
 * Columns: 0 segment, 2–4 origin name/area/block, 6–8 destination, 23 status,
 * 24 size in inches, 29 product code, 32 facility operator number.
 */
export function parsePipelineMasters(fileText) {
  const masters = new Map();
  for (const line of String(fileText).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const columns = splitQuoted(line).map((column) => column.trim());
    const segment = Number(columns[0]);
    if (!Number.isInteger(segment) || segment <= 0) continue;
    const origin = place(columns[2], columns[3], columns[4]);
    const destination = place(columns[6], columns[7], columns[8]);
    const size = Number(columns[24]);
    masters.set(segment, {
      status: columns[23] || null,
      sizeIn: columns[24] && Number.isFinite(size) && size > 0 ? size : null,
      product: columns[29] || null,
      operatorNumber: columns[32] || null,
      route:
        origin && destination
          ? `${origin} → ${destination}`
          : origin || destination || null,
    });
  }
  return masters;
}

/** Fields that must match for two segments to join into one line. */
const CHAIN_FIELDS = Object.freeze([
  'kind',
  'name',
  'operator',
  'route',
  'product',
  'sizeIn',
  'status',
]);

const vertexKey = (positions, index) =>
  `${positions[index]},${positions[index + 1]}`;

function reversed(positions) {
  const out = [];
  for (let index = positions.length - 2; index >= 0; index -= 2)
    out.push(positions[index], positions[index + 1]);
  return out;
}

/**
 * Join segments with identical attributes end to end. A chain continues only
 * through a vertex exactly two of the group's segments share, so junctions
 * stay visible. Each chain keeps its first segment's id; chains come back in
 * the order of their first segment.
 */
export function mergeLineChains(records) {
  const groups = new Map();
  records.forEach((record, order) => {
    const key = JSON.stringify(
      CHAIN_FIELDS.map((field) => record[field] ?? null),
    );
    const members = groups.get(key);
    if (members) members.push({ record, order });
    else groups.set(key, [{ record, order }]);
  });
  const chains = [];
  for (const members of groups.values()) {
    const ends = new Map();
    const note = (key, index) => {
      const touching = ends.get(key);
      if (touching) touching.push(index);
      else ends.set(key, [index]);
    };
    members.forEach(({ record }, index) => {
      note(vertexKey(record.positions, 0), index);
      note(vertexKey(record.positions, record.positions.length - 2), index);
    });
    const used = new Array(members.length).fill(false);
    for (let start = 0; start < members.length; start += 1) {
      if (used[start]) continue;
      used[start] = true;
      let positions = members[start].record.positions;
      for (const atEnd of [true, false]) {
        for (;;) {
          const key = atEnd
            ? vertexKey(positions, positions.length - 2)
            : vertexKey(positions, 0);
          const touching = ends.get(key);
          if (touching?.length !== 2) break;
          const next = touching.find((index) => !used[index]);
          if (next === undefined) break;
          used[next] = true;
          let piece = members[next].record.positions;
          const startsHere = vertexKey(piece, 0) === key;
          if (atEnd) {
            if (!startsHere) piece = reversed(piece);
            positions = positions.concat(piece.slice(2));
          } else {
            if (startsHere) piece = reversed(piece);
            positions = piece.slice(0, -2).concat(positions);
          }
        }
      }
      chains.push({
        order: members[start].order,
        record: { ...members[start].record, positions },
      });
    }
  }
  return chains.sort((a, b) => a.order - b.order).map(({ record }) => record);
}

/** BOEM offshore segment geometry joined to masters: in-service oil and gas lines only. */
export function normalizeOcsPipelines(geojson, masters, companies = new Map()) {
  const records = [];
  for (const feature of featuresOf(geojson)) {
    const segment = Number(feature?.properties?.SEGMENT_NUM);
    const master = masters.get(segment);
    if (!master || !OCS_KEPT_STATUSES.includes(master.status)) continue;
    const product = ocsProduct(master.product);
    if (!product) continue;
    records.push(
      ...recordsFor(feature, `ocs/${segment}`, {
        kind: `ocs-${product.kind}`,
        operator: companies.get(master.operatorNumber) ?? null,
        route: master.route,
        product: master.product,
        sizeIn: master.sizeIn,
        status: master.status,
      }),
    );
  }
  return records;
}
