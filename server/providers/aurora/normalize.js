import { buildBands } from '../../../src/layers/grid-bands/bands.js';

export const OVATION_URL =
  'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json';
/** Probability thresholds (percent); a cell's band is the highest it reaches. */
export const AURORA_LEVELS = Object.freeze([5, 10, 30, 50]);

const COLS = 360;
const ROWS = 181;

function levelFor(probability) {
  let level = null;
  AURORA_LEVELS.forEach((threshold, index) => {
    if (probability >= threshold) level = index;
  });
  return level;
}

function isoTime(text) {
  if (typeof text !== 'string') return null;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * OVATION `[lon 0–359, lat −90…90, probability %]` triplets →
 * `{ observationTime, forecastTime, maxProbability, bands }`. Missing cells
 * count as zero; out-of-range triplets are skipped. Null when nothing is valid.
 */
export function normalizeOvation(json) {
  if (!Array.isArray(json?.coordinates)) return null;
  const grid = new Uint8Array(COLS * ROWS);
  let valid = 0;
  let maxProbability = 0;
  for (const point of json.coordinates) {
    if (!Array.isArray(point)) continue;
    const [lon, lat, probability] = point;
    if (
      !Number.isInteger(lon) ||
      lon < 0 ||
      lon >= COLS ||
      !Number.isInteger(lat) ||
      lat < -90 ||
      lat > 90 ||
      typeof probability !== 'number' ||
      !Number.isFinite(probability) ||
      probability < 0 ||
      probability > 100
    )
      continue;
    const value = Math.round(probability);
    grid[(lat + 90) * COLS + lon] = value;
    valid += 1;
    if (value > maxProbability) maxProbability = value;
  }
  if (!valid) return null;
  return {
    observationTime: isoTime(json['Observation Time']),
    forecastTime: isoTime(json['Forecast Time']),
    maxProbability,
    bands: buildBands({
      cols: COLS,
      rows: ROWS,
      west: -0.5,
      south: -90.5,
      cellDeg: 1,
      levelAt: (row, col) => levelFor(grid[row * COLS + col]),
    }),
  };
}
