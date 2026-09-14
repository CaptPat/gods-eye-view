# Weather Radar Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Weather Radar" data layer in Cyclops View: RainViewer precipitation worldwide with a two-hour loop, and an optional Iowa State NEXRAD US-detail mode, served through a caching provider proxy.

**Architecture:**
- **Proxy:** a Vite provider plugin (`server/providers/weather-radar.js`, with pure helpers in `server/providers/weather-radar/sources.js`) serves frame lists and tiles with validation, rate limiting and a disk cache.
- **Layer:** a data layer (`src/layers/weather-radar/`) draws one Cesium `ImageryLayer` per retained frame above the base map. It is driven by the `DataLayerManager` lifecycle and uses the Layers-panel row controls.

**Tech Stack:** Node ≥ 24.14 / Vite provider plugins, CesiumJS 1.138 (`UrlTemplateImageryProvider`, `ImageryLayer`), `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-14-weather-radar-design.md`

## Global Constraints

- Fork-only work on `CaptPat/gods-eye-view`. Never open upstream PRs or issues. `gh pr create` defaults to the parent repository, so do not use it.
- RainViewer manifest: `https://api.rainviewer.com/public/weather-maps.json`. Tiles: `{host}{path}/256/{z}/{x}/{y}/2/1_1.png`, zoom 0–7 only.
- IEM frames use `https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0q-t.cgi` with `layers=nexrad-n0q-wmst`. Never use `n0q.cgi`, which ignores `time`.
- IEM `time` format is `YYYY-MM-DDTHH:MM:00Z` on 5-minute boundaries, at most 6 hours old. Bbox within `[-135, 0, -45, 67.5]` (the contiguous US widened to level-3 geographic tile edges), span ≤ 70° × 35°, width/height integers 1–512. The IEM imagery provider uses `rectangle` `[-130, 20, -60, 55]` and `minimumLevel: 3`, so every requested tile passes validation.
- Frames: 13 per source, 10 minutes apart. Retain 2 h. Loop 500 ms per frame with a 1500 ms hold on the newest. Refresh every 5 minutes, skipped while the tab is hidden.
- Opacity values are exactly 0.4, 0.7 (default) and 1. The loop state is never persisted.
- Layer id `weather-radar`, name `Weather Radar`, icon `🌧️`. Layer-state token `p`. Option tokens: `u` (usDetail), `o` (opacity).
- Legend, RainViewer "Universal Blue": Light `#00a3e0`, Moderate `#005588`, Heavy `#c10000`, Extreme `#ffffff`. US detail "NEXRAD Level III": Light `#00ff00`, Moderate `#087305`, Heavy `#ff0000`, Extreme `#fe00fe`.
- Credits (HTML exactly):
  - `Radar: <a href="https://www.rainviewer.com/" target="_blank" rel="noopener">RainViewer</a>`
  - `US radar: <a href="https://mesonet.agron.iastate.edu/" target="_blank" rel="noopener">Iowa Environmental Mesonet</a> NEXRAD`
- Status strings (exact):
  - `<name> · 04:50 UTC · 6 min old`
  - `<name> · Loading 9/13`
  - `Radar source unavailable — showing 04:30 UTC`
  - `Radar source unavailable`
  - `Hidden by Google 3D map source`

  `<name>` is `RainViewer` or `Iowa State NEXRAD`.
- Tests: colocated `*.test.mjs`, `node:test` + `node:assert/strict`, no live network. Use real `cesium` constructors with a hand-built fake viewer, as in `src/data/earthquakes.test.mjs`.
- CI parity before the final commit: `npm run format:check`, `npm run check:boundaries`, `npm test`, `npm run build`.
- Commit trailer: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
|---|---|
| `src/layers/weather-radar/frames.js` | Pure frame-list logic: parse, prune, select, loop stepping |
| `server/providers/weather-radar/sources.js` | Pure proxy helpers: manifest normalization, IEM frame times, validation, upstream URLs, cache keys |
| `server/providers/weather-radar.js` | Route handler (frames, RainViewer tiles, IEM images), cache, limiter, plugin |
| `server/providers/local.js` | Register and re-export the plugin |
| `src/data/layerState.js` | Registry entry `weather-radar` and its option group |
| `src/layers/weather-radar/controls.js` | Row chips and legend for the Layers panel |
| `src/layers/weather-radar/imagery.js` | Cesium imagery layers per frame, alpha, readiness |
| `src/layers/weather-radar/index.js` | Layer lifecycle, refresh, loop, params, stats, map-stack note |
| `src/data/weatherRadar.js` | Concrete dependencies and default layer instance |
| `src/data/dataCredits.js` | `RAINVIEWER_CREDIT`, `IEM_NEXRAD_CREDIT` |
| `src/standalone/data.js` | Register the layer |
| `package.json`, `scripts/package-boundaries.json`, `scripts/format-scope.json`, `DATA_SOURCES.md`, `CHANGELOG.md` | Package exports, boundaries, formatting scope, docs |

---

### Task 1: Frame logic

**Files:**
- Create: `src/layers/weather-radar/frames.js`
- Test: `src/layers/weather-radar/frames.test.mjs`

**Interfaces:**
- Produces:
  - `RETAIN_MS = 7_200_000`, `LOOP_FRAME_MS = 500`, `LOOP_HOLD_MS = 1500`
  - `parseFramesPayload(payload) → { source: 'rainviewer'|'iem', stale: boolean, frames: [{ time: number }] } | null`
  - `pruneFrames(frames, nowMs, retainMs = RETAIN_MS) → frames`
  - `newestFrame(frames) → frame | null`
  - `frameAtOrBefore(frames, timeMs) → frame | null`
  - `nextLoopStep(index, count) → { index: number, delayMs: number }`

- [ ] **Step 1: Write the failing test**

```js
// src/layers/weather-radar/frames.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LOOP_FRAME_MS, LOOP_HOLD_MS, RETAIN_MS,
  frameAtOrBefore, newestFrame, nextLoopStep, parseFramesPayload, pruneFrames,
} from './frames.js';

const T = Date.UTC(2026, 8, 14, 4, 50);
const MIN = 60_000;

test('a frames payload is validated, de-duplicated and sorted oldest first', () => {
  assert.deepEqual(
    parseFramesPayload({ source: 'iem', stale: true, frames: [{ time: T }, { time: T - 10 * MIN }, { time: T }, { time: 'x' }, null] }),
    { source: 'iem', stale: true, frames: [{ time: T - 10 * MIN }, { time: T }] },
  );
  assert.deepEqual(parseFramesPayload({ frames: [] }), { source: 'rainviewer', stale: false, frames: [] });
  assert.equal(parseFramesPayload(null), null);
  assert.equal(parseFramesPayload({ frames: 'nope' }), null);
});

test('frames older than the retention window are pruned', () => {
  const frames = [{ time: T - RETAIN_MS - 1 }, { time: T - RETAIN_MS }, { time: T }];
  assert.deepEqual(pruneFrames(frames, T), [{ time: T - RETAIN_MS }, { time: T }]);
});

test('newest and at-or-before selection', () => {
  const frames = [{ time: T - 20 * MIN }, { time: T - 10 * MIN }, { time: T }];
  assert.deepEqual(newestFrame(frames), { time: T });
  assert.equal(newestFrame([]), null);
  assert.equal(frameAtOrBefore(frames, T - 21 * MIN), null);
  assert.deepEqual(frameAtOrBefore(frames, T - 10 * MIN), { time: T - 10 * MIN });
  assert.deepEqual(frameAtOrBefore(frames, T - 5 * MIN), { time: T - 10 * MIN });
  assert.deepEqual(frameAtOrBefore(frames, T + MIN), { time: T });
});

test('the loop steps 500 ms per frame and holds 1500 ms on the newest, then wraps', () => {
  const steps = [];
  let index = -1;
  for (let i = 0; i < 4; i += 1) {
    const step = nextLoopStep(index, 3);
    steps.push(step);
    index = step.index;
  }
  assert.deepEqual(steps, [
    { index: 0, delayMs: LOOP_FRAME_MS },
    { index: 1, delayMs: LOOP_FRAME_MS },
    { index: 2, delayMs: LOOP_HOLD_MS },
    { index: 0, delayMs: LOOP_FRAME_MS },
  ]);
  assert.deepEqual(nextLoopStep(0, 0), { index: -1, delayMs: LOOP_HOLD_MS });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/layers/weather-radar/frames.test.mjs`
Expected: FAIL with `Cannot find module` for `./frames.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/layers/weather-radar/frames.js
export const RETAIN_MS = 2 * 60 * 60 * 1000;
export const LOOP_FRAME_MS = 500;
export const LOOP_HOLD_MS = 1500;

/** Validate a `/api/radar/frames` payload into sorted, unique frames. */
export function parseFramesPayload(payload) {
  if (!payload || !Array.isArray(payload.frames)) return null;
  const times = payload.frames
    .map((frame) => Number(frame?.time))
    .filter((time) => Number.isFinite(time) && time > 0);
  return {
    source: payload.source === 'iem' ? 'iem' : 'rainviewer',
    stale: payload.stale === true,
    frames: [...new Set(times)].sort((a, b) => a - b).map((time) => ({ time })),
  };
}

export function pruneFrames(frames, nowMs, retainMs = RETAIN_MS) {
  return frames.filter((frame) => frame.time >= nowMs - retainMs);
}

export function newestFrame(frames) {
  return frames.length ? frames[frames.length - 1] : null;
}

/** The latest frame whose time is at or before `timeMs`; frames are sorted oldest first. */
export function frameAtOrBefore(frames, timeMs) {
  let hit = null;
  for (const frame of frames) {
    if (frame.time > timeMs) break;
    hit = frame;
  }
  return hit;
}

/** Next loop position and how long to show it: the newest frame holds longer. */
export function nextLoopStep(index, count) {
  if (count <= 0) return { index: -1, delayMs: LOOP_HOLD_MS };
  const next = index + 1 >= count ? 0 : index + 1;
  return { index: next, delayMs: next === count - 1 ? LOOP_HOLD_MS : LOOP_FRAME_MS };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/layers/weather-radar/frames.test.mjs`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/layers/weather-radar/frames.js src/layers/weather-radar/frames.test.mjs
git commit -m "feat(weather-radar): frame list logic"
```

---

### Task 2: Proxy source helpers

**Files:**
- Create: `server/providers/weather-radar/sources.js`
- Test: `src/data/weatherRadarSources.test.mjs`

**Interfaces:**
- Produces:
  - `RAINVIEWER_MANIFEST_URL`, `IEM_WMS_URL`
  - `FRAME_STEP_MS = 600_000`, `FRAME_COUNT = 13`, `IEM_LATENCY_MS = 300_000`, `IEM_MAX_AGE_MS = 21_600_000`
  - `normalizeRainViewerManifest(json) → { host: string, frames: [{ time: number, path: string }] } | null`
  - `iemFrameTimes(nowMs) → number[]` (13, oldest first)
  - `parseTileCoords(z, x, y) → { z, x, y } | null`
  - `rainViewerTileUrl(host, path, { z, x, y }) → string`
  - `parseIemQuery(searchParams, nowMs) → { time: string, bbox: [w, s, e, n], width, height } | { error: string }`
  - `iemImageUrl(query) → string`
  - `iemCacheKey(query) → string` (40-hex sha1)

- [ ] **Step 1: Write the failing test**

```js
// src/data/weatherRadarSources.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FRAME_COUNT, FRAME_STEP_MS, IEM_WMS_URL,
  iemCacheKey, iemFrameTimes, iemImageUrl, normalizeRainViewerManifest,
  parseIemQuery, parseTileCoords, rainViewerTileUrl,
} from '../../server/providers/weather-radar/sources.js';

const NOW = Date.UTC(2026, 8, 14, 4, 57, 30);

test('a RainViewer manifest becomes sorted frames with server-side paths', () => {
  const manifest = {
    host: 'https://tilecache.rainviewer.com',
    radar: { past: [
      { time: 1789361400, path: '/v2/radar/50efa037a58e' },
      { time: 1789360800, path: '/v2/radar/4a1b2c3d4e5f' },
      { time: 1789360200, path: '/../etc/passwd' },
      { time: 'x', path: '/v2/radar/abc' },
    ] },
  };
  assert.deepEqual(normalizeRainViewerManifest(manifest), {
    host: 'https://tilecache.rainviewer.com',
    frames: [
      { time: 1789360800000, path: '/v2/radar/4a1b2c3d4e5f' },
      { time: 1789361400000, path: '/v2/radar/50efa037a58e' },
    ],
  });
  assert.equal(normalizeRainViewerManifest({ host: 'http://insecure.example', radar: { past: [] } }), null);
  assert.equal(normalizeRainViewerManifest({ host: 'https://tilecache.rainviewer.com' }), null);
});

test('IEM frames are 13 ten-minute boundaries ending at least five minutes ago', () => {
  const times = iemFrameTimes(NOW);
  assert.equal(times.length, FRAME_COUNT);
  assert.equal(times.at(-1), Date.UTC(2026, 8, 14, 4, 50));
  assert.equal(times[0], Date.UTC(2026, 8, 14, 2, 50));
  for (let i = 1; i < times.length; i += 1) assert.equal(times[i] - times[i - 1], FRAME_STEP_MS);
  assert.equal(iemFrameTimes(Date.UTC(2026, 8, 14, 4, 54, 59)).at(-1), Date.UTC(2026, 8, 14, 4, 40));
});

test('tile coordinates must be integers within zoom 0-7', () => {
  assert.deepEqual(parseTileCoords('4', '3', '6'), { z: 4, x: 3, y: 6 });
  for (const bad of [['8', '0', '0'], ['4', '16', '0'], ['4', '0', '-1'], ['1.5', '0', '0'], ['a', '0', '0']]) {
    assert.equal(parseTileCoords(...bad), null, bad.join('/'));
  }
  assert.equal(
    rainViewerTileUrl('https://tilecache.rainviewer.com', '/v2/radar/50efa037a58e', { z: 4, x: 3, y: 6 }),
    'https://tilecache.rainviewer.com/v2/radar/50efa037a58e/256/4/3/6/2/1_1.png',
  );
});

test('IEM queries are validated for time, bbox and size', () => {
  const ok = new URLSearchParams({ time: '2026-09-14T04:50:00Z', bbox: '-100,28,-94,34', width: '256', height: '256' });
  assert.deepEqual(parseIemQuery(ok, NOW), { time: '2026-09-14T04:50:00Z', bbox: [-100, 28, -94, 34], width: 256, height: 256 });
  const bad = (patch) => parseIemQuery(new URLSearchParams({ ...Object.fromEntries(ok), ...patch }), NOW);
  assert.match(bad({ time: '2026-09-14T04:52:00Z' }).error, /time/, 'not a 5-minute boundary');
  assert.match(bad({ time: '2026-09-13T20:00:00Z' }).error, /time/, 'older than 6 hours');
  assert.match(bad({ time: '2026-09-14T05:05:00Z' }).error, /time/, 'in the future');
  assert.deepEqual(bad({ bbox: '-135,45,-112.5,67.5' }).bbox, [-135, 45, -112.5, 67.5], 'a level-3 edge tile is accepted');
  assert.match(bad({ bbox: '-140,28,-94,34' }).error, /bbox/, 'west beyond the envelope');
  assert.match(bad({ bbox: '-100,28,-40,34' }).error, /bbox/, 'east beyond the envelope');
  assert.match(bad({ bbox: '-130,21,-50,50' }).error, /bbox/, 'span wider than 70 degrees');
  assert.match(bad({ bbox: '-94,28,-100,34' }).error, /bbox/, 'west not less than east');
  assert.match(bad({ bbox: '-100,28,-94' }).error, /bbox/, 'three numbers');
  assert.match(bad({ width: '513' }).error, /size/);
  assert.match(bad({ height: '0' }).error, /size/);
});

test('IEM image URL uses the time-aware layer, and the cache key is stable', () => {
  const query = { time: '2026-09-14T04:50:00Z', bbox: [-100, 28, -94, 34], width: 256, height: 256 };
  const url = new URL(iemImageUrl(query));
  assert.equal(url.origin + url.pathname, IEM_WMS_URL);
  assert.equal(url.searchParams.get('layers'), 'nexrad-n0q-wmst');
  assert.equal(url.searchParams.get('time'), '2026-09-14T04:50:00Z');
  assert.equal(url.searchParams.get('bbox'), '-100,28,-94,34');
  assert.equal(url.searchParams.get('srs'), 'EPSG:4326');
  assert.equal(url.searchParams.get('transparent'), 'true');
  assert.match(iemCacheKey(query), /^[0-9a-f]{40}$/);
  assert.equal(iemCacheKey(query), iemCacheKey({ ...query }));
  assert.notEqual(iemCacheKey(query), iemCacheKey({ ...query, width: 512 }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/data/weatherRadarSources.test.mjs`
Expected: FAIL with `Cannot find module` for `sources.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// server/providers/weather-radar/sources.js
import { createHash } from 'node:crypto';

export const RAINVIEWER_MANIFEST_URL = 'https://api.rainviewer.com/public/weather-maps.json';
export const IEM_WMS_URL = 'https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0q-t.cgi';
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
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(host) || !Array.isArray(json?.radar?.past)) return null;
  const frames = json.radar.past
    .map((entry) => ({ time: Number(entry?.time) * 1000, path: String(entry?.path ?? '') }))
    .filter((frame) => Number.isFinite(frame.time) && frame.time > 0 && RAINVIEWER_PATH.test(frame.path))
    .sort((a, b) => a.time - b.time);
  return { host, frames };
}

/** Thirteen 10-minute boundaries; the newest is at least IEM_LATENCY_MS old. */
export function iemFrameTimes(nowMs) {
  const newest = Math.floor((nowMs - IEM_LATENCY_MS) / FRAME_STEP_MS) * FRAME_STEP_MS;
  return Array.from({ length: FRAME_COUNT }, (_, i) => newest - (FRAME_COUNT - 1 - i) * FRAME_STEP_MS);
}

function strictInt(value) {
  return /^-?\d+$/.test(String(value)) ? Number(value) : null;
}

export function parseTileCoords(z, x, y) {
  const [zi, xi, yi] = [strictInt(z), strictInt(x), strictInt(y)];
  if (zi === null || xi === null || yi === null || zi < 0 || zi > 7) return null;
  const size = 2 ** zi;
  if (xi < 0 || xi >= size || yi < 0 || yi >= size) return null;
  return { z: zi, x: xi, y: yi };
}

export function rainViewerTileUrl(host, path, { z, x, y }) {
  return `${host}${path}/256/${z}/${x}/${y}/2/1_1.png`;
}

export function parseIemQuery(searchParams, nowMs) {
  const timeText = String(searchParams.get('time') ?? '');
  const timeMs = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/.test(timeText) ? Date.parse(timeText) : Number.NaN;
  if (!Number.isFinite(timeMs) || timeMs % FIVE_MINUTES_MS !== 0 || timeMs > nowMs || timeMs < nowMs - IEM_MAX_AGE_MS) {
    return { error: 'time must be a 5-minute UTC boundary within the last 6 hours' };
  }
  const parts = String(searchParams.get('bbox') ?? '').split(',').map(Number);
  const [w, s, e, n] = parts;
  const bboxOk = parts.length === 4 && parts.every(Number.isFinite)
    && w < e && s < n
    && w >= IEM_BOUNDS.west && e <= IEM_BOUNDS.east && s >= IEM_BOUNDS.south && n <= IEM_BOUNDS.north
    && e - w <= IEM_MAX_SPAN.lon && n - s <= IEM_MAX_SPAN.lat;
  if (!bboxOk) return { error: 'bbox must be west,south,east,north within the contiguous US' };
  const width = strictInt(searchParams.get('width'));
  const height = strictInt(searchParams.get('height'));
  if (width === null || height === null || width < 1 || width > 512 || height < 1 || height > 512) {
    return { error: 'size must be integers from 1 to 512' };
  }
  return { time: timeText, bbox: [w, s, e, n], width, height };
}

export function iemImageUrl({ time, bbox, width, height }) {
  const params = new URLSearchParams({
    service: 'WMS', version: '1.1.1', request: 'GetMap', layers: 'nexrad-n0q-wmst',
    srs: 'EPSG:4326', bbox: bbox.join(','), width: String(width), height: String(height),
    format: 'image/png', transparent: 'true', time,
  });
  return `${IEM_WMS_URL}?${params}`;
}

export function iemCacheKey({ time, bbox, width, height }) {
  return createHash('sha1').update(`${time}|${bbox.join(',')}|${width}x${height}`).digest('hex');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/data/weatherRadarSources.test.mjs`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add server/providers/weather-radar/sources.js src/data/weatherRadarSources.test.mjs
git commit -m "feat(weather-radar): proxy source helpers and validation"
```

---

### Task 3: Radar proxy routes, cache and plugin

**Files:**
- Create: `server/providers/weather-radar.js`, `src/data/fixtures/rainviewer-weather-maps.json`
- Modify: `server/providers/local.js` (import, `localProviderPlugins()` entry, re-export)
- Test: `src/data/weatherRadarProxy.test.mjs`

**Interfaces:**
- Consumes: everything exported by `server/providers/weather-radar/sources.js` (Task 2); `makeRateLimiter`, `clientKey` from `server/providers/common/rate-limit.js`; `coalesceProxyRequest(inFlight, key, create) → { promise, shared }` from `server/providers/common/http.js`.
- Produces:
  - `createWeatherRadarHandler({ fetchImpl, cacheDir, now, limiter, log }) → async (req, res)`, mounted at `/api/radar`:
    - `GET /frames?source=rainviewer|iem`
    - `GET /rainviewer/<timeMs>/<z>/<x>/<y>.png`
    - `GET /iem?time&bbox&width&height`
  - `weatherRadarProxy(options) → { name: 'weather-radar-proxy', configureServer, configurePreviewServer }`
  - Frames body: `{ source, frames: [{ time }], generatedAt, stale }`. Tiles: `image/png` with header `X-Radar-Cache: HIT|MISS`.

- [ ] **Step 1: Create the manifest fixture**

```json
{
  "version": "2.0",
  "generated": 1789361000,
  "host": "https://tilecache.rainviewer.com",
  "radar": {
    "past": [
      { "time": 1789353600, "path": "/v2/radar/fixture00" },
      { "time": 1789354200, "path": "/v2/radar/fixture01" },
      { "time": 1789354800, "path": "/v2/radar/fixture02" },
      { "time": 1789355400, "path": "/v2/radar/fixture03" },
      { "time": 1789356000, "path": "/v2/radar/fixture04" },
      { "time": 1789356600, "path": "/v2/radar/fixture05" },
      { "time": 1789357200, "path": "/v2/radar/fixture06" },
      { "time": 1789357800, "path": "/v2/radar/fixture07" },
      { "time": 1789358400, "path": "/v2/radar/fixture08" },
      { "time": 1789359000, "path": "/v2/radar/fixture09" },
      { "time": 1789359600, "path": "/v2/radar/fixture10" },
      { "time": 1789360200, "path": "/v2/radar/fixture11" },
      { "time": 1789360800, "path": "/v2/radar/fixture12" }
    ],
    "nowcast": []
  },
  "satellite": { "infrared": [] }
}
```

Save as `src/data/fixtures/rainviewer-weather-maps.json` (shape recorded from the live manifest on 2026-09-14; frame paths replaced).

- [ ] **Step 2: Write the failing test**

```js
// src/data/weatherRadarProxy.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, stat, utimes } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import createViteConfig from '../../vite.config.js';
import { createWeatherRadarHandler } from '../../server/providers/weather-radar.js';
import { iemCacheKey } from '../../server/providers/weather-radar/sources.js';

const MANIFEST = JSON.parse(readFileSync(new URL('./fixtures/rainviewer-weather-maps.json', import.meta.url), 'utf8'));
const NEWEST_MS = 1789360800 * 1000;
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001', 'hex');
const MINUTE = 60_000;

async function tempDir(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gev-radar-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** Route by URL substring; count calls per route; a function answer may throw. */
function upstream(routes) {
  const calls = [];
  const fetchImpl = async (url) => {
    const href = String(url);
    calls.push(href);
    for (const [match, answer] of routes) {
      if (!href.includes(match)) continue;
      const value = typeof answer === 'function' ? await answer(href) : answer;
      if (value instanceof Response) return value;
      return Response.json(value);
    }
    throw new Error(`unexpected upstream ${href}`);
  };
  return { fetchImpl, calls, count: (match) => calls.filter((href) => href.includes(match)).length };
}

const png = () => new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });

function invoke(handler, url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = { method, url, headers: {}, socket: { remoteAddress: '127.0.0.1' } };
    const res = {
      writeHead(status, headers) { this.status = status; this.headers = headers || {}; },
      end(body) {
        const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body || '');
        resolve({ status: this.status, headers: this.headers, buffer, json: () => JSON.parse(buffer.toString('utf8')) });
      },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

test('the RainViewer frame list hides upstream paths and caches the manifest for two minutes', async (t) => {
  let clock = NEWEST_MS + 5 * MINUTE;
  const net = upstream([['weather-maps.json', MANIFEST]]);
  const handler = createWeatherRadarHandler({ fetchImpl: net.fetchImpl, cacheDir: await tempDir(t), now: () => clock, limiter: () => true, log: () => {} });
  const first = await invoke(handler, '/frames?source=rainviewer');
  assert.equal(first.status, 200);
  const body = first.json();
  assert.equal(body.source, 'rainviewer');
  assert.equal(body.stale, false);
  assert.equal(body.frames.length, 13);
  assert.deepEqual(body.frames.at(-1), { time: NEWEST_MS });
  assert.doesNotMatch(first.buffer.toString(), /fixture|tilecache/, 'upstream host and paths stay server-side');
  await invoke(handler, '/frames');
  assert.equal(net.count('weather-maps.json'), 1);
  clock += 121_000;
  await invoke(handler, '/frames');
  assert.equal(net.count('weather-maps.json'), 2);
});

test('IEM frames are 13 synthesized ten-minute boundaries', async (t) => {
  const now = Date.UTC(2026, 8, 14, 4, 57, 30);
  const handler = createWeatherRadarHandler({ fetchImpl: upstream([]).fetchImpl, cacheDir: await tempDir(t), now: () => now, limiter: () => true, log: () => {} });
  const body = (await invoke(handler, '/frames?source=iem')).json();
  assert.equal(body.source, 'iem');
  assert.equal(body.frames.length, 13);
  assert.deepEqual(body.frames.at(-1), { time: Date.UTC(2026, 8, 14, 4, 50) });
});

test('a failed manifest refresh serves the last good list as stale; with no list it is 502', async (t) => {
  let clock = NEWEST_MS + 5 * MINUTE;
  let up = true;
  const net = upstream([['weather-maps.json', () => { if (!up) throw new Error('offline'); return MANIFEST; }]]);
  const handler = createWeatherRadarHandler({ fetchImpl: net.fetchImpl, cacheDir: await tempDir(t), now: () => clock, limiter: () => true, log: () => {} });
  await invoke(handler, '/frames');
  up = false;
  clock += 121_000;
  const stale = await invoke(handler, '/frames');
  assert.equal(stale.status, 200);
  assert.equal(stale.json().stale, true);
  assert.equal(stale.json().frames.length, 13);

  const cold = createWeatherRadarHandler({ fetchImpl: net.fetchImpl, cacheDir: await tempDir(t), now: () => clock, limiter: () => true, log: () => {} });
  const failed = await invoke(cold, '/frames');
  assert.equal(failed.status, 502);
  assert.deepEqual(failed.json(), { error: 'upstream unavailable' });
});

test('RainViewer tiles are validated, fetched once, cached, and failures are never cached', async (t) => {
  const cacheDir = await tempDir(t);
  let failTile = true;
  const net = upstream([
    ['weather-maps.json', MANIFEST],
    ['/256/4/3/7/', () => (failTile ? new Response('busy', { status: 503 }) : png())],
    ['/256/4/3/6/', png],
  ]);
  const handler = createWeatherRadarHandler({ fetchImpl: net.fetchImpl, cacheDir, now: () => NEWEST_MS + 5 * MINUTE, limiter: () => true, log: () => {} });
  const route = `/rainviewer/${NEWEST_MS}/4/3/6.png`;

  const miss = await invoke(handler, route);
  assert.equal(miss.status, 200);
  assert.equal(miss.headers['Content-Type'], 'image/png');
  assert.equal(miss.headers['X-Radar-Cache'], 'MISS');
  assert.ok(net.calls.includes('https://tilecache.rainviewer.com/v2/radar/fixture12/256/4/3/6/2/1_1.png'));
  await stat(path.join(cacheDir, 'rainviewer', String(NEWEST_MS), '4', '3', '6.png'));

  const hit = await invoke(handler, route);
  assert.equal(hit.headers['X-Radar-Cache'], 'HIT');
  assert.equal(net.count('/256/4/3/6/'), 1);

  assert.equal((await invoke(handler, `/rainviewer/${NEWEST_MS}/8/0/0.png`)).status, 400);
  assert.equal((await invoke(handler, `/rainviewer/${NEWEST_MS}/4/3/6.jpg`)).status, 400);
  assert.equal((await invoke(handler, '/rainviewer/123/4/3/6.png')).status, 404);

  assert.equal((await invoke(handler, `/rainviewer/${NEWEST_MS}/4/3/7.png`)).status, 502);
  failTile = false;
  assert.equal((await invoke(handler, `/rainviewer/${NEWEST_MS}/4/3/7.png`)).status, 200);
  assert.equal(net.count('/256/4/3/7/'), 2, 'the failed tile was not cached');
});

test('IEM images use the time-aware layer and cache recent frames 5 minutes, older frames 24 hours', async (t) => {
  const cacheDir = await tempDir(t);
  const nowMs = Date.now();
  const boundary = (ms) => Math.floor(ms / (5 * MINUTE)) * 5 * MINUTE;
  const iso = (ms) => `${new Date(ms).toISOString().slice(0, 16)}:00Z`;
  const net = upstream([['n0q-t.cgi', png]]);
  const handler = createWeatherRadarHandler({ fetchImpl: net.fetchImpl, cacheDir, now: () => nowMs, limiter: () => true, log: () => {} });
  const query = (ms) => ({ time: iso(ms), bbox: [-100, 28, -94, 34], width: 256, height: 256 });
  const route = (q) => `/iem?time=${q.time}&bbox=${q.bbox.join(',')}&width=${q.width}&height=${q.height}`;

  assert.equal((await invoke(handler, '/iem?time=bad&bbox=-100,28,-94,34&width=256&height=256')).status, 400);

  const recent = query(boundary(nowMs - 5 * MINUTE));
  assert.equal((await invoke(handler, route(recent))).headers['X-Radar-Cache'], 'MISS');
  const upstreamUrl = new URL(net.calls.at(-1));
  assert.equal(upstreamUrl.pathname, '/cgi-bin/wms/nexrad/n0q-t.cgi');
  assert.equal(upstreamUrl.searchParams.get('layers'), 'nexrad-n0q-wmst');
  assert.equal((await invoke(handler, route(recent))).headers['X-Radar-Cache'], 'HIT');

  const sixMinutesAgo = new Date(nowMs - 6 * MINUTE);
  await utimes(path.join(cacheDir, 'iem', `${iemCacheKey(recent)}.png`), sixMinutesAgo, sixMinutesAgo);
  assert.equal((await invoke(handler, route(recent))).headers['X-Radar-Cache'], 'MISS', 'recent frames expire after 5 minutes');

  const older = query(boundary(nowMs - 60 * MINUTE));
  await invoke(handler, route(older));
  await utimes(path.join(cacheDir, 'iem', `${iemCacheKey(older)}.png`), sixMinutesAgo, sixMinutesAgo);
  assert.equal((await invoke(handler, route(older))).headers['X-Radar-Cache'], 'HIT', 'older frames keep for 24 hours');
});

test('rate limits, methods, unknown paths and non-PNG bodies', async (t) => {
  const cacheDir = await tempDir(t);
  const limited = createWeatherRadarHandler({ fetchImpl: upstream([]).fetchImpl, cacheDir, limiter: () => false, log: () => {} });
  const refused = await invoke(limited, '/frames?source=iem');
  assert.equal(refused.status, 429);
  assert.equal(refused.headers['Retry-After'], '10');

  const net = upstream([['weather-maps.json', MANIFEST], ['/256/', () => new Response('<html>not a tile</html>', { status: 200 })]]);
  const handler = createWeatherRadarHandler({ fetchImpl: net.fetchImpl, cacheDir, now: () => NEWEST_MS, limiter: () => true, log: () => {} });
  assert.equal((await invoke(handler, '/frames', 'POST')).status, 405);
  assert.equal((await invoke(handler, '/nope')).status, 404);
  assert.equal((await invoke(handler, `/rainviewer/${NEWEST_MS}/2/1/1.png`)).status, 502);
});

test('the plugin is registered in the Vite config at /api/radar', () => {
  const plugin = createViteConfig({ mode: 'test' }).plugins.find((p) => p.name === 'weather-radar-proxy');
  assert.ok(plugin, 'weather-radar-proxy must be registered');
  const routes = new Map();
  plugin.configureServer({ middlewares: { use: (route, handler) => routes.set(route, handler) } });
  assert.equal(typeof routes.get('/api/radar'), 'function');
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test src/data/weatherRadarProxy.test.mjs`
Expected: FAIL with `Cannot find module` for `server/providers/weather-radar.js`.

- [ ] **Step 4: Write the implementation**

```js
// server/providers/weather-radar.js
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
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
const USER_AGENT = 'CyclopsView/0.1 (+https://github.com/CaptPat/gods-eye-view)';

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

function sendPng(res, bytes, cacheStatus) {
  res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=600', 'X-Radar-Cache': cacheStatus });
  res.end(bytes);
}

async function readPngCapped(response) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) throw new Error('radar image too large');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('radar image too large');
  if (bytes.subarray(0, 4).toString('hex') !== '89504e47') throw new Error('radar image is not a PNG');
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
    await Promise.all(names
      .filter((name) => /^\d+$/.test(name) && Number(name) < oldest - RAINVIEWER_CACHE_GRACE_MS)
      .map((name) => rm(path.join(cacheDir, 'rainviewer', name), { recursive: true, force: true })));
  }

  async function currentManifest() {
    if (manifest && now() - manifestCheckedAt < MANIFEST_TTL_MS) return manifest;
    try {
      const { promise } = coalesceProxyRequest(inFlight, 'rainviewer-manifest', async () =>
        normalizeRainViewerManifest(await (await fetchUpstream(RAINVIEWER_MANIFEST_URL)).json()));
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
    const { promise } = coalesceProxyRequest(inFlight, target, async () => readPngCapped(await fetchUpstream(target)));
    const bytes = await promise;
    await writeCached(file, bytes);
    return sendPng(res, bytes, 'MISS');
  }

  async function frames(url, res) {
    if (url.searchParams.get('source') === 'iem') {
      return sendJson(res, 200, { source: 'iem', frames: iemFrameTimes(now()).map((time) => ({ time })), generatedAt: now(), stale: false });
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
    const coords = yFile.endsWith('.png') ? parseTileCoords(z, x, yFile.slice(0, -4)) : null;
    if (!coords) return sendJson(res, 400, { error: 'invalid tile coordinates' });
    const current = await currentManifest();
    const frame = current.frames.find((candidate) => String(candidate.time) === timeText);
    if (!frame) return sendJson(res, 404, { error: 'unknown radar frame' });
    const file = path.join(cacheDir, 'rainviewer', timeText, String(coords.z), String(coords.x), `${coords.y}.png`);
    return sendImage(res, file, Number.POSITIVE_INFINITY, rainViewerTileUrl(current.host, frame.path, coords));
  }

  async function iemImage(url, res) {
    const query = parseIemQuery(url.searchParams, now());
    if (query.error) return sendJson(res, 400, { error: query.error });
    const ageMs = now() - Date.parse(query.time);
    const maxAgeMs = ageMs < IEM_RECENT_MS ? IEM_RECENT_TTL_MS : IEM_TTL_MS;
    return sendImage(res, path.join(cacheDir, 'iem', `${iemCacheKey(query)}.png`), maxAgeMs, iemImageUrl(query));
  }

  return async function handle(req, res) {
    try {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
      if (!limiter(clientKey(req))) return sendJson(res, 429, { error: 'rate limited' }, { 'Retry-After': '10' });
      const url = new URL(req.url || '/', 'http://radar.local');
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length === 1 && parts[0] === 'frames') return await frames(url, res);
      if (parts.length === 5 && parts[0] === 'rainviewer') return await rainViewerTile(parts, res);
      if (parts.length === 1 && parts[0] === 'iem') return await iemImage(url, res);
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
  return { name: 'weather-radar-proxy', configureServer: install, configurePreviewServer: install };
}
```

- [ ] **Step 5: Register the plugin in `server/providers/local.js`**

Add the import beside the other provider imports:

```js
import { weatherRadarProxy } from './weather-radar.js';
```

Add `weatherRadarProxy(),` to the array returned by `localProviderPlugins()`, directly after `geocodeSearchProxy(),`.

Add to the re-export list:

```js
export { createWeatherRadarHandler, weatherRadarProxy } from './weather-radar.js';
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test src/data/weatherRadarProxy.test.mjs src/data/weatherRadarSources.test.mjs`
Expected: PASS, 12 tests.

- [ ] **Step 7: Commit**

```bash
git add server/providers/weather-radar.js server/providers/local.js src/data/fixtures/rainviewer-weather-maps.json src/data/weatherRadarProxy.test.mjs
git commit -m "feat(weather-radar): caching radar proxy routes"
```

---

### Task 4: Layer-state registry and options

**Files:**
- Modify: `src/data/layerState.js` (add `normalizeRadarOpacity` below `normalizeVolume`, a `LAYER_STATE_REGISTRY` entry, an `OPTION_GROUPS` group)
- Modify: `src/data/layerState.test.mjs` (registry count 16 → 17; new round-trip test)

**Interfaces:**
- Consumes: `booleanOption(key, token, defaultValue)` already in `src/data/layerState.js`.
- Produces:
  - Layer-state options `options['weather-radar'] = { usDetail: boolean, opacity: 0.4 | 0.7 | 1 }` (defaults `false`, `0.7`).
  - Restoration calls `dataManager.setLayerParams('weather-radar', { usDetail, opacity }, { origin })`, so Task 7's `setParams` must accept exactly those keys.

- [ ] **Step 1: Write the failing test**

In `src/data/layerState.test.mjs`, change the two registry-count assertions in the test `'production registry is exact, canonical, and rejects incomplete contracts'`:

```js
  assert.equal(REGISTERED_LAYER_IDS.length, 17);
  assert.equal(new Set(REGISTERED_LAYER_IDS).size, 17);
```

Append this test at the end of the file:

```js
test('weather radar options round-trip through the compact URL and normalize strictly', () => {
  const state = createDefaultLayerState();
  assert.deepEqual(state.options['weather-radar'], { usDetail: false, opacity: 0.7 });

  state.enabledLayerIds = ['weather-radar'];
  state.options['weather-radar'] = { usDetail: true, opacity: 0.4 };
  const params = encodeLayerStateParams(new URLSearchParams('v=2'), state);
  assert.equal(params.get('l'), 'p');
  const assignments = String(params.get('lo') || '').split('_');
  assert.ok(assignments.includes('p.u.1'), assignments.join('_'));
  assert.ok(assignments.includes('p.o.40'), assignments.join('_'));
  assert.deepEqual(decodeLayerStateParams(params).options['weather-radar'], { usDetail: true, opacity: 0.4 });

  state.options['weather-radar'] = { usDetail: false, opacity: 0.7 };
  const defaults = encodeLayerStateParams(new URLSearchParams('v=2'), state);
  assert.equal(String(defaults.get('lo') || '').split('_').some((entry) => entry.startsWith('p.')), false);

  assert.deepEqual(
    decodeLayerStateParams(new URLSearchParams('v=2&l=p&lo=p.o.55')).options['weather-radar'],
    { usDetail: false, opacity: 0.7 },
    'an unknown opacity token falls back to the default',
  );
  assert.deepEqual(
    normalizeLayerState({ options: { 'weather-radar': { usDetail: 'yes', opacity: 0.69999 } } }).options['weather-radar'],
    { usDetail: false, opacity: 0.7 },
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/data/layerState.test.mjs`
Expected: FAIL — the registry has 16 ids, and `options['weather-radar']` is `undefined`.

- [ ] **Step 3: Implement**

In `src/data/layerState.js`, directly below `function normalizeVolume(value) { … }`:

```js
const RADAR_OPACITIES = Object.freeze([0.4, 0.7, 1]);

function normalizeRadarOpacity(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return RADAR_OPACITIES.find((option) => Math.abs(option - numeric) < 0.001) ?? null;
}
```

Inside `OPTION_GROUPS`, after the closing `]),` of the `radio` group and before the object's closing `});`:

```js
  'weather-radar': Object.freeze([
    booleanOption('usDetail', 'u', false),
    Object.freeze({
      key: 'opacity',
      token: 'o',
      defaultValue: 0.7,
      normalize: normalizeRadarOpacity,
      encode: (value) => String(Math.round(value * 100)),
      decode: (value) => (/^(40|70|100)$/.test(value) ? Number(value) / 100 : null),
    }),
  ]),
```

In `LAYER_STATE_REGISTRY`, directly after the `traffic` entry, so ids stay sorted:

```js
  Object.freeze({ id: 'weather-radar', token: 'p', disposition: 'enabled+options', optionOwner: 'weather-radar' }),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test src/data/layerState.test.mjs`
Expected: PASS (the full file, including the new test).

- [ ] **Step 5: Commit**

```bash
git add src/data/layerState.js src/data/layerState.test.mjs
git commit -m "feat(weather-radar): layer-state token and options"
```

---

### Task 5: Row controls and legend

**Files:**
- Create: `src/layers/weather-radar/controls.js`
- Test: `src/layers/weather-radar/controls.test.mjs`

**Interfaces:**
- Consumes: the Layers panel row-control contract (`src/ui/layerPanel.js`).
  - Chips: `{ id, label, title, active, disabled, params }`.
  - Legend: `{ label, count, color, blurb }`, rendered as `${label} ${_formatCount(count)}`. `count` must be set, or the row shows "undefined", so the legend passes the dBZ text as `count`.
- Produces:
  - `RADAR_OPACITIES = [0.4, 0.7, 1]`
  - `normalizeOpacity(value) → 0.4 | 0.7 | 1 | null`
  - `buildRowControls({ playing, usDetail, opacity, loopAvailable }) → { chips, legend }`

- [ ] **Step 1: Write the failing test**

```js
// src/layers/weather-radar/controls.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { RADAR_OPACITIES, buildRowControls, normalizeOpacity } from './controls.js';

test('opacity snaps only to the three offered steps', () => {
  assert.deepEqual(RADAR_OPACITIES, [0.4, 0.7, 1]);
  assert.equal(normalizeOpacity(0.4), 0.4);
  assert.equal(normalizeOpacity('0.7'), 0.7);
  assert.equal(normalizeOpacity(1.0004), 1);
  assert.equal(normalizeOpacity(0.5), null);
  assert.equal(normalizeOpacity('x'), null);
});

test('chips reflect loop, US detail and opacity state, and carry the params that toggle them', () => {
  const { chips } = buildRowControls({ playing: false, usDetail: false, opacity: 0.7, loopAvailable: true });
  assert.deepEqual(chips.map((chip) => chip.id), ['loop', 'us-detail', 'opacity-40', 'opacity-70', 'opacity-100']);
  assert.deepEqual(chips[0], { id: 'loop', label: '▶ Loop', title: 'Loop the last two hours', active: false, disabled: false, params: { loop: true } });
  assert.deepEqual(chips[1], { id: 'us-detail', label: 'US detail', title: 'Iowa State NEXRAD over the contiguous US', active: false, disabled: false, params: { usDetail: true } });
  assert.deepEqual(chips.slice(2).map((chip) => [chip.label, chip.active, chip.params.opacity]), [['40%', false, 0.4], ['70%', true, 0.7], ['100%', false, 1]]);

  const playing = buildRowControls({ playing: true, usDetail: true, opacity: 1, loopAvailable: true }).chips;
  assert.equal(playing[0].label, '❚❚ Pause');
  assert.equal(playing[0].title, 'Pause the loop');
  assert.deepEqual(playing[0].params, { loop: false });
  assert.deepEqual(playing[1].params, { usDetail: false });
  assert.equal(playing[1].active, true);

  const noFrames = buildRowControls({ playing: false, usDetail: false, opacity: 0.7, loopAvailable: false }).chips;
  assert.equal(noFrames[0].disabled, true);
});

test('the legend follows the active source and never renders an undefined count', () => {
  const rainviewer = buildRowControls({ playing: false, usDetail: false, opacity: 0.7, loopAvailable: true }).legend;
  assert.deepEqual(rainviewer.map((item) => [item.label, item.count, item.color]), [
    ['Light', '20 dBZ', '#00a3e0'], ['Moderate', '30 dBZ', '#005588'], ['Heavy', '50 dBZ', '#c10000'], ['Extreme', '65 dBZ', '#ffffff'],
  ]);
  const iem = buildRowControls({ playing: false, usDetail: true, opacity: 0.7, loopAvailable: true }).legend;
  assert.deepEqual(iem.map((item) => item.color), ['#00ff00', '#087305', '#ff0000', '#fe00fe']);
  for (const item of [...rainviewer, ...iem]) {
    assert.equal(typeof item.count, 'string');
    assert.match(item.blurb, /dBZ/);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/layers/weather-radar/controls.test.mjs`
Expected: FAIL with `Cannot find module` for `./controls.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/layers/weather-radar/controls.js
export const RADAR_OPACITIES = Object.freeze([0.4, 0.7, 1]);

// Colours from RainViewer's published table (rainviewer_api_colors_table.csv):
// the "Universal Blue" column is what the API serves; "NEXRAD Level III" is the
// NWS palette that Iowa State's n0q composite uses.
const LEGENDS = Object.freeze({
  rainviewer: Object.freeze({
    palette: 'Universal Blue',
    items: [['Light', '20 dBZ', '#00a3e0'], ['Moderate', '30 dBZ', '#005588'], ['Heavy', '50 dBZ', '#c10000'], ['Extreme', '65 dBZ', '#ffffff']],
  }),
  iem: Object.freeze({
    palette: 'NEXRAD Level III',
    items: [['Light', '20 dBZ', '#00ff00'], ['Moderate', '30 dBZ', '#087305'], ['Heavy', '50 dBZ', '#ff0000'], ['Extreme', '65 dBZ', '#fe00fe']],
  }),
});

export function normalizeOpacity(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return RADAR_OPACITIES.find((option) => Math.abs(option - numeric) < 0.001) ?? null;
}

/** Row chips and legend for the Layers panel (see layerPanel._syncRowControls). */
export function buildRowControls({ playing, usDetail, opacity, loopAvailable }) {
  const legend = LEGENDS[usDetail ? 'iem' : 'rainviewer'];
  return {
    chips: [
      {
        id: 'loop',
        label: playing ? '❚❚ Pause' : '▶ Loop',
        title: playing ? 'Pause the loop' : 'Loop the last two hours',
        active: Boolean(playing),
        disabled: !loopAvailable,
        params: { loop: !playing },
      },
      {
        id: 'us-detail',
        label: 'US detail',
        title: 'Iowa State NEXRAD over the contiguous US',
        active: Boolean(usDetail),
        disabled: false,
        params: { usDetail: !usDetail },
      },
      ...RADAR_OPACITIES.map((value) => {
        const percent = Math.round(value * 100);
        return {
          id: `opacity-${percent}`,
          label: `${percent}%`,
          title: `Radar opacity ${percent}%`,
          active: opacity === value,
          disabled: false,
          params: { opacity: value },
        };
      }),
    ],
    // `count` carries the dBZ text: the panel renders `${label} ${count}`.
    legend: legend.items.map(([label, count, color]) => ({
      label,
      count,
      color,
      blurb: `${legend.palette} colour at ${count}`,
    })),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/layers/weather-radar/controls.test.mjs`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/layers/weather-radar/controls.js src/layers/weather-radar/controls.test.mjs
git commit -m "feat(weather-radar): row controls and legend"
```

---

### Task 6: Radar imagery layers

**Files:**
- Create: `src/layers/weather-radar/imagery.js`
- Test: `src/layers/weather-radar/imagery.test.mjs`

**Interfaces:**
- Consumes:
  - Cesium `UrlTemplateImageryProvider`, `GeographicTilingScheme`, `Rectangle`, `ImageryLayer`;
  - `viewer.imageryLayers.add(layer)` and `remove(layer, destroy)`;
  - `viewer.scene.globe.tileLoadProgressEvent.addEventListener(fn) → remove` (fn receives the queued tile count).
- Produces:
  - `PRELOAD_ALPHA = 0.001`
  - `rainViewerTemplate(timeMs) → string`
  - `iemTemplate(timeMs) → string`
  - `createProvider(source, timeMs) → UrlTemplateImageryProvider`
  - `createRadarImagery(viewer, { createProvider, createLayer }) → { setSource(source), preload(times), show(time), setAlpha(alpha), release(keepTimes), isReady(time), readyCount(), shownTime(), clear(), destroy() }`
  - A frame is ready once the globe's tile queue first reports `0` after that frame's layer was added.

- [ ] **Step 1: Write the failing test**

```js
// src/layers/weather-radar/imagery.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { PRELOAD_ALPHA, createProvider, createRadarImagery, iemTemplate, rainViewerTemplate } from './imagery.js';

const T = Date.UTC(2026, 8, 14, 4, 50);
const MIN = 60_000;

function fakeViewer() {
  const listeners = new Set();
  const layers = [{ base: true }];
  return {
    layers,
    progress: (queued) => { for (const listener of [...listeners]) listener(queued); },
    listenerCount: () => listeners.size,
    imageryLayers: {
      add(layer) { layers.push(layer); return layer; },
      remove(layer) { const index = layers.indexOf(layer); if (index >= 0) layers.splice(index, 1); return index >= 0; },
    },
    scene: { globe: { tileLoadProgressEvent: { addEventListener(listener) { listeners.add(listener); return () => listeners.delete(listener); } } } },
  };
}

const fakeFactories = () => ({
  createProvider: (source, time) => ({ source, time }),
  createLayer: (provider) => ({ provider, alpha: 1, show: true }),
});

const radarLayers = (viewer) => viewer.layers.filter((layer) => !layer.base);

test('URL templates point at the proxy with Cesium tile tags', () => {
  assert.equal(rainViewerTemplate(T), `/api/radar/rainviewer/${T}/{z}/{x}/{y}.png`);
  assert.equal(
    iemTemplate(T),
    '/api/radar/iem?time=2026-09-14T04:50:00Z&bbox={westDegrees},{southDegrees},{eastDegrees},{northDegrees}&width={width}&height={height}',
  );
});

test('providers: RainViewer capped at zoom 7; IEM geographic, level 3-9, over the contiguous US', () => {
  const rainviewer = createProvider('rainviewer', T);
  assert.ok(rainviewer instanceof Cesium.UrlTemplateImageryProvider);
  assert.equal(rainviewer.maximumLevel, 7);
  const iem = createProvider('iem', T);
  assert.ok(iem.tilingScheme instanceof Cesium.GeographicTilingScheme);
  assert.equal(iem.minimumLevel, 3);
  assert.equal(iem.maximumLevel, 9);
  assert.ok(Math.abs(Cesium.Math.toDegrees(iem.rectangle.west) + 130) < 1e-9);
  assert.ok(Math.abs(Cesium.Math.toDegrees(iem.rectangle.north) - 55) < 1e-9);
});

test('preloaded frames sit above the base map, nearly transparent, and become ready when the tile queue drains', () => {
  const viewer = fakeViewer();
  const imagery = createRadarImagery(viewer, fakeFactories());
  imagery.setSource('rainviewer');
  imagery.preload([T - 10 * MIN, T]);
  assert.equal(viewer.layers[0].base, true, 'the base map stays at index 0');
  assert.deepEqual(radarLayers(viewer).map((layer) => [layer.provider.time, layer.alpha]), [[T - 10 * MIN, PRELOAD_ALPHA], [T, PRELOAD_ALPHA]]);
  assert.equal(imagery.readyCount(), 0);
  viewer.progress(5);
  assert.equal(imagery.readyCount(), 0);
  viewer.progress(0);
  assert.equal(imagery.readyCount(), 2);
  assert.equal(imagery.isReady(T), true);
  imagery.preload([T]);
  assert.equal(radarLayers(viewer).length, 2, 'preloading an existing frame adds nothing');
});

test('show brings one frame to full opacity and dims the previous; setAlpha follows the shown frame', () => {
  const viewer = fakeViewer();
  const imagery = createRadarImagery(viewer, fakeFactories());
  imagery.setSource('rainviewer');
  imagery.setAlpha(0.7);
  imagery.show(T - 10 * MIN);
  imagery.show(T);
  const [older, newer] = radarLayers(viewer);
  assert.equal(older.alpha, PRELOAD_ALPHA);
  assert.equal(newer.alpha, 0.7);
  assert.equal(imagery.shownTime(), T);
  imagery.setAlpha(0.4);
  assert.equal(newer.alpha, 0.4);
  assert.equal(older.alpha, PRELOAD_ALPHA);
});

test('release keeps only the given frames; a source change and clear remove every radar layer but never the base', () => {
  const viewer = fakeViewer();
  const imagery = createRadarImagery(viewer, fakeFactories());
  imagery.setSource('rainviewer');
  imagery.preload([T - 20 * MIN, T - 10 * MIN, T]);
  imagery.show(T);
  imagery.release([T - 10 * MIN, T]);
  assert.deepEqual(radarLayers(viewer).map((layer) => layer.provider.time), [T - 10 * MIN, T]);
  viewer.layers[0] = { base: true, replaced: true };
  imagery.setSource('iem');
  assert.equal(radarLayers(viewer).length, 0);
  assert.equal(imagery.shownTime(), null);
  imagery.show(T);
  assert.equal(radarLayers(viewer)[0].provider.source, 'iem');
  imagery.clear();
  assert.deepEqual(viewer.layers, [{ base: true, replaced: true }]);
  imagery.destroy();
  assert.equal(viewer.listenerCount(), 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/layers/weather-radar/imagery.test.mjs`
Expected: FAIL with `Cannot find module` for `./imagery.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/layers/weather-radar/imagery.js
import * as Cesium from 'cesium';

/** Loaded but effectively invisible: Cesium still requests tiles for it. */
export const PRELOAD_ALPHA = 0.001;
const IEM_RECTANGLE_DEGREES = Object.freeze([-130, 20, -60, 55]);

export function rainViewerTemplate(timeMs) {
  return `/api/radar/rainviewer/${timeMs}/{z}/{x}/{y}.png`;
}

export function iemTemplate(timeMs) {
  const iso = `${new Date(timeMs).toISOString().slice(0, 16)}:00Z`;
  return `/api/radar/iem?time=${iso}&bbox={westDegrees},{southDegrees},{eastDegrees},{northDegrees}&width={width}&height={height}`;
}

export function createProvider(source, timeMs) {
  if (source === 'iem') {
    return new Cesium.UrlTemplateImageryProvider({
      url: iemTemplate(timeMs),
      tilingScheme: new Cesium.GeographicTilingScheme(),
      tileWidth: 256,
      tileHeight: 256,
      // Level 3 (22.5° tiles) is the coarsest that fits the proxy's 70° x 35° span limit.
      minimumLevel: 3,
      maximumLevel: 9,
      rectangle: Cesium.Rectangle.fromDegrees(...IEM_RECTANGLE_DEGREES),
    });
  }
  return new Cesium.UrlTemplateImageryProvider({
    url: rainViewerTemplate(timeMs),
    tileWidth: 256,
    tileHeight: 256,
    maximumLevel: 7,
  });
}

export function createRadarImagery(viewer, {
  createProvider: makeProvider = createProvider,
  createLayer = (provider) => new Cesium.ImageryLayer(provider),
} = {}) {
  const layers = new Map();
  const pending = new Set();
  const ready = new Set();
  let source = null;
  let shown = null;
  let alpha = 0.7;

  const removeProgressListener = viewer.scene.globe.tileLoadProgressEvent.addEventListener((queued) => {
    if (queued !== 0) return;
    for (const time of pending) ready.add(time);
    pending.clear();
  });

  function remove(time) {
    const layer = layers.get(time);
    if (!layer) return;
    viewer.imageryLayers.remove(layer, true);
    layers.delete(time);
    pending.delete(time);
    ready.delete(time);
    if (shown === time) shown = null;
  }

  function ensure(time) {
    if (layers.has(time)) return layers.get(time);
    const layer = createLayer(makeProvider(source, time));
    layer.alpha = PRELOAD_ALPHA;
    layer.show = true;
    viewer.imageryLayers.add(layer);
    layers.set(time, layer);
    pending.add(time);
    return layer;
  }

  return {
    setSource(nextSource) {
      if (nextSource === source) return;
      for (const time of [...layers.keys()]) remove(time);
      source = nextSource;
    },
    preload(times) {
      for (const time of times) ensure(time);
    },
    show(time) {
      if (shown !== null && shown !== time && layers.has(shown)) layers.get(shown).alpha = PRELOAD_ALPHA;
      ensure(time).alpha = alpha;
      shown = time;
    },
    setAlpha(nextAlpha) {
      alpha = nextAlpha;
      if (shown !== null && layers.has(shown)) layers.get(shown).alpha = alpha;
    },
    release(keepTimes) {
      const keep = new Set(keepTimes);
      for (const time of [...layers.keys()]) if (!keep.has(time)) remove(time);
    },
    isReady: (time) => ready.has(time),
    readyCount: () => [...layers.keys()].filter((time) => ready.has(time)).length,
    shownTime: () => shown,
    clear() {
      for (const time of [...layers.keys()]) remove(time);
    },
    destroy() {
      this.clear();
      removeProgressListener();
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/layers/weather-radar/imagery.test.mjs`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/layers/weather-radar/imagery.js src/layers/weather-radar/imagery.test.mjs
git commit -m "feat(weather-radar): per-frame imagery layers with readiness"
```

---

### Task 7: Weather radar layer

**Files:**
- Create: `src/layers/weather-radar/index.js`, `src/data/weatherRadar.js`
- Modify: `src/data/dataCredits.js` (add `RAINVIEWER_CREDIT`, `IEM_NEXRAD_CREDIT` directly after `TOMTOM_CREDIT`)
- Test: `src/layers/weather-radar/index.test.mjs`

**Interfaces:**
- Consumes:
  - Task 1: `parseFramesPayload`, `pruneFrames`, `newestFrame`, `nextLoopStep`, `LOOP_FRAME_MS`.
  - Task 5: `buildRowControls`, `normalizeOpacity`.
  - Task 6: `createRadarImagery(viewer)`, returning `{ setSource, preload, show, setAlpha, release, isReady, readyCount, shownTime, clear, destroy }`.
  - `registerDynamicCredit(viewer, credit)` from `src/data/dataCredits.js`.
  - Manager contract:
    - lifecycle `init(viewer)`, `enable(viewer)`, `disable(viewer)`, `update(viewer, { signal })` on enable and every `updateInterval`, `destroy(viewer)`;
    - `getStats()`;
    - `setParams(params, { origin }) → false` rejects;
    - `getParams()`, `getRowControls()`, `setRowControlsListener(listener)`.
- Produces:
  - `createWeatherRadarLayer({ fetchImpl, createImagery, registerCredit, credits, eventTarget, isVisible, timers, now }) → layer`.
    - Layer fields: `id: 'weather-radar'`, `name: 'Weather Radar'`, `icon: '🌧️'`, `source: 'RainViewer'`, `updateInterval: 300000`.
    - Methods: `init`, `enable`, `disable`, `update`, `destroy`, `getStats`, `getParams → { usDetail, opacity }`, `setParams({ usDetail?, opacity?, loop? })`, `getRowControls`, `setRowControlsListener`, `attachMapStack({ getActiveId })`.
  - `SWAP_CHECK_MS = 1000`, `REFRESH_MS = 300000`.
  - `update()` resolves `true` for a hidden-tab skip, a superseded request and a handled fetch failure; the failure surfaces through `getStats().error`. It resolves `false` only when the manager's own signal aborted. `DataLayerManager` treats `false` as a failed enable or refresh (`src/data/manager.js`), and reads refresh failures from `stats.error`.
  - Retention counts 2 hours back from the newest frame, not from the clock, so upstream latency never drops the 13th frame.
  - `src/data/weatherRadar.js`: a default instance with real credits, plus `export *` of the layer module.
  - `RAINVIEWER_CREDIT`, `IEM_NEXRAD_CREDIT` in `src/data/dataCredits.js`.

- [ ] **Step 1: Write the failing test**

```js
// src/layers/weather-radar/index.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { REFRESH_MS, SWAP_CHECK_MS, createWeatherRadarLayer } from './index.js';
import defaultLayer from '../../data/weatherRadar.js';
import { IEM_NEXRAD_CREDIT, RAINVIEWER_CREDIT } from '../../data/dataCredits.js';

const T = Date.UTC(2026, 8, 14, 4, 50);
const MIN = 60_000;
const frames = (count, newest = T) => Array.from({ length: count }, (_, i) => ({ time: newest - (count - 1 - i) * 10 * MIN }));

function fakeImagery() {
  const calls = [];
  const ready = new Set();
  const layers = new Set();
  let shown = null;
  let source = null;
  const api = {
    setSource(next) { calls.push(['setSource', next]); if (next !== source) { layers.clear(); ready.clear(); shown = null; } source = next; },
    preload(times) { calls.push(['preload', [...times]]); for (const time of times) layers.add(time); },
    show(time) { calls.push(['show', time]); layers.add(time); shown = time; },
    setAlpha(alpha) { calls.push(['setAlpha', alpha]); },
    release(keep) { calls.push(['release', [...keep]]); for (const time of [...layers]) if (!keep.includes(time)) layers.delete(time); },
    isReady: (time) => ready.has(time),
    readyCount: () => [...layers].filter((time) => ready.has(time)).length,
    shownTime: () => shown,
    clear() { calls.push(['clear']); layers.clear(); shown = null; },
    destroy() { calls.push(['destroy']); },
  };
  return { api, calls, ready, layers, source: () => source };
}

function fakeTimers() {
  let pending = [];
  return {
    setTimeout(fn, ms) { const timer = { fn, ms }; pending.push(timer); return timer; },
    clearTimeout(timer) { pending = pending.filter((t) => t !== timer); },
    delays: () => pending.map((t) => t.ms),
    run(ms) {
      const timer = pending.find((t) => t.ms === ms);
      assert.ok(timer, `no pending ${ms} ms timer (pending: ${pending.map((t) => t.ms)})`);
      pending = pending.filter((t) => t !== timer);
      timer.fn();
    },
  };
}

function harness({ payloads = {}, visible = true } = {}) {
  const imagery = fakeImagery();
  const timers = fakeTimers();
  const credited = [];
  const requests = [];
  const events = new EventTarget();
  const clock = { now: T + 7 * MIN, visible };
  const answers = { rainviewer: { source: 'rainviewer', stale: false, frames: frames(13) }, iem: { source: 'iem', stale: false, frames: frames(13) }, ...payloads };
  const layer = createWeatherRadarLayer({
    fetchImpl: async (url) => {
      requests.push(url);
      const source = new URL(url, 'http://app.local').searchParams.get('source');
      const answer = answers[source];
      if (answer instanceof Error) throw answer;
      return Response.json(answer);
    },
    createImagery: () => imagery.api,
    registerCredit: (_viewer, credit) => credited.push(credit.key),
    credits: { rainviewer: { key: 'rainviewer', html: 'rv' }, iem: { key: 'iem', html: 'iem' } },
    eventTarget: events,
    isVisible: () => clock.visible,
    timers,
    now: () => clock.now,
  });
  const viewer = {};
  return { layer, imagery, timers, credited, requests, events, clock, answers, viewer };
}

async function enabled(h) {
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  await h.layer.update(h.viewer, {});
}

test('the layer identifies itself and refreshes every five minutes', () => {
  const { layer } = harness();
  assert.equal(layer.id, 'weather-radar');
  assert.equal(layer.name, 'Weather Radar');
  assert.equal(layer.icon, '🌧️');
  assert.equal(layer.updateInterval, REFRESH_MS);
  assert.equal(REFRESH_MS, 300_000);
  assert.equal(defaultLayer.id, 'weather-radar');
  assert.equal(RAINVIEWER_CREDIT.html, 'Radar: <a href="https://www.rainviewer.com/" target="_blank" rel="noopener">RainViewer</a>');
  assert.equal(IEM_NEXRAD_CREDIT.html, 'US radar: <a href="https://mesonet.agron.iastate.edu/" target="_blank" rel="noopener">Iowa Environmental Mesonet</a> NEXRAD');
});

test('enabling credits RainViewer, fetches frames and shows the newest with an honest age', async () => {
  const h = harness();
  await enabled(h);
  assert.deepEqual(h.credited, ['rainviewer']);
  assert.deepEqual(h.requests, ['/api/radar/frames?source=rainviewer']);
  assert.equal(h.imagery.api.shownTime(), T);
  // count 13, not 12: retention counts back from the newest frame, so the 7-minute lag drops nothing.
  assert.deepEqual(h.layer.getStats(), { status: 'ok', source: 'RainViewer · 04:50 UTC · 7 min old', count: 13, lastUpdate: T + 7 * MIN });
  assert.equal(h.layer.getRowControls().chips[0].disabled, false);
});

test('a hidden tab skips refreshes; failures report stale or unavailable', async () => {
  const h = harness();
  await enabled(h);
  h.clock.visible = false;
  assert.equal(await h.layer.update(h.viewer, {}), true, 'a skipped refresh is not a failure');
  assert.equal(h.requests.length, 1);

  h.clock.visible = true;
  h.answers.rainviewer = new Error('offline');
  assert.equal(await h.layer.update(h.viewer, {}), true, 'the failure is reported through stats, which the manager reads');
  assert.deepEqual(h.layer.getStats(), {
    stale: true, source: 'RainViewer · 04:50 UTC', error: 'Radar source unavailable — showing 04:50 UTC', count: 13, lastUpdate: T + 7 * MIN,
  });

  const cold = harness({ payloads: { rainviewer: new Error('offline') } });
  await enabled(cold);
  assert.deepEqual(cold.layer.getStats(), { status: 'unavailable', source: 'RainViewer', error: 'Radar source unavailable' });
});

test('a new newest frame is shown only once its tiles are ready', async () => {
  const h = harness();
  await enabled(h);
  h.answers.rainviewer = { source: 'rainviewer', stale: false, frames: frames(13, T + 10 * MIN) };
  h.clock.now = T + 17 * MIN;
  await h.layer.update(h.viewer, {});
  assert.equal(h.imagery.api.shownTime(), T, 'still showing the old frame');
  assert.ok(h.timers.delays().includes(SWAP_CHECK_MS));
  h.imagery.ready.add(T + 10 * MIN);
  h.timers.run(SWAP_CHECK_MS);
  assert.equal(h.imagery.api.shownTime(), T + 10 * MIN);
  assert.deepEqual([...h.imagery.layers], [T + 10 * MIN], 'older frames released');
});

test('the loop preloads every frame, steps through ready frames, and pause returns to live', async () => {
  const h = harness({ payloads: { rainviewer: { source: 'rainviewer', stale: false, frames: frames(3) } } });
  await enabled(h);
  assert.notEqual(h.layer.setParams({ loop: true }, { origin: 'user' }), false);
  assert.deepEqual(h.imagery.calls.find(([name]) => name === 'preload')[1], frames(3).map((f) => f.time));
  assert.deepEqual(h.layer.getStats(), { loading: true, source: 'RainViewer · Loading 0/3' });
  h.imagery.ready.add(frames(3)[0].time);
  h.imagery.ready.add(frames(3)[2].time);
  h.timers.run(500);
  assert.equal(h.imagery.api.shownTime(), frames(3)[0].time, 'the loop starts at the oldest ready frame');
  h.timers.run(500);
  assert.equal(h.imagery.api.shownTime(), frames(3)[2].time, 'a frame that is not ready is skipped');
  assert.ok(h.timers.delays().includes(1500), 'the newest frame holds');
  h.imagery.ready.add(frames(3)[1].time);
  h.timers.run(1500);
  assert.equal(h.imagery.api.shownTime(), frames(3)[0].time, 'a frame becoming ready mid-loop does not derail the order');
  assert.equal(h.layer.getRowControls().chips[0].label, '❚❚ Pause');
  h.layer.setParams({ loop: false }, { origin: 'user' });
  assert.deepEqual(h.timers.delays().filter((ms) => ms === 500 || ms === 1500), []);
  assert.equal(h.imagery.api.shownTime(), T);
  assert.deepEqual(h.layer.getParams(), { usDetail: false, opacity: 0.7 }, 'loop state is not a persisted param');
});

test('US detail switches source, credits Iowa State and refetches; opacity is applied and validated', async () => {
  const h = harness();
  await enabled(h);
  h.imagery.ready.add(T);
  assert.notEqual(h.layer.setParams({ usDetail: true }, { origin: 'user' }), false);
  assert.deepEqual(h.credited, ['rainviewer', 'iem']);
  assert.equal(h.requests.at(-1), '/api/radar/frames?source=iem', 'switching refetches at once');
  // A second update supersedes the switch's in-flight request, so this await settles both.
  assert.equal(await h.layer.update(h.viewer, {}), true);
  assert.equal(h.imagery.source(), 'iem');
  assert.equal(h.layer.getStats().source, 'Iowa State NEXRAD · 04:50 UTC · 7 min old');
  assert.equal(h.layer.getRowControls().legend[0].color, '#00ff00');

  assert.notEqual(h.layer.setParams({ opacity: 0.4 }, { origin: 'user' }), false);
  assert.deepEqual(h.imagery.calls.filter(([name]) => name === 'setAlpha').at(-1), ['setAlpha', 0.4]);
  assert.equal(h.layer.setParams({ opacity: 0.5 }, { origin: 'user' }), false);
  assert.equal(h.layer.setParams({ usDetail: 'yes' }, { origin: 'user' }), false);
  assert.deepEqual(h.layer.getParams(), { usDetail: true, opacity: 0.4 });
});

test('params restored before init apply once the layer runs', async () => {
  const h = harness();
  assert.notEqual(h.layer.setParams({ usDetail: true, opacity: 1 }, { origin: 'local-restore' }), false);
  await enabled(h);
  assert.equal(h.requests[0], '/api/radar/frames?source=iem');
  assert.deepEqual(h.imagery.calls.filter(([name]) => name === 'setAlpha')[0], ['setAlpha', 1]);
});

test('Google 3D is reported from the attached controller and from map-stack events', async () => {
  const h = harness();
  h.layer.attachMapStack({ getActiveId: () => 'photoreal' });
  await enabled(h);
  assert.deepEqual(h.layer.getStats(), { status: 'idle', source: 'RainViewer', statusMessage: 'Hidden by Google 3D map source', count: 13 });
  h.events.dispatchEvent(new CustomEvent('gev:map-stack-changed', { detail: { activeStack: { id: 'esri-imagery' } } }));
  assert.equal(h.layer.getStats().status, 'ok');
});

test('row-control listeners are notified; disable clears imagery and stops the loop; destroy unsubscribes', async () => {
  const h = harness({ payloads: { rainviewer: { source: 'rainviewer', stale: false, frames: frames(3) } } });
  let notified = 0;
  h.layer.setRowControlsListener(() => { notified += 1; });
  await enabled(h);
  assert.ok(notified > 0);
  h.layer.setParams({ loop: true }, { origin: 'user' });
  h.layer.disable(h.viewer);
  assert.deepEqual(h.timers.delays().filter((ms) => ms === 500 || ms === 1500), []);
  assert.equal(h.imagery.calls.at(-1)[0], 'clear');
  h.layer.destroy(h.viewer);
  assert.equal(h.imagery.calls.at(-1)[0], 'destroy');
  h.events.dispatchEvent(new CustomEvent('gev:map-stack-changed', { detail: { activeStack: { id: 'photoreal' } } }));
  assert.equal(h.layer.getStats().status === 'idle', false, 'destroyed layer no longer listens');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/layers/weather-radar/index.test.mjs`
Expected: FAIL with `Cannot find module` for `./index.js`.

- [ ] **Step 3: Add the credits**

In `src/data/dataCredits.js`, directly after the `TOMTOM_CREDIT` declaration:

```js
export const RAINVIEWER_CREDIT = Object.freeze({
  key: 'rainviewer',
  html: 'Radar: <a href="https://www.rainviewer.com/" target="_blank" rel="noopener">RainViewer</a>',
});

export const IEM_NEXRAD_CREDIT = Object.freeze({
  key: 'iem-nexrad',
  html: 'US radar: <a href="https://mesonet.agron.iastate.edu/" target="_blank" rel="noopener">Iowa Environmental Mesonet</a> NEXRAD',
});
```

- [ ] **Step 4: Write the layer**

```js
// src/layers/weather-radar/index.js
import { LOOP_FRAME_MS, newestFrame, nextLoopStep, parseFramesPayload, pruneFrames } from './frames.js';
import { buildRowControls, normalizeOpacity } from './controls.js';
import { createRadarImagery } from './imagery.js';

export const REFRESH_MS = 5 * 60 * 1000;
export const SWAP_CHECK_MS = 1000;
const SOURCE_NAMES = Object.freeze({ rainviewer: 'RainViewer', iem: 'Iowa State NEXRAD' });
const MAP_STACK_EVENT = 'gev:map-stack-changed';

const hhmm = (timeMs) => new Date(timeMs).toISOString().slice(11, 16);

export function createWeatherRadarLayer({
  fetchImpl = (...args) => fetch(...args),
  createImagery = createRadarImagery,
  registerCredit = () => false,
  credits = {},
  eventTarget = globalThis.window,
  isVisible = () => globalThis.document?.visibilityState !== 'hidden',
  timers = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (timer) => clearTimeout(timer) },
  now = Date.now,
} = {}) {
  let viewer = null;
  let imagery = null;
  let enabled = false;
  let usDetail = false;
  let opacity = 0.7;
  let playing = false;
  let frames = [];
  let loopTime = null;
  let loopTimer = null;
  let swapTimer = null;
  let lastUpdate = null;
  let error = null;
  let stale = false;
  let mapStackId = null;
  let rowListener = null;
  let request = null;

  const currentSource = () => (usDetail ? 'iem' : 'rainviewer');
  const notifyRows = () => rowListener?.();
  const onMapStack = (event) => {
    mapStackId = event?.detail?.activeStack?.id ?? mapStackId;
    notifyRows();
  };

  function clearTimer(timer) {
    if (timer) timers.clearTimeout(timer);
    return null;
  }

  function stopLoop() {
    playing = false;
    loopTime = null;
    loopTimer = clearTimer(loopTimer);
  }

  function renderLive() {
    const newest = newestFrame(frames);
    if (!newest) {
      imagery.clear();
      return;
    }
    const current = imagery.shownTime();
    if (current === null || current === newest.time || imagery.isReady(newest.time)) {
      swapTimer = clearTimer(swapTimer);
      imagery.show(newest.time);
      imagery.release([newest.time]);
      return;
    }
    imagery.preload([newest.time]);
    imagery.release([current, newest.time]);
    if (!swapTimer) {
      swapTimer = timers.setTimeout(() => {
        swapTimer = null;
        if (enabled && !playing) renderLive();
        notifyRows();
      }, SWAP_CHECK_MS);
    }
  }

  function tick() {
    loopTimer = null;
    if (!playing || !imagery) return;
    const readyFrames = frames.filter((frame) => imagery.isReady(frame.time));
    if (readyFrames.length === 0) {
      loopTimer = timers.setTimeout(tick, LOOP_FRAME_MS);
      notifyRows();
      return;
    }
    // Step by frame time, not index: frames turning ready mid-loop shift positions.
    const position = readyFrames.findIndex((frame) => frame.time === loopTime);
    const step = nextLoopStep(position, readyFrames.length);
    loopTime = readyFrames[step.index].time;
    imagery.show(loopTime);
    loopTimer = timers.setTimeout(tick, step.delayMs);
    notifyRows();
  }

  function startLoop() {
    if (!imagery || frames.length < 2) return;
    playing = true;
    loopTime = null;
    swapTimer = clearTimer(swapTimer);
    imagery.preload(frames.map((frame) => frame.time));
    loopTimer = timers.setTimeout(tick, LOOP_FRAME_MS);
    notifyRows();
  }

  function render() {
    if (!imagery) return;
    if (playing) {
      const times = frames.map((frame) => frame.time);
      imagery.release(times);
      imagery.preload(times);
    } else {
      renderLive();
    }
    notifyRows();
  }

  const layer = {
    id: 'weather-radar',
    name: 'Weather Radar',
    icon: '🌧️',
    source: 'RainViewer',
    updateInterval: REFRESH_MS,

    init(nextViewer) {
      viewer = nextViewer;
      imagery = createImagery(nextViewer);
      imagery.setAlpha(opacity);
      eventTarget?.addEventListener?.(MAP_STACK_EVENT, onMapStack);
    },

    attachMapStack(mapStack) {
      mapStackId = mapStack?.getActiveId?.() ?? mapStackId;
      notifyRows();
    },

    enable(nextViewer) {
      enabled = true;
      registerCredit(nextViewer, credits.rainviewer);
      if (usDetail) registerCredit(nextViewer, credits.iem);
      imagery?.setSource(currentSource());
    },

    disable() {
      enabled = false;
      stopLoop();
      swapTimer = clearTimer(swapTimer);
      request?.abort();
      request = null;
      frames = [];
      error = null;
      stale = false;
      imagery?.clear();
      notifyRows();
    },

    async update(_viewer, { signal } = {}) {
      if (!enabled || !imagery) return false;
      // The manager treats `false` as a failed refresh; skipping a hidden tab is not one.
      if (!isVisible() && frames.length) return true;
      const source = currentSource();
      request?.abort();
      const controller = new AbortController();
      request = controller;
      signal?.addEventListener?.('abort', () => controller.abort(), { once: true });
      try {
        const response = await fetchImpl(`/api/radar/frames?source=${source}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`radar frames HTTP ${response.status}`);
        const parsed = parseFramesPayload(await response.json());
        if (!parsed) throw new Error('malformed radar frames');
        // Superseded by a newer request or a source switch: not a failure.
        if (!enabled || source !== currentSource() || request !== controller) return true;
        // Two hours back from the newest frame, so upstream latency never drops the 13th.
        frames = pruneFrames(parsed.frames, newestFrame(parsed.frames)?.time ?? now());
        stale = parsed.stale;
        error = null;
        lastUpdate = now();
        imagery.setSource(source);
        render();
        return true;
      } catch (failure) {
        if (signal?.aborted) return false;
        if (controller.signal.aborted) return true;
        error = failure?.message || String(failure);
        notifyRows();
        // Reported through getStats(): an enabled row saying "unavailable" beats a failed enable.
        return true;
      } finally {
        if (request === controller) request = null;
      }
    },

    destroy() {
      layer.disable();
      eventTarget?.removeEventListener?.(MAP_STACK_EVENT, onMapStack);
      imagery?.destroy();
      imagery = null;
      viewer = null;
    },

    getStats() {
      const name = SOURCE_NAMES[currentSource()];
      const shown = imagery?.shownTime() ?? null;
      if (mapStackId === 'photoreal') {
        return { status: 'idle', source: name, statusMessage: 'Hidden by Google 3D map source', count: frames.length };
      }
      if (error && shown === null) {
        return { status: 'unavailable', source: name, error: 'Radar source unavailable' };
      }
      if ((error || stale) && shown !== null) {
        return {
          stale: true,
          source: `${name} · ${hhmm(shown)} UTC`,
          error: `Radar source unavailable — showing ${hhmm(shown)} UTC`,
          count: frames.length,
          lastUpdate,
        };
      }
      if (playing && imagery.readyCount() < frames.length) {
        return { loading: true, source: `${name} · Loading ${imagery.readyCount()}/${frames.length}` };
      }
      if (shown !== null) {
        const ageMinutes = Math.max(0, Math.floor((now() - shown) / 60_000));
        return { status: 'ok', source: `${name} · ${hhmm(shown)} UTC · ${ageMinutes} min old`, count: frames.length, lastUpdate };
      }
      return { status: 'ok', source: name, count: frames.length, lastUpdate };
    },

    getParams() {
      return { usDetail, opacity };
    },

    setParams(params = {}) {
      const next = {};
      if (Object.hasOwn(params, 'usDetail')) {
        if (typeof params.usDetail !== 'boolean') return false;
        next.usDetail = params.usDetail;
      }
      if (Object.hasOwn(params, 'opacity')) {
        const normalized = normalizeOpacity(params.opacity);
        if (normalized === null) return false;
        next.opacity = normalized;
      }
      if (Object.hasOwn(params, 'loop') && typeof params.loop !== 'boolean') return false;

      if (Object.hasOwn(next, 'opacity')) {
        opacity = next.opacity;
        imagery?.setAlpha(opacity);
      }
      if (Object.hasOwn(next, 'usDetail') && next.usDetail !== usDetail) {
        usDetail = next.usDetail;
        stopLoop();
        swapTimer = clearTimer(swapTimer);
        frames = [];
        error = null;
        stale = false;
        imagery?.setSource(currentSource());
        if (enabled && usDetail) registerCredit(viewer, credits.iem);
        if (enabled) void layer.update(viewer, {});
      }
      if (Object.hasOwn(params, 'loop')) {
        if (params.loop && !playing) startLoop();
        if (!params.loop && playing) {
          stopLoop();
          render();
        }
      }
      notifyRows();
      return true;
    },

    getRowControls() {
      return buildRowControls({ playing, usDetail, opacity, loopAvailable: frames.length >= 2 });
    },

    setRowControlsListener(listener) {
      rowListener = typeof listener === 'function' ? listener : null;
    },
  };

  return layer;
}
```

- [ ] **Step 5: Write the concrete instance**

```js
// src/data/weatherRadar.js
import { createWeatherRadarLayer as createLayer } from '../layers/weather-radar/index.js';
import { IEM_NEXRAD_CREDIT, RAINVIEWER_CREDIT, registerDynamicCredit } from './dataCredits.js';

export * from '../layers/weather-radar/index.js';

/** Wire real credits; everything else uses the layer's browser defaults. */
export function createWeatherRadarLayer(options = {}) {
  return createLayer({
    registerCredit: registerDynamicCredit,
    credits: { rainviewer: RAINVIEWER_CREDIT, iem: IEM_NEXRAD_CREDIT },
    ...options,
  });
}

export default createWeatherRadarLayer();
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test src/layers/weather-radar/index.test.mjs`
Expected: PASS, 9 tests.

- [ ] **Step 7: Commit**

```bash
git add src/layers/weather-radar/index.js src/layers/weather-radar/index.test.mjs src/data/weatherRadar.js src/data/dataCredits.js
git commit -m "feat(weather-radar): data layer with live refresh, loop and US detail"
```

---

### Task 8: Registration, package wiring, docs and CI parity

**Files:**
- Modify: `src/standalone/data.js`, `package.json` (`exports`), `scripts/package-boundaries.json`, `scripts/format-scope.json`, `DATA_SOURCES.md`, `CHANGELOG.md`

**Interfaces:**
- Consumes:
  - Task 7: the default export of `src/data/weatherRadar.js` (a layer with `attachMapStack({ getActiveId })`).
  - Task 3: `weatherRadarProxy()`, already registered in `server/providers/local.js`.
  - `createStandaloneData({ scene })`, where `scene` is the object returned by `src/standalone/scene.js`: `{ viewer, tileset, mapStackController }`.
- Produces: the layer in the production catalog (so `finalizeRegistrations(LAYER_STATE_REGISTRY)` finds the `weather-radar` entry from Task 4), and a green CI-parity run.

Out of scope (not in the spec): the voice/OpenAI tool layer enums in `server/providers/openai/tools.js` and `src/voice/gevActions.js`. No test requires them to list every registered layer.

- [ ] **Step 1: Register the layer**

In `src/standalone/data.js`, add the import directly after `import earthquakesLayer from '../data/earthquakes.js';`:

```js
import weatherRadarLayer from '../data/weatherRadar.js';
```

Change the destructuring `scene: { viewer },` to:

```js
  scene: { viewer, mapStackController },
```

Directly after `dataManager.register(earthquakesLayer);` add:

```js
  dataManager.register(weatherRadarLayer);
  weatherRadarLayer.attachMapStack(mapStackController);
```

- [ ] **Step 2: Declare the package exports**

In `package.json` `exports`, directly after `"./sources/traffic": "./src/data/tomtomTiles.js",` add:

```json
    "./server/providers/weather-radar": {
      "node": "./server/providers/weather-radar.js"
    },
```

and directly after `"./layers/traffic": "./src/layers/traffic/index.js",` add:

```json
    "./layers/weather-radar": "./src/layers/weather-radar/index.js",
```

- [ ] **Step 3: Add the boundary groups**

In `scripts/package-boundaries.json`, directly after the `"traffic-source"` group add:

```json
  "weather-radar-provider": {
    "runtime": "node",
    "exports": ["./server/providers/weather-radar"],
    "modules": [
      "server/providers/weather-radar.js",
      "server/providers/weather-radar/sources.js",
      "server/providers/common/rate-limit.js",
      "server/providers/common/http.js"
    ],
    "external": []
  },
```

and directly after the `"traffic-layer"` group add:

```json
  "weather-radar-layer": {
    "exports": ["./layers/weather-radar"],
    "modules": [
      "src/layers/weather-radar/controls.js",
      "src/layers/weather-radar/frames.js",
      "src/layers/weather-radar/imagery.js",
      "src/layers/weather-radar/index.js"
    ],
    "external": ["cesium"]
  },
```

The layer group deliberately excludes `src/data/weatherRadar.js`, as `earthquakes` excludes `src/data/earthquakes.js`. The export points at the layer module, which receives credits by injection.

- [ ] **Step 4: Run the boundary check**

Run: `npm run check:boundaries`
Expected: exit 0, with these lines among the output:
```
Checked weather-radar-provider: 1 exports, 4 owned modules.
Checked weather-radar-layer: 1 exports, 4 owned modules.
```
If it reports `imports an unowned module`, the named file is a real import. Add it to that group's `modules` only if it is a helper the group owns. Never add a path from another layer.

- [ ] **Step 5: Bring the new files into formatting scope and format them**

Append these entries to the end of the JSON array in `scripts/format-scope.json`, keeping it a list of unique paths:

```json
  "server/providers/weather-radar.js",
  "server/providers/weather-radar/sources.js",
  "src/data/weatherRadar.js",
  "src/data/weatherRadarProxy.test.mjs",
  "src/data/weatherRadarSources.test.mjs",
  "src/layers/weather-radar/controls.js",
  "src/layers/weather-radar/controls.test.mjs",
  "src/layers/weather-radar/frames.js",
  "src/layers/weather-radar/frames.test.mjs",
  "src/layers/weather-radar/imagery.js",
  "src/layers/weather-radar/imagery.test.mjs",
  "src/layers/weather-radar/index.js",
  "src/layers/weather-radar/index.test.mjs"
```

Run: `npm run format`, then `npm run format:check`
Expected: the check exits 0. The plan's code blocks use long lines, so `format` rewrites the new files to Prettier's 80-column style. That is expected; the rewrite is part of this commit.

- [ ] **Step 6: Document the sources**

In `DATA_SOURCES.md`, in the live-sources table, directly after the **Open-Meteo** row add:

```markdown
| **RainViewer** (weather-maps API) | Worldwide precipitation radar, last 2 hours, for the Weather Radar layer | Free for personal or educational use only (RainViewer API terms); tiles are proxied and cached through `/api/radar` | "Radar: RainViewer" linked to rainviewer.com, registered when the layer is first enabled |
| **Iowa Environmental Mesonet** (NEXRAD n0q WMS-T, `n0q-t.cgi`) | US-detail mode of the Weather Radar layer | Iowa State University IEM public service redistributing NWS NEXRAD (U.S. public domain); courtesy attribution | "US radar: Iowa Environmental Mesonet NEXRAD", registered when US detail is first turned on |
```

At the top of `CHANGELOG.md`, directly under `# Changelog` and its blank line, add:

```markdown
## Weather radar layer (fork)

- Add a Weather Radar layer: RainViewer precipitation worldwide with a two-hour loop, or
  Iowa State NEXRAD in US detail, served through a caching `/api/radar` proxy.
- Row controls for loop, US detail and 40/70/100% opacity. US detail and opacity travel in
  share links (layer token `p`); the loop state does not.
- The layer row reports the shown frame's time and age, a stale or unavailable source, and when
  the Google 3D map source hides the overlay.

```

- [ ] **Step 7: Run the full CI-parity sequence**

Run each in order, stopping at the first failure:

```bash
npm run format:check
npm run check:boundaries
npm test
npm run build
```

Expected: all four exit 0. `npm test` includes the new `*.test.mjs` files, because `scripts/run-unit-tests.mjs` discovers every `*.test.mjs`. It also includes `src/data/layerState.test.mjs` with the Task 4 count of 17.

- [ ] **Step 8: Smoke-check the proxy once against the live sources**

Keep this to the minimum. It makes one RainViewer manifest request and one IEM request. Start the dev server on a free port in the background: `npx vite --port 5199 --strictPort`. Do not open the app, so no AISStream connection is spent. Then run:

```bash
curl -s "http://localhost:5199/api/radar/frames?source=rainviewer"
curl -s "http://localhost:5199/api/radar/frames?source=iem"
```

Expected: each returns JSON with `"frames"` holding 13 entries and `"stale":false`. Stop the dev server afterwards.

- [ ] **Step 9: Commit**

```bash
git add src/standalone/data.js package.json scripts/package-boundaries.json scripts/format-scope.json DATA_SOURCES.md CHANGELOG.md server/providers/weather-radar.js server/providers/weather-radar src/data/weatherRadar.js src/data/weatherRadarProxy.test.mjs src/data/weatherRadarSources.test.mjs src/layers/weather-radar
git commit -m "feat(weather-radar): register the layer, package boundaries and docs"
```
