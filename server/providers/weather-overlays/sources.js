import {
  OVERLAY_KEYS,
  maximumLevelFor,
} from '../../../src/layers/weather-overlays/modes.js';

export { OVERLAY_KEYS };
export const HOUR_MS = 60 * 60 * 1000;
/** Google tile time buckets are accepted from 3 h back to 1 h ahead. */
export const GOOGLE_WINDOW_MS = 3 * HOUR_MS;
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
