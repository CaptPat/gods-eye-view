// server/providers/weather-radar.js
import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { clientKey, makeRateLimiter } from './common/rate-limit.js';
import { coalesceProxyRequest } from './common/http.js';
import {
  RAINVIEWER_MANIFEST_URL,
  iemCacheKey,
  iemFrameTimes,
  iemImageUrl,
  normalizeRainViewerManifest,
  parseIemQuery,
  parseTileCoords,
  rainViewerTileUrl,
} from './weather-radar/sources.js';

export const RADAR_CACHE_DIR = path.join(process.cwd(), '.gev-cache', 'radar');
export const MANIFEST_TTL_MS = 120_000;
export const UPSTREAM_TIMEOUT_MS = 15_000;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const IEM_RECENT_MS = 15 * 60_000;
export const IEM_RECENT_TTL_MS = 5 * 60_000;
export const IEM_TTL_MS = 24 * 60 * 60_000;
export const RAINVIEWER_CACHE_GRACE_MS = 60 * 60_000;
const USER_AGENT =
  'CyclopsView/0.1 (+https://github.com/CaptPat/gods-eye-view)';

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function sendPng(res, bytes, cacheStatus) {
  res.writeHead(200, {
    'Content-Type': 'image/png',
    'Cache-Control': 'private, max-age=600',
    'X-Radar-Cache': cacheStatus,
  });
  res.end(bytes);
}

async function readPngCapped(response) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES)
    throw new Error('radar image too large');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('radar image too large');
  if (bytes.subarray(0, 4).toString('hex') !== '89504e47')
    throw new Error('radar image is not a PNG');
  return bytes;
}

async function readCached(file, maxAgeMs, nowMs) {
  try {
    const info = await stat(file);
    if (nowMs - info.mtimeMs > maxAgeMs) return null;
    return await readFile(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeCached(file, bytes) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
}

export function createWeatherRadarHandler({
  fetchImpl = (...args) => fetch(...args),
  cacheDir = RADAR_CACHE_DIR,
  now = Date.now,
  limiter = makeRateLimiter({ windowMs: 60_000, max: 1200, globalMax: 4000 }),
  log = (message) => console.warn(message),
} = {}) {
  const inFlight = new Map();
  let manifest = null;
  let manifestCheckedAt = 0;
  let manifestStale = false;

  async function fetchUpstream(url) {
    const response = await fetchImpl(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`upstream HTTP ${response.status}`);
    return response;
  }

  async function pruneRainViewerCache(frames) {
    const oldest = frames[0]?.time;
    if (!Number.isFinite(oldest)) return;
    let names = [];
    try {
      names = await readdir(path.join(cacheDir, 'rainviewer'));
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    await Promise.all(
      names
        .filter(
          (name) =>
            /^\d+$/.test(name) &&
            Number(name) < oldest - RAINVIEWER_CACHE_GRACE_MS,
        )
        .map((name) =>
          rm(path.join(cacheDir, 'rainviewer', name), {
            recursive: true,
            force: true,
          }),
        ),
    );
  }

  async function currentManifest() {
    if (manifest && now() - manifestCheckedAt < MANIFEST_TTL_MS)
      return manifest;
    try {
      const { promise } = coalesceProxyRequest(
        inFlight,
        'rainviewer-manifest',
        async () =>
          normalizeRainViewerManifest(
            await (await fetchUpstream(RAINVIEWER_MANIFEST_URL)).json(),
          ),
      );
      const fresh = await promise;
      if (!fresh) throw new Error('malformed RainViewer manifest');
      manifest = fresh;
      manifestStale = false;
      manifestCheckedAt = now();
      await pruneRainViewerCache(fresh.frames);
    } catch (error) {
      if (!manifest) throw error;
      manifestStale = true;
      manifestCheckedAt = now();
      log(`[radar] manifest refresh failed: ${error.message}`);
    }
    return manifest;
  }

  async function sendImage(res, file, maxAgeMs, target) {
    const cached = await readCached(file, maxAgeMs, now());
    if (cached) return sendPng(res, cached, 'HIT');
    const { promise } = coalesceProxyRequest(inFlight, target, async () =>
      readPngCapped(await fetchUpstream(target)),
    );
    const bytes = await promise;
    await writeCached(file, bytes);
    return sendPng(res, bytes, 'MISS');
  }

  async function frames(url, res) {
    if (url.searchParams.get('source') === 'iem') {
      return sendJson(res, 200, {
        source: 'iem',
        frames: iemFrameTimes(now()).map((time) => ({ time })),
        generatedAt: now(),
        stale: false,
      });
    }
    const current = await currentManifest();
    return sendJson(res, 200, {
      source: 'rainviewer',
      frames: current.frames.map(({ time }) => ({ time })),
      generatedAt: now(),
      stale: manifestStale,
    });
  }

  async function rainViewerTile(parts, res) {
    const [, timeText, z, x, yFile] = parts;
    const coords = yFile.endsWith('.png')
      ? parseTileCoords(z, x, yFile.slice(0, -4))
      : null;
    if (!coords)
      return sendJson(res, 400, { error: 'invalid tile coordinates' });
    const current = await currentManifest();
    const frame = current.frames.find(
      (candidate) => String(candidate.time) === timeText,
    );
    if (!frame) return sendJson(res, 404, { error: 'unknown radar frame' });
    const file = path.join(
      cacheDir,
      'rainviewer',
      timeText,
      String(coords.z),
      String(coords.x),
      `${coords.y}.png`,
    );
    return sendImage(
      res,
      file,
      Number.POSITIVE_INFINITY,
      rainViewerTileUrl(current.host, frame.path, coords),
    );
  }

  async function iemImage(url, res) {
    const query = parseIemQuery(url.searchParams, now());
    if (query.error) return sendJson(res, 400, { error: query.error });
    const ageMs = now() - Date.parse(query.time);
    const maxAgeMs = ageMs < IEM_RECENT_MS ? IEM_RECENT_TTL_MS : IEM_TTL_MS;
    return sendImage(
      res,
      path.join(cacheDir, 'iem', `${iemCacheKey(query)}.png`),
      maxAgeMs,
      iemImageUrl(query),
    );
  }

  return async function handle(req, res) {
    try {
      if (req.method !== 'GET')
        return sendJson(res, 405, { error: 'method not allowed' });
      if (!limiter(clientKey(req)))
        return sendJson(
          res,
          429,
          { error: 'rate limited' },
          { 'Retry-After': '10' },
        );
      const url = new URL(req.url || '/', 'http://radar.local');
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length === 1 && parts[0] === 'frames')
        return await frames(url, res);
      if (parts.length === 5 && parts[0] === 'rainviewer')
        return await rainViewerTile(parts, res);
      if (parts.length === 1 && parts[0] === 'iem')
        return await iemImage(url, res);
      return sendJson(res, 404, { error: 'not found' });
    } catch (error) {
      log(`[radar] ${error?.message ?? error}`);
      return sendJson(res, 502, { error: 'upstream unavailable' });
    }
  };
}

export function weatherRadarProxy(options = {}) {
  const handler = createWeatherRadarHandler(options);
  const install = (server) => {
    server.middlewares.use('/api/radar', handler);
  };
  return {
    name: 'weather-radar-proxy',
    configureServer: install,
    configurePreviewServer: install,
  };
}
