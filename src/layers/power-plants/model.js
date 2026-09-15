/** Pure Power Plants model: layer meta, fuel palette, sizing, card text and snapshot parsing. */
import { POWER_PLANT_FIELDS } from './source.js';

export const POWER_PLANTS_META = Object.freeze({
  id: 'power-plants',
  name: 'Power Plants',
  icon: '⚡',
  source: 'WRI GPPD',
  color: '#ffb703',
  selectedSourceId: 'power-plants-selected',
  loadingLabel: 'Loading power plants',
  unavailableText: 'Power plant data unavailable',
  refreshFailedText: 'Power plant refresh failed',
});

export const FUEL_COLORS = Object.freeze({
  Coal: '#6c757d',
  Gas: '#ff9f1c',
  Oil: '#9d4edd',
  Nuclear: '#ffd60a',
  Wind: '#4cc9f0',
  Solar: '#ffe066',
  Biomass: '#80b918',
  Waste: '#a0522d',
  Geothermal: '#e76f51',
  Storage: '#00b4d8',
  Cogeneration: '#f4a261',
  Petcoke: '#495057',
  'Wave and Tidal': '#0077b6',
  Other: '#adb5bd',
});

const TITLE_CHARS = 34;
const clip = (text, limit) =>
  text.length > limit ? `${text.slice(0, limit - 1)}…` : text;

/** 3 px at 1 MW or less, 1.5 px more per tenfold capacity, capped at 10. */
export function powerPlantPixelSize(capacityMw) {
  if (!Number.isFinite(capacityMw)) return 3;
  const size =
    Math.round((3 + 1.5 * Math.log10(Math.max(capacityMw, 1))) * 100) / 100;
  return Math.min(10, Math.max(3, size));
}

const capacityText = (mw) =>
  mw >= 100
    ? Math.round(mw).toLocaleString('en-US')
    : String(Number(mw.toFixed(1)));

export function buildPowerPlantCard(record) {
  const details = [
    Number.isFinite(record.capacityMw)
      ? `${record.fuel} · ${capacityText(record.capacityMw)} MW`
      : record.fuel,
  ];
  if (record.owner) details.push(record.owner);
  const tail = [
    record.commissioned ? `Since ${record.commissioned}` : null,
    record.country,
  ]
    .filter(Boolean)
    .join(' · ');
  if (tail) details.push(tail);
  return {
    title: clip(record.name, TITLE_CHARS),
    details,
    url: null,
    accessibilityLabel: `${record.name} power plant`,
  };
}

const isRecord = (record) =>
  typeof record.id === 'string' &&
  record.id !== '' &&
  typeof record.name === 'string' &&
  Number.isFinite(record.lat) &&
  Number.isFinite(record.lon) &&
  Math.abs(record.lat) <= 90 &&
  Math.abs(record.lon) <= 180;

/** `{ fields, rows }` snapshot → styled `{ records, stale }`, or null when the shape is wrong. */
export function parsePowerPlantSnapshot(json) {
  if (
    JSON.stringify(json?.fields) !== JSON.stringify(POWER_PLANT_FIELDS) ||
    !Array.isArray(json.rows)
  )
    return null;
  return {
    records: json.rows
      .filter(Array.isArray)
      .map((row) =>
        Object.fromEntries(
          POWER_PLANT_FIELDS.map((field, index) => [field, row[index] ?? null]),
        ),
      )
      .filter(isRecord)
      .map((record) => ({
        ...record,
        color: FUEL_COLORS[record.fuel] ?? FUEL_COLORS.Other,
        pixelSize: powerPlantPixelSize(record.capacityMw),
      })),
    stale: false,
  };
}
