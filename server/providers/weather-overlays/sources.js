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
export const GMGSI_WMS_URL =
  'https://nowcoast.noaa.gov/geoserver/satellite/ows';
export const GMGSI_LAYER = 'global_longwave_imagery_mosaic';
/** PacIOOS ERDDAP hosts NCEP GFS; NOAA CoastWatch's copy 302-redirects here. */
export const GFS_GRIDDAP_URL =
  'https://pae-paha.pacioos.hawaii.edu/erddap/griddap/ncep_global.csvp';
const GFS_HEADER =
  'time (UTC),latitude (degrees_north),longitude (degrees_east),tmp2m (K)';
const WEB_MERCATOR_HALF = 20037508.342789244;
const MAX_CAPABILITY_TIMES = 48;
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

/** EPSG:3857 bounds of a Web Mercator tile, in metres. */
export function mercatorBounds({ z, x, y }) {
  const size = (2 * WEB_MERCATOR_HALF) / 2 ** z;
  const west = -WEB_MERCATOR_HALF + x * size;
  const north = WEB_MERCATOR_HALF - y * size;
  return { west, south: north - size, east: west + size, north };
}

export function googleTileUrl(key, { z, x, y }, apiKey) {
  return `${GOOGLE_TILE_BASES[key]}/${z}/${x}/${y}?key=${encodeURIComponent(apiKey)}`;
}

export function gmgsiCapabilitiesUrl() {
  return `${GMGSI_WMS_URL}?service=WMS&request=GetCapabilities&version=1.3.0`;
}

function expandTimeRange(start, end, period) {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  const hours = /^PT(\d+)H$/.exec(period);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || !hours) return [];
  const step = Number(hours[1]) * HOUR_MS;
  const times = [];
  for (
    let time = endMs;
    time >= startMs && times.length < MAX_CAPABILITY_TIMES;
    time -= step
  ) {
    times.push(time);
  }
  return times;
}

/** Hourly GMGSI longwave times from a WMS 1.3.0 capabilities document, oldest first. */
export function parseGmgsiTimes(xml) {
  const text = String(xml ?? '');
  const at = text.indexOf(`<Name>${GMGSI_LAYER}</Name>`);
  if (at < 0) return [];
  const end = text.indexOf('</Layer>', at);
  const layer = text.slice(at, end < 0 ? undefined : end);
  const match = /<Dimension[^>]*name="time"[^>]*>([^<]*)<\/Dimension>/.exec(
    layer,
  );
  if (!match) return [];
  const times = match[1].split(',').flatMap((entry) => {
    const parts = entry.trim().split('/');
    return parts.length === 3
      ? expandTimeRange(...parts)
      : [Date.parse(parts[0])];
  });
  return [...new Set(times)]
    .filter((time) => Number.isFinite(time) && time % HOUR_MS === 0)
    .sort((a, b) => a - b)
    .slice(-MAX_CAPABILITY_TIMES);
}

export function gmgsiTileUrl(timeMs, coords) {
  const { west, south, east, north } = mercatorBounds(coords);
  const params = new URLSearchParams({
    service: 'WMS',
    version: '1.3.0',
    request: 'GetMap',
    layers: GMGSI_LAYER,
    styles: '',
    crs: 'EPSG:3857',
    bbox: [west, south, east, north].join(','),
    width: '256',
    height: '256',
    format: 'image/png',
    transparent: 'true',
    time: isoSeconds(timeMs),
  });
  return `${GMGSI_WMS_URL}?${params}`;
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
