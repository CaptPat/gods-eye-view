import {
  OVERLAY_KEYS,
  maximumLevelFor,
} from '../../../src/layers/weather-overlays/modes.js';

export { OVERLAY_KEYS };
export const HOUR_MS = 60 * 60 * 1000;
export const GFS_STEP_MS = 3 * HOUR_MS;
/** Temperature tiles are served for valid times this close to now. */
export const GFS_WINDOW_MS = 6 * HOUR_MS;
/** Google tile time buckets are accepted from 3 h back to 1 h ahead. */
export const GOOGLE_WINDOW_MS = 3 * HOUR_MS;
/** PacIOOS ERDDAP hosts NCEP GFS; NOAA CoastWatch's copy 302-redirects here. */
export const GFS_GRIDDAP_URL =
  'https://pae-paha.pacioos.hawaii.edu/erddap/griddap/ncep_global.csvp';
const GFS_HEADER =
  'time (UTC),latitude (degrees_north),longitude (degrees_east),tmp2m (K)';
const GOOGLE_TILE_BASES = Object.freeze({
  'air-quality':
    'https://airquality.googleapis.com/v1/mapTypes/US_AQI/heatmapTiles',
  'pollen-tree':
    'https://pollen.googleapis.com/v1/mapTypes/TREE_UPI/heatmapTiles',
  'pollen-grass':
    'https://pollen.googleapis.com/v1/mapTypes/GRASS_UPI/heatmapTiles',
  'pollen-weed':
    'https://pollen.googleapis.com/v1/mapTypes/WEED_UPI/heatmapTiles',
});

export const isOverlayKey = (value) => OVERLAY_KEYS.includes(value);
export const isGoogleKey = (key) => Object.hasOwn(GOOGLE_TILE_BASES, key);

const isoSeconds = (timeMs) =>
  new Date(timeMs).toISOString().replace('.000Z', 'Z');

function strictNonNegativeInt(value) {
  return /^\d+$/.test(String(value)) ? Number(value) : null;
}

/** Integer z/x/y within the overlay's zoom cap and the tile grid. */
export function parseTileCoords(key, z, x, y) {
  const maxZoom = maximumLevelFor(key);
  const [zi, xi, yi] = [z, x, y].map(strictNonNegativeInt);
  if (maxZoom === null || zi === null || xi === null || yi === null)
    return null;
  if (zi > maxZoom) return null;
  const size = 2 ** zi;
  if (xi >= size || yi >= size) return null;
  return { z: zi, x: xi, y: yi };
}

export function googleTileUrl(key, { z, x, y }, apiKey) {
  return `${GOOGLE_TILE_BASES[key]}/${z}/${x}/${y}?key=${encodeURIComponent(apiKey)}`;
}

/** GFS "best" series steps every 3 h; take the step nearest now. */
export function gfsValidTime(nowMs) {
  return Math.round(nowMs / GFS_STEP_MS) * GFS_STEP_MS;
}

export function isGfsTime(timeMs, nowMs) {
  return (
    Number.isInteger(timeMs) &&
    timeMs % GFS_STEP_MS === 0 &&
    Math.abs(timeMs - nowMs) <= GFS_WINDOW_MS
  );
}

/** One global 2 m temperature grid at 1° (stride 2 over the 0.5° dataset). */
export function gfsGridUrl(timeMs) {
  const time = isoSeconds(timeMs);
  return `${GFS_GRIDDAP_URL}?tmp2m%5B(${time})%5D%5B(-90):2:(90)%5D%5B(0):2:(359.5)%5D`;
}

export function googleTimeBucket(nowMs) {
  return Math.floor(nowMs / HOUR_MS) * HOUR_MS;
}

export function isGoogleTime(timeMs, nowMs) {
  return (
    Number.isInteger(timeMs) &&
    timeMs % HOUR_MS === 0 &&
    timeMs <= nowMs + HOUR_MS &&
    timeMs >= nowMs - GOOGLE_WINDOW_MS
  );
}

/**
 * Parse an ERDDAP `.csvp` tmp2m response into a regular grid. Rows may come in
 * any order; the grid is indexed south-to-north and from `lon0` eastward.
 */
export function parseGfsCsv(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  if (lines[0]?.trim() !== GFS_HEADER) return null;
  const rows = [];
  const latitudes = new Set();
  const longitudes = new Set();
  let time = null;
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const [timeText, latText, lonText, valueText] = line.split(',');
    const lat = Number(latText);
    const lon = Number(lonText);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    time ??= Date.parse(timeText);
    rows.push([lat, lon, Number(valueText)]);
    latitudes.add(lat);
    longitudes.add(lon);
  }
  const lats = [...latitudes].sort((a, b) => a - b);
  const lons = [...longitudes].sort((a, b) => a - b);
  if (lats.length < 2 || lons.length < 2) return null;
  if (rows.length !== lats.length * lons.length) return null;
  const latStep = lats[1] - lats[0];
  const lonStep = lons[1] - lons[0];
  const regular = (values, step) =>
    values.every(
      (value, index) => Math.abs(value - (values[0] + index * step)) < 1e-6,
    );
  if (!regular(lats, latStep) || !regular(lons, lonStep)) return null;
  const kelvin = new Float32Array(rows.length).fill(Number.NaN);
  for (const [lat, lon, value] of rows) {
    const row = Math.round((lat - lats[0]) / latStep);
    const column = Math.round((lon - lons[0]) / lonStep);
    kelvin[row * lons.length + column] = value;
  }
  return {
    time: Number.isFinite(time) ? time : null,
    lat0: lats[0],
    latStep,
    latCount: lats.length,
    lon0: lons[0],
    lonStep,
    lonCount: lons.length,
    kelvin,
  };
}
