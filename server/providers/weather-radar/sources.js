import { createHash } from 'node:crypto';

export const RAINVIEWER_MANIFEST_URL =
  'https://api.rainviewer.com/public/weather-maps.json';
export const IEM_WMS_URL =
  'https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0q-t.cgi';
export const FRAME_STEP_MS = 10 * 60 * 1000;
export const FRAME_COUNT = 13;
export const IEM_LATENCY_MS = 5 * 60 * 1000;
export const IEM_MAX_AGE_MS = 6 * 60 * 60 * 1000;
/** Contiguous US widened to Cesium level-3 geographic tile edges (22.5° grid). */
const IEM_BOUNDS = { west: -135, south: 0, east: -45, north: 67.5 };
const IEM_MAX_SPAN = { lon: 70, lat: 35 };
const RAINVIEWER_PATH = /^\/v2\/radar\/[A-Za-z0-9_-]+$/;
const FIVE_MINUTES_MS = 5 * 60 * 1000;

/** Keep only well-formed frames; upstream host and paths never leave the server. */
export function normalizeRainViewerManifest(json) {
  const host = typeof json?.host === 'string' ? json.host : '';
  if (
    !/^https:\/\/[a-z0-9.-]+$/i.test(host) ||
    !Array.isArray(json?.radar?.past)
  )
    return null;
  const frames = json.radar.past
    .map((entry) => ({
      time: Number(entry?.time) * 1000,
      path: String(entry?.path ?? ''),
    }))
    .filter(
      (frame) =>
        Number.isFinite(frame.time) &&
        frame.time > 0 &&
        RAINVIEWER_PATH.test(frame.path),
    )
    .sort((a, b) => a.time - b.time);
  return { host, frames };
}

/** Thirteen 10-minute boundaries; the newest is at least IEM_LATENCY_MS old. */
export function iemFrameTimes(nowMs) {
  const newest =
    Math.floor((nowMs - IEM_LATENCY_MS) / FRAME_STEP_MS) * FRAME_STEP_MS;
  return Array.from(
    { length: FRAME_COUNT },
    (_, i) => newest - (FRAME_COUNT - 1 - i) * FRAME_STEP_MS,
  );
}

function strictInt(value) {
  return /^-?\d+$/.test(String(value)) ? Number(value) : null;
}

export function parseTileCoords(z, x, y) {
  const [zi, xi, yi] = [strictInt(z), strictInt(x), strictInt(y)];
  if (zi === null || xi === null || yi === null || zi < 0 || zi > 7)
    return null;
  const size = 2 ** zi;
  if (xi < 0 || xi >= size || yi < 0 || yi >= size) return null;
  return { z: zi, x: xi, y: yi };
}

export function rainViewerTileUrl(host, path, { z, x, y }) {
  return `${host}${path}/256/${z}/${x}/${y}/2/1_1.png`;
}

export function parseIemQuery(searchParams, nowMs) {
  const timeText = String(searchParams.get('time') ?? '');
  const timeMs = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/.test(timeText)
    ? Date.parse(timeText)
    : Number.NaN;
  if (
    !Number.isFinite(timeMs) ||
    timeMs % FIVE_MINUTES_MS !== 0 ||
    timeMs > nowMs ||
    timeMs < nowMs - IEM_MAX_AGE_MS
  ) {
    return {
      error: 'time must be a 5-minute UTC boundary within the last 6 hours',
    };
  }
  const parts = String(searchParams.get('bbox') ?? '')
    .split(',')
    .map(Number);
  const [w, s, e, n] = parts;
  const bboxOk =
    parts.length === 4 &&
    parts.every(Number.isFinite) &&
    w < e &&
    s < n &&
    w >= IEM_BOUNDS.west &&
    e <= IEM_BOUNDS.east &&
    s >= IEM_BOUNDS.south &&
    n <= IEM_BOUNDS.north &&
    e - w <= IEM_MAX_SPAN.lon &&
    n - s <= IEM_MAX_SPAN.lat;
  if (!bboxOk)
    return {
      error: 'bbox must be west,south,east,north within the contiguous US',
    };
  const width = strictInt(searchParams.get('width'));
  const height = strictInt(searchParams.get('height'));
  if (
    width === null ||
    height === null ||
    width < 1 ||
    width > 512 ||
    height < 1 ||
    height > 512
  ) {
    return { error: 'size must be integers from 1 to 512' };
  }
  return { time: timeText, bbox: [w, s, e, n], width, height };
}

export function iemImageUrl({ time, bbox, width, height }) {
  const params = new URLSearchParams({
    service: 'WMS',
    version: '1.1.1',
    request: 'GetMap',
    layers: 'nexrad-n0q-wmst',
    srs: 'EPSG:4326',
    bbox: bbox.join(','),
    width: String(width),
    height: String(height),
    format: 'image/png',
    transparent: 'true',
    time,
  });
  return `${IEM_WMS_URL}?${params}`;
}

export function iemCacheKey({ time, bbox, width, height }) {
  return createHash('sha1')
    .update(`${time}|${bbox.join(',')}|${width}x${height}`)
    .digest('hex');
}
