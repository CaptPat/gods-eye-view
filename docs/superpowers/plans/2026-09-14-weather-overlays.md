# Weather Overlays Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Weather Overlays" data layer in Cyclops View that shows one gridded weather field at a time: cloud cover (NOAA GMGSI satellite), 2 m temperature (NOAA GFS), Google Air Quality or Google Pollen. Tiles are served through a caching `/api/weather-overlays` proxy.

**Architecture:**
- **Proxy:** a Vite provider plugin (`server/providers/weather-overlays.js`, with pure helpers in `server/providers/weather-overlays/{sources,render}.js`). It answers per-mode manifests and 256 px Web Mercator PNG tiles. Cloud tiles come from nowCOAST WMS, temperature tiles are rendered from a GFS grid, and Google heatmap tiles are fetched with the server key. Tiles sit in an age-pruned memory cache behind two rate limiters.
- **Layer:** `src/layers/weather-overlays/` draws the current mode as Cesium imagery directly above the base map. It reuses a frame-imagery helper extracted from the radar layer (`src/layers/weather-imagery/`).

**Tech Stack:** Node ≥ 24.14 / Vite provider plugins, `node:zlib`, CesiumJS 1.138 (`UrlTemplateImageryProvider`, `ImageryLayer` `colorToAlpha`, `Credit`), `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-14-weather-overlays-design.md`

## Global Constraints

- Fork-only work on `CaptPat/gods-eye-view`. Never open upstream PRs or issues. `gh pr create` defaults to the parent repository, so do not use it.
- Every commit message ends with exactly `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`, whatever model implements.
- Layer id `weather-overlays`, name `Weather Overlays`, icon `🌡️`, `updateInterval` 600000. Layer-state token `o` (pre-assigned). Option tokens: `m` mode (`clouds` `c`, `temperature` `t`, `air-quality` `a`, `pollen` `p`), `p` pollenType (`tree` `t`, `grass` `g`, `weed` `w`), `o` opacity (`40`, `70`, `100`). Defaults: `clouds`, `tree`, 0.7.
- Sources (never substitute):
  - Clouds: `https://nowcoast.noaa.gov/geoserver/satellite/ows`, layer `global_longwave_imagery_mosaic`, WMS 1.3.0, `crs=EPSG:3857`. Only times listed in its capabilities (an unlisted time returns a blank 200 tile).
  - Temperature: `https://pae-paha.pacioos.hawaii.edu/erddap/griddap/ncep_global.csvp`, `tmp2m` (K) at the 3-hour step nearest now, stride 2 (a 1° grid). NOAA CoastWatch's `NCEP_Global_Best` only redirects here. ERDDAP rejects `(now)`.
  - Air quality: `https://airquality.googleapis.com/v1/mapTypes/US_AQI/heatmapTiles/{z}/{x}/{y}?key=…`. Pollen: `https://pollen.googleapis.com/v1/mapTypes/{TREE_UPI|GRASS_UPI|WEED_UPI}/heatmapTiles/{z}/{x}/{y}?key=…`. The key comes from `googleServerApiKey()` only.
  - Open-Meteo is not used: multi-location requests are weighted per location and would exceed the 10,000 calls/day free tier.
- Zoom caps (Cesium `maximumLevel` and proxy validation): clouds 7, temperature 6, air quality 12, pollen 10.
- Proxy: manifest limiter 600/min per client and 2,000 global; a **separate** tile limiter of 6,000/min per client and 20,000 global (Cesium never retries a 429 tile). In-memory tile cache only, never disk: Google not cached (policy; `Cache-Control: no-store`), clouds 3 h, temperature 1 h, 1,500 entries, age prune at most once per minute. GMGSI capabilities 10 min; GFS grid 1 h. Upstream timeout 15 s (grid 30 s), tile cap 2 MB with PNG signature check.
- **The Google key is secret.** Never print it, log it, put it in a fixture, commit it or write it into a URL you record. Proxy logs carry a label and an error name only, never an upstream URL.
- Render governor (`src/renderGovernor.js`): the app idles in `requestRenderMode`. Every scene change not driven by a manager call (a delayed swap, async manifest result, alpha change, imagery add or clear) calls `requestRender('weather-overlays')`. It is injected from `src/data/weatherOverlays.js` as `governorRequestRender`, so `src/layers/*` stays Cesium-only.
- Manager contract: `update()` resolves `false` only when the manager's own signal aborted. Skips, superseded requests and handled failures resolve `true`, and failures surface through `getStats().error`.
- Status strings are checked against `layerPanel._buildMetaText`, not just `getStats()`. A `loading: true` needs a `loadingLabel`, an `error` prefixes STALE/UNAVAILABLE, and `lastUpdate` appends `· just now` / `· Nm ago`. Exact rows:
  - `NOAA GMGSI satellite · 15:00 UTC · 80 min old · just now`
  - `NOAA GFS model · valid 15:00 UTC · just now`
  - `NOAA GMGSI satellite · Loading`
  - `UNAVAILABLE · Google Air Quality · Google Maps API key not configured`
  - `UNAVAILABLE · NOAA GMGSI satellite · Overlay source unavailable`
  - `STALE · NOAA GMGSI satellite · 15:00 UTC · Overlay source unavailable — showing 15:00 UTC`
  - `NOAA GMGSI satellite · Hidden by Google 3D map source`
- Credits (HTML exactly):
  - `Clouds: <a href="https://nowcoast.noaa.gov/" target="_blank" rel="noopener">NOAA nowCOAST</a> GMGSI geostationary satellite mosaic`
  - `Temperature: NOAA NCEP GFS via <a href="https://pae-paha.pacioos.hawaii.edu/erddap/griddap/ncep_global.html" target="_blank" rel="noopener">PacIOOS ERDDAP</a>`
  - `Air quality overlay: Source: Includes air quality data from Google`
  - `Pollen overlay: Source: Includes pollen data from Google`
  - On-screen Google provider credits: `Source: Includes air quality data from Google`, `Source: Includes pollen data from Google`.
- No new right-rail panel, CSS or keyboard handler. Chips use the existing wrapping `.data-toggle-controls` row, which must stay usable at 400 px width. Weather Overlays adds no key listener; if one is ever added, Escape, Enter and Space must `stopPropagation()` (tracking layers clear on bubbling Escape).
- Shared files are edited by every weather sub-project (3 → 4 → 5): `src/data/layerState.js` and its test, `scripts/format-scope.json`, `scripts/package-boundaries.json`, `server/providers/local.js` (`keySetupEndpoint()` stays last), `src/app/data.js`, `src/data/dataCredits.js`, `DATA_SOURCES.md`, `CHANGELOG.md`, `package.json` exports. Edit them only as insertions at the named anchors. The registry count assertion is raised **by 1 from its current value**, never set to a remembered literal.
- `src/app/*` is in the `application-components` boundary group, which must list every module `src/app/*` transitively imports.
- Tests: colocated `*.test.mjs`, `node:test` + `node:assert/strict`, no live network. Fixtures in `src/data/fixtures/weather-overlays/` are already committed with this plan; do not re-record them.
- CI parity before the final commit: `npm run format:check`, `npm run check:boundaries`, `npm test`, `npm run build`. The code blocks below are already Prettier-formatted.

## File Structure

| File | Responsibility |
|---|---|
| `src/layers/weather-imagery/frameImagery.js` | Shared: per-time Cesium imagery layers, readiness, `swapToFrame`, insert index |
| `src/layers/weather-imagery/opacity.js` | Shared: the 40/70/100% steps |
| `src/layers/weather-radar/{imagery,controls,index}.js` | Radar now imports the shared helpers (no behaviour change) |
| `src/layers/weather-overlays/modes.js` | Modes, pollen types, proxy keys, names, zoom caps (shared with the server) |
| `src/layers/weather-overlays/palette.js` | Temperature ramp and legend colours (shared with the server) |
| `server/providers/weather-overlays/sources.js` | Pure proxy helpers: validation, upstream URLs, GMGSI times, GFS grid parser |
| `server/providers/weather-overlays/render.js` | PNG encoder, bilinear sampling, temperature tile renderer |
| `server/providers/weather-overlays.js` | Routes, tile cache, limiters, plugin |
| `src/layers/weather-overlays/controls.js` | Row chips and legends |
| `src/layers/weather-overlays/imagery.js` | Providers, cloud colour-to-alpha, Google on-screen credit, index-1 insertion |
| `src/layers/weather-overlays/index.js` | Layer lifecycle, manifests, swaps, params, stats, map-stack note |
| `src/data/weatherOverlays.js` | Real credits, render governor, default instance |
| `src/data/layerState.js`, `src/data/dataCredits.js`, `server/providers/local.js`, `src/app/data.js` | Registry and options, credits, plugin and layer registration |
| `package.json`, `scripts/package-boundaries.json`, `scripts/format-scope.json`, `DATA_SOURCES.md`, `CHANGELOG.md` | Exports, boundaries, formatting scope, docs |

---

### Task 1: Shared frame imagery helpers (radar refactor)

**Files:**
- Create: `src/layers/weather-imagery/frameImagery.js`, `src/layers/weather-imagery/opacity.js`
- Modify: `src/layers/weather-radar/imagery.js`, `src/layers/weather-radar/controls.js`, `src/layers/weather-radar/index.js`, `scripts/package-boundaries.json`, `scripts/format-scope.json`
- Test: `src/layers/weather-imagery/frameImagery.test.mjs`; the existing `src/layers/weather-radar/*.test.mjs` must pass unchanged

**Interfaces:**
- Produces:
  - `PRELOAD_ALPHA = 0.001`
  - `createFrameImagery(viewer, { createProvider, createLayer?, insertIndex? })` → `{ setSource, preload, show, setAlpha, release, isReady, readyCount, shownTime, clear, destroy }`
    - `createProvider(source, time)` is required;
    - `createLayer(provider, source)` receives the source;
    - `insertIndex` (integer) adds layers at `min(insertIndex, imageryLayers.length)`.
  - `swapToFrame(imagery, time) → boolean`: shows at once if nothing is shown, if `time` is already shown, or if it is ready; otherwise preloads `time`, keeps only the shown frame and `time`, and returns `false`.
  - `IMAGERY_OPACITIES = [0.4, 0.7, 1]`, `normalizeImageryOpacity(value) → 0.4 | 0.7 | 1 | null`
  - Radar keeps its exports: `PRELOAD_ALPHA` and `createRadarImagery` from `imagery.js`; `RADAR_OPACITIES` and `normalizeOpacity` from `controls.js`.

- [ ] **Step 1: Write the failing test**

`src/layers/weather-imagery/frameImagery.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRELOAD_ALPHA,
  createFrameImagery,
  swapToFrame,
} from './frameImagery.js';
import { IMAGERY_OPACITIES, normalizeImageryOpacity } from './opacity.js';

function fakeViewer(initial = [{ base: true }]) {
  const listeners = new Set();
  const layers = [...initial];
  return {
    layers,
    progress: (queued) => {
      for (const listener of [...listeners]) listener(queued);
    },
    listenerCount: () => listeners.size,
    imageryLayers: {
      get length() {
        return layers.length;
      },
      add(layer, index) {
        if (index === undefined) layers.push(layer);
        else layers.splice(index, 0, layer);
        return layer;
      },
      remove(layer) {
        const index = layers.indexOf(layer);
        if (index >= 0) layers.splice(index, 1);
        return index >= 0;
      },
    },
    scene: {
      globe: {
        tileLoadProgressEvent: {
          addEventListener(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
        },
      },
    },
  };
}

const factories = () => ({
  createProvider: (source, time) => ({ source, time }),
  createLayer: (provider, source) => ({
    provider,
    source,
    alpha: 1,
    show: true,
  }),
});

const frameLayers = (viewer) => viewer.layers.filter((layer) => layer.provider);

test('opacity snaps only to the three offered steps', () => {
  assert.deepEqual(IMAGERY_OPACITIES, [0.4, 0.7, 1]);
  assert.equal(normalizeImageryOpacity(0.4), 0.4);
  assert.equal(normalizeImageryOpacity('0.7'), 0.7);
  assert.equal(normalizeImageryOpacity(1.0004), 1);
  assert.equal(normalizeImageryOpacity(0.5), null);
  assert.equal(normalizeImageryOpacity('x'), null);
});

test('a provider factory is required, and createLayer receives the source', () => {
  assert.throws(() => createFrameImagery(fakeViewer()), /createProvider/);
  const viewer = fakeViewer();
  const imagery = createFrameImagery(viewer, factories());
  imagery.setSource('clouds');
  imagery.show(1000);
  assert.deepEqual(
    frameLayers(viewer).map((layer) => [layer.source, layer.provider.time]),
    [['clouds', 1000]],
  );
});

test('insertIndex places frames directly above the base map and clamps to the collection', () => {
  const viewer = fakeViewer([{ base: true }, { radar: true }]);
  const imagery = createFrameImagery(viewer, {
    ...factories(),
    insertIndex: 1,
  });
  imagery.setSource('clouds');
  imagery.show(1000);
  assert.deepEqual(
    viewer.layers.map((layer) =>
      layer.base ? 'base' : layer.radar ? 'radar' : layer.source,
    ),
    ['base', 'clouds', 'radar'],
  );

  const empty = fakeViewer([]);
  const clamped = createFrameImagery(empty, { ...factories(), insertIndex: 1 });
  clamped.setSource('clouds');
  clamped.show(1000);
  assert.equal(
    empty.layers.length,
    1,
    'an empty collection takes the layer at index 0',
  );
});

test('swapToFrame shows at once when nothing is shown, and otherwise waits for readiness', () => {
  const viewer = fakeViewer();
  const imagery = createFrameImagery(viewer, factories());
  imagery.setSource('clouds');
  imagery.setAlpha(0.7);
  assert.equal(swapToFrame(imagery, 1000), true);
  assert.equal(imagery.shownTime(), 1000);

  assert.equal(
    swapToFrame(imagery, 2000),
    false,
    'the new frame is not ready yet',
  );
  assert.equal(imagery.shownTime(), 1000);
  assert.deepEqual(
    frameLayers(viewer).map((layer) => [layer.provider.time, layer.alpha]),
    [
      [1000, 0.7],
      [2000, PRELOAD_ALPHA],
    ],
  );

  viewer.progress(0);
  assert.equal(swapToFrame(imagery, 2000), true);
  assert.equal(imagery.shownTime(), 2000);
  assert.deepEqual(
    frameLayers(viewer).map((layer) => layer.provider.time),
    [2000],
  );
  assert.equal(
    swapToFrame(imagery, 2000),
    true,
    'the shown frame counts as shown',
  );

  imagery.destroy();
  assert.equal(viewer.listenerCount(), 0);
  assert.deepEqual(viewer.layers, [{ base: true }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/layers/weather-imagery/frameImagery.test.mjs`
Expected: FAIL with `Cannot find module` for `./frameImagery.js`.

- [ ] **Step 3: Write the helpers**

`src/layers/weather-imagery/opacity.js`:

```js
/** The three opacity steps every weather imagery layer offers. */
export const IMAGERY_OPACITIES = Object.freeze([0.4, 0.7, 1]);

/** Snap to an offered opacity step, or null when the value is not one. */
export function normalizeImageryOpacity(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return (
    IMAGERY_OPACITIES.find((option) => Math.abs(option - numeric) < 0.001) ??
    null
  );
}
```

`src/layers/weather-imagery/frameImagery.js`:

```js
import * as Cesium from 'cesium';

/** Loaded but effectively invisible: Cesium still requests tiles for it. */
export const PRELOAD_ALPHA = 0.001;

/**
 * Show `time` at once when nothing is shown, it is already shown, or its tiles
 * are ready. Otherwise preload it beside the shown frame and keep showing that.
 * @returns {boolean} Whether `time` is now the shown frame.
 */
export function swapToFrame(imagery, time) {
  const current = imagery.shownTime();
  if (current === null || current === time || imagery.isReady(time)) {
    imagery.show(time);
    imagery.release([time]);
    return true;
  }
  imagery.preload([time]);
  imagery.release([current, time]);
  return false;
}

/**
 * One Cesium imagery layer per frame time for the current source. A frame is
 * ready once the globe's tile queue first reports 0 after its layer was added.
 * `insertIndex` places new layers at that index (clamped to the collection)
 * instead of on top.
 */
export function createFrameImagery(
  viewer,
  {
    createProvider,
    createLayer = (provider) => new Cesium.ImageryLayer(provider),
    insertIndex = null,
  } = {},
) {
  if (typeof createProvider !== 'function') {
    throw new TypeError('createFrameImagery requires createProvider');
  }
  const layers = new Map();
  const pending = new Set();
  const ready = new Set();
  let source = null;
  let shown = null;
  let alpha = 0.7;

  const removeProgressListener =
    viewer.scene.globe.tileLoadProgressEvent.addEventListener((queued) => {
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
    const layer = createLayer(createProvider(source, time), source);
    layer.alpha = PRELOAD_ALPHA;
    layer.show = true;
    if (Number.isInteger(insertIndex)) {
      viewer.imageryLayers.add(
        layer,
        Math.min(insertIndex, viewer.imageryLayers.length),
      );
    } else {
      viewer.imageryLayers.add(layer);
    }
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
      if (shown !== null && shown !== time && layers.has(shown))
        layers.get(shown).alpha = PRELOAD_ALPHA;
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
    readyCount: () =>
      [...layers.keys()].filter((time) => ready.has(time)).length,
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

- [ ] **Step 4: Point the radar at the helpers**

In `src/layers/weather-radar/imagery.js`, replace

```js
import * as Cesium from 'cesium';

/** Loaded but effectively invisible: Cesium still requests tiles for it. */
export const PRELOAD_ALPHA = 0.001;
```

with

```js
import * as Cesium from 'cesium';
import {
  PRELOAD_ALPHA,
  createFrameImagery,
} from '../weather-imagery/frameImagery.js';

export { PRELOAD_ALPHA };
```

Then replace the whole `export function createRadarImagery(…) { … }` function (from `export function createRadarImagery(` to the end of the file) with:

```js
/** Radar keeps its own providers; frame bookkeeping is shared with Weather Overlays. */
export function createRadarImagery(viewer, options = {}) {
  return createFrameImagery(viewer, { createProvider, ...options });
}
```

In `src/layers/weather-radar/controls.js`, replace the first line `export const RADAR_OPACITIES = Object.freeze([0.4, 0.7, 1]);` with:

```js
import {
  IMAGERY_OPACITIES,
  normalizeImageryOpacity,
} from '../weather-imagery/opacity.js';

export const RADAR_OPACITIES = IMAGERY_OPACITIES;
export const normalizeOpacity = normalizeImageryOpacity;
```

and delete the old `export function normalizeOpacity(value) { … }` function (8 lines, plus its following blank line).

In `src/layers/weather-radar/index.js`, directly after `import { createRadarImagery } from './imagery.js';` add:

```js
import { swapToFrame } from '../weather-imagery/frameImagery.js';
```

and inside `renderLive()` replace

```js
    const current = imagery.shownTime();
    if (
      current === null ||
      current === newest.time ||
      imagery.isReady(newest.time)
    ) {
      swapTimer = clearTimer(swapTimer);
      imagery.show(newest.time);
      imagery.release([newest.time]);
      return;
    }
    imagery.preload([newest.time]);
    imagery.release([current, newest.time]);
```

with

```js
    if (swapToFrame(imagery, newest.time)) {
      swapTimer = clearTimer(swapTimer);
      return;
    }
```

- [ ] **Step 5: Keep boundaries and formatting in step**

In `scripts/package-boundaries.json`, in the `"weather-radar-layer"` group, directly after `"modules": [` add:

```json
      "src/layers/weather-imagery/frameImagery.js",
      "src/layers/weather-imagery/opacity.js",
```

In the `"application-components"` group, directly before its `"src/layers/weather-radar/controls.js",` line add the same two lines.

In `scripts/format-scope.json`, directly after `  "src/ui/styles/weather-report.css",` add:

```json
  "src/layers/weather-imagery/frameImagery.js",
  "src/layers/weather-imagery/frameImagery.test.mjs",
  "src/layers/weather-imagery/opacity.js",
```

- [ ] **Step 6: Run the tests**

Run: `node --test src/layers/weather-imagery/frameImagery.test.mjs src/layers/weather-radar/controls.test.mjs src/layers/weather-radar/frames.test.mjs src/layers/weather-radar/imagery.test.mjs src/layers/weather-radar/index.test.mjs && npm run check:boundaries`
Expected: PASS: 4 new tests plus 3, 4, 5 and 11 radar tests. The boundary check exits 0 with `Checked weather-radar-layer: 1 exports, 6 owned modules.`

- [ ] **Step 7: Commit**

```bash
git add src/layers/weather-imagery src/layers/weather-radar/imagery.js src/layers/weather-radar/controls.js src/layers/weather-radar/index.js scripts/package-boundaries.json scripts/format-scope.json
git commit -m "refactor(weather-radar): extract shared frame imagery helpers

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Overlay modes, palette and proxy source helpers

**Files:**
- Create: `src/layers/weather-overlays/modes.js`, `src/layers/weather-overlays/palette.js`, `server/providers/weather-overlays/sources.js`
- Test: `src/data/weatherOverlaysSources.test.mjs` (fixtures `gmgsi-capabilities.xml`, `gfs-tmp2m-30deg.csv`, already present)

**Interfaces:**
- Produces (`modes.js`, pure, shared with the server):
  - `MODES`, `POLLEN_TYPES`, `DEFAULT_MODE = 'clouds'`, `DEFAULT_POLLEN_TYPE = 'tree'`, `DEFAULT_OPACITY = 0.7`
  - `MODE_INFO[mode] = { label, title, name, short, google, maximumLevel }`, `POLLEN_LABELS`
  - `OVERLAY_KEYS = ['clouds', 'temperature', 'air-quality', 'pollen-tree', 'pollen-grass', 'pollen-weed']`
  - `normalizeMode`, `normalizePollenType`, `overlayKey(mode, pollenType)`, `modeOfKey(key)`, `maximumLevelFor(key) → number | null`, `sourceName(mode, pollenType)`
- Produces (`palette.js`, pure):
  - `TEMPERATURE_STOPS: [{ celsius, color }]`, `temperatureRgb(celsius) → [r, g, b] | null`, `celsiusToFahrenheit`
  - `AIR_QUALITY_LEGEND: [{ label, range, color }]`, `POLLEN_LEGEND: [{ label, index, color }]`, `CLOUD_LEGEND: [{ label, detail, color }]`
- Produces (`sources.js`):
  - `HOUR_MS`, `GFS_STEP_MS`, `GFS_WINDOW_MS`, `GOOGLE_WINDOW_MS`, `GMGSI_WMS_URL`, `GMGSI_LAYER`, `GFS_GRIDDAP_URL`, `OVERLAY_KEYS`
  - `isOverlayKey`, `isGoogleKey`, `parseTileCoords(key, z, x, y) → { z, x, y } | null`, `mercatorBounds({ z, x, y }) → { west, south, east, north }` (metres)
  - `googleTileUrl(key, coords, apiKey)`, `gmgsiCapabilitiesUrl()`, `parseGmgsiTimes(xml) → number[]`, `gmgsiTileUrl(timeMs, coords)`
  - `gfsValidTime(nowMs)`, `isGfsTime(timeMs, nowMs)`, `gfsGridUrl(timeMs)`, `googleTimeBucket(nowMs)`, `isGoogleTime(timeMs, nowMs)`
  - `parseGfsCsv(text) → { time, lat0, latStep, latCount, lon0, lonStep, lonCount, kelvin: Float32Array } | null` (row = latitude index south to north, column = longitude index)

- [ ] **Step 1: Write the failing test**

`src/data/weatherOverlaysSources.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GFS_GRIDDAP_URL,
  GMGSI_WMS_URL,
  OVERLAY_KEYS,
  gfsGridUrl,
  gfsValidTime,
  gmgsiTileUrl,
  googleTileUrl,
  googleTimeBucket,
  isGfsTime,
  isGoogleKey,
  isGoogleTime,
  isOverlayKey,
  mercatorBounds,
  parseGfsCsv,
  parseGmgsiTimes,
  parseTileCoords,
} from '../../server/providers/weather-overlays/sources.js';

const fixture = (name) =>
  readFileSync(
    new URL(`./fixtures/weather-overlays/${name}`, import.meta.url),
    'utf8',
  );
const hour = (h, day = 14) => Date.UTC(2026, 8, day, h);
const NOW = Date.UTC(2026, 8, 14, 16, 20);
const HALF = 20037508.342789244;

test('overlay keys and tile coordinates follow each mode zoom cap', () => {
  assert.deepEqual(OVERLAY_KEYS, [
    'clouds',
    'temperature',
    'air-quality',
    'pollen-tree',
    'pollen-grass',
    'pollen-weed',
  ]);
  assert.equal(isOverlayKey('pollen'), false, 'pollen is served per type');
  assert.equal(isGoogleKey('pollen-weed'), true);
  assert.equal(isGoogleKey('clouds'), false);
  assert.deepEqual(parseTileCoords('clouds', '7', '127', '0'), {
    z: 7,
    x: 127,
    y: 0,
  });
  assert.deepEqual(parseTileCoords('air-quality', '12', '0', '0'), {
    z: 12,
    x: 0,
    y: 0,
  });
  for (const [key, z] of [
    ['clouds', '8'],
    ['temperature', '7'],
    ['air-quality', '13'],
    ['pollen-grass', '11'],
  ]) {
    assert.equal(parseTileCoords(key, z, '0', '0'), null, `${key} z${z}`);
  }
  for (const bad of [
    ['4', '16', '0'],
    ['4', '0', '-1'],
    ['1.5', '0', '0'],
    ['a', '0', '0'],
  ]) {
    assert.equal(parseTileCoords('clouds', ...bad), null, bad.join('/'));
  }
  assert.equal(parseTileCoords('nope', '0', '0', '0'), null);
});

test('Web Mercator bounds and the upstream URLs', () => {
  const east = mercatorBounds({ z: 1, x: 1, y: 0 });
  assert.equal(east.west, 0);
  assert.equal(east.south, 0);
  assert.ok(Math.abs(east.east - HALF) < 1e-6);
  assert.ok(Math.abs(east.north - HALF) < 1e-6);

  assert.equal(
    googleTileUrl('pollen-grass', { z: 3, x: 1, y: 2 }, 'K E Y'),
    'https://pollen.googleapis.com/v1/mapTypes/GRASS_UPI/heatmapTiles/3/1/2?key=K%20E%20Y',
  );
  assert.equal(
    googleTileUrl('air-quality', { z: 0, x: 0, y: 0 }, 'k'),
    'https://airquality.googleapis.com/v1/mapTypes/US_AQI/heatmapTiles/0/0/0?key=k',
  );

  const wms = new URL(gmgsiTileUrl(hour(15), { z: 9, x: 121, y: 212 }));
  assert.equal(wms.origin + wms.pathname, GMGSI_WMS_URL);
  assert.equal(
    wms.searchParams.get('layers'),
    'global_longwave_imagery_mosaic',
  );
  assert.equal(wms.searchParams.get('crs'), 'EPSG:3857');
  assert.equal(wms.searchParams.get('version'), '1.3.0');
  assert.equal(wms.searchParams.get('time'), '2026-09-14T15:00:00Z');
  const bbox = wms.searchParams.get('bbox').split(',').map(Number);
  assert.deepEqual(
    bbox.map((value) => Math.round(value)),
    [-10566655, 3365675, -10488383, 3443947],
  );

  assert.equal(
    gfsGridUrl(hour(15)),
    `${GFS_GRIDDAP_URL}?tmp2m%5B(2026-09-14T15:00:00Z)%5D%5B(-90):2:(90)%5D%5B(0):2:(359.5)%5D`,
  );
});

test('GMGSI times parse from the recorded capabilities, including ISO ranges', () => {
  assert.deepEqual(
    parseGmgsiTimes(fixture('gmgsi-capabilities.xml')),
    [10, 11, 12, 13, 14, 15].map((h) => hour(h)),
  );
  const ranged =
    '<Layer><Name>global_longwave_imagery_mosaic</Name>' +
    '<Dimension name="time" units="ISO8601">2026-09-14T13:00:00.000Z/2026-09-14T15:00:00.000Z/PT1H</Dimension></Layer>';
  assert.deepEqual(
    parseGmgsiTimes(ranged),
    [13, 14, 15].map((h) => hour(h)),
  );
  assert.deepEqual(parseGmgsiTimes('<Layer><Name>other</Name></Layer>'), []);
  assert.deepEqual(parseGmgsiTimes(null), []);
});

test('GFS steps and Google hour buckets are accepted only near now', () => {
  assert.equal(gfsValidTime(NOW), hour(15));
  assert.equal(gfsValidTime(Date.UTC(2026, 8, 14, 16, 31)), hour(18));
  assert.equal(isGfsTime(hour(21), NOW), true);
  assert.equal(isGfsTime(hour(14), NOW), false, 'not a 3-hour step');
  assert.equal(isGfsTime(hour(0, 15), NOW), false, 'more than 6 hours ahead');
  assert.equal(isGfsTime(Number.NaN, NOW), false);

  assert.equal(googleTimeBucket(NOW), hour(16));
  assert.equal(isGoogleTime(hour(14), NOW), true);
  assert.equal(isGoogleTime(hour(17), NOW), true);
  assert.equal(isGoogleTime(hour(13), NOW), false, 'more than 3 hours back');
  assert.equal(isGoogleTime(hour(18), NOW), false, 'more than 1 hour ahead');
  assert.equal(isGoogleTime(Date.UTC(2026, 8, 14, 16, 30), NOW), false);
});

test('the recorded GFS grid parses into a regular south-to-north grid in kelvin', () => {
  const grid = parseGfsCsv(fixture('gfs-tmp2m-30deg.csv'));
  assert.equal(grid.time, hour(15));
  assert.deepEqual(
    [
      grid.lat0,
      grid.latStep,
      grid.latCount,
      grid.lon0,
      grid.lonStep,
      grid.lonCount,
    ],
    [-90, 30, 7, 0, 30, 12],
  );
  assert.equal(grid.kelvin.length, 84);
  assert.ok(Math.abs(grid.kelvin[3 * 12] - 297.2) < 0.01, 'equator at 0°E');
  assert.ok(Math.abs(grid.kelvin[0] - 215.6) < 0.01, 'south pole');

  assert.equal(parseGfsCsv('not a grid'), null);
  const lines = fixture('gfs-tmp2m-30deg.csv').trim().split('\n');
  assert.equal(
    parseGfsCsv(lines.slice(0, -1).join('\n')),
    null,
    'a missing row',
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/data/weatherOverlaysSources.test.mjs`
Expected: FAIL with `Cannot find module` for `sources.js`.

- [ ] **Step 3: Write the shared modules**

`src/layers/weather-overlays/modes.js`:

```js
/**
 * Overlay modes and the keys the proxy serves them under. Pure: shared by the
 * browser layer and `server/providers/weather-overlays/sources.js`.
 */
export const MODES = Object.freeze([
  'clouds',
  'temperature',
  'air-quality',
  'pollen',
]);
export const POLLEN_TYPES = Object.freeze(['tree', 'grass', 'weed']);
export const DEFAULT_MODE = 'clouds';
export const DEFAULT_POLLEN_TYPE = 'tree';
export const DEFAULT_OPACITY = 0.7;

export const MODE_INFO = Object.freeze({
  clouds: Object.freeze({
    label: 'Clouds',
    title: 'Cloud cover from geostationary satellites',
    name: 'NOAA GMGSI satellite',
    short: 'CLOUDS',
    google: false,
    maximumLevel: 7,
  }),
  temperature: Object.freeze({
    label: 'Temp',
    title: 'Air temperature at 2 m',
    name: 'NOAA GFS model',
    short: 'TEMP',
    google: false,
    maximumLevel: 6,
  }),
  'air-quality': Object.freeze({
    label: 'Air',
    title: 'Air quality (US AQI)',
    name: 'Google Air Quality',
    short: 'AQI',
    google: true,
    maximumLevel: 12,
  }),
  pollen: Object.freeze({
    label: 'Pollen',
    title: 'Universal Pollen Index',
    name: 'Google Pollen',
    short: 'POLLEN',
    google: true,
    maximumLevel: 10,
  }),
});

export const POLLEN_LABELS = Object.freeze({
  tree: 'Tree',
  grass: 'Grass',
  weed: 'Weed',
});

/** Every key the proxy serves: one per mode, with pollen split by type. */
export const OVERLAY_KEYS = Object.freeze([
  'clouds',
  'temperature',
  'air-quality',
  ...POLLEN_TYPES.map((type) => `pollen-${type}`),
]);

export function normalizeMode(value) {
  return MODES.includes(value) ? value : null;
}

export function normalizePollenType(value) {
  return POLLEN_TYPES.includes(value) ? value : null;
}

export function overlayKey(mode, pollenType) {
  return mode === 'pollen' ? `pollen-${pollenType}` : mode;
}

export function modeOfKey(key) {
  return String(key).startsWith('pollen-') ? 'pollen' : key;
}

export function maximumLevelFor(key) {
  return MODE_INFO[modeOfKey(key)]?.maximumLevel ?? null;
}

/** The source name the Layers row shows, e.g. `Google Pollen · Grass`. */
export function sourceName(mode, pollenType) {
  const name = MODE_INFO[mode].name;
  return mode === 'pollen' ? `${name} · ${POLLEN_LABELS[pollenType]}` : name;
}
```

`src/layers/weather-overlays/palette.js`:

```js
/**
 * Colours shared by the server's temperature tile renderer and the Layers-panel
 * legends. Pure data and arithmetic: no Cesium, no DOM, no Node built-ins.
 */

/** Temperature ramp at 2 m, °C to sRGB. Values outside the ends clamp. */
export const TEMPERATURE_STOPS = Object.freeze([
  Object.freeze({ celsius: -30, color: '#5e3c99' }),
  Object.freeze({ celsius: -15, color: '#3b6fd8' }),
  Object.freeze({ celsius: 0, color: '#9fd8f0' }),
  Object.freeze({ celsius: 10, color: '#fff3a0' }),
  Object.freeze({ celsius: 20, color: '#ffb050' }),
  Object.freeze({ celsius: 30, color: '#f05a28' }),
  Object.freeze({ celsius: 40, color: '#a50f15' }),
]);

/** US AQI categories; the colours Google's US_AQI heatmap tiles use (measured). */
export const AIR_QUALITY_LEGEND = Object.freeze([
  Object.freeze({ label: 'Good', range: '0-50', color: '#00e400' }),
  Object.freeze({ label: 'Moderate', range: '51-100', color: '#ffff00' }),
  Object.freeze({ label: 'Sensitive', range: '101-150', color: '#ff7e00' }),
  Object.freeze({ label: 'Unhealthy', range: '151-200', color: '#ff0000' }),
  Object.freeze({
    label: 'Very unhealthy',
    range: '201-300',
    color: '#8f3f97',
  }),
  Object.freeze({ label: 'Hazardous', range: '301+', color: '#7e0023' }),
]);

/** Universal Pollen Index 1-5; colours sampled from Google's UPI heatmap tiles. */
export const POLLEN_LEGEND = Object.freeze([
  Object.freeze({ label: 'Very low', index: 1, color: '#009e3a' }),
  Object.freeze({ label: 'Low', index: 2, color: '#84cf33' }),
  Object.freeze({ label: 'Moderate', index: 3, color: '#ffff00' }),
  Object.freeze({ label: 'High', index: 4, color: '#ff8c00' }),
  Object.freeze({ label: 'Very high', index: 5, color: '#ff0000' }),
]);

/** Longwave infrared: brighter means colder, higher cloud tops. */
export const CLOUD_LEGEND = Object.freeze([
  Object.freeze({ label: 'Low', detail: 'warm tops', color: '#8c8c8c' }),
  Object.freeze({ label: 'Mid', detail: 'cool tops', color: '#c8c8c8' }),
  Object.freeze({ label: 'High', detail: 'cold tops', color: '#ffffff' }),
]);

export function celsiusToFahrenheit(celsius) {
  return Math.round((celsius * 9) / 5 + 32);
}

function hexToRgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

const STOP_RGB = TEMPERATURE_STOPS.map((stop) => hexToRgb(stop.color));

/** Linear interpolation along the ramp; null for a missing value. */
export function temperatureRgb(celsius) {
  if (!Number.isFinite(celsius)) return null;
  const last = TEMPERATURE_STOPS.length - 1;
  if (celsius <= TEMPERATURE_STOPS[0].celsius) return [...STOP_RGB[0]];
  if (celsius >= TEMPERATURE_STOPS[last].celsius) return [...STOP_RGB[last]];
  let upper = 1;
  while (TEMPERATURE_STOPS[upper].celsius < celsius) upper += 1;
  const low = TEMPERATURE_STOPS[upper - 1].celsius;
  const high = TEMPERATURE_STOPS[upper].celsius;
  const t = (celsius - low) / (high - low);
  return STOP_RGB[upper - 1].map((channel, index) =>
    Math.round(channel + (STOP_RGB[upper][index] - channel) * t),
  );
}
```

- [ ] **Step 4: Write the source helpers**

`server/providers/weather-overlays/sources.js`:

```js
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test src/data/weatherOverlaysSources.test.mjs`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add src/layers/weather-overlays/modes.js src/layers/weather-overlays/palette.js server/providers/weather-overlays/sources.js src/data/weatherOverlaysSources.test.mjs
git commit -m "feat(weather-overlays): modes, palette and proxy source helpers

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Temperature tile renderer

**Files:**
- Create: `server/providers/weather-overlays/render.js`
- Test: `src/data/weatherOverlaysRender.test.mjs`

**Interfaces:**
- Consumes: `temperatureRgb` (Task 2 `palette.js`); `parseGfsCsv` (Task 2) in the test.
- Produces:
  - `TILE_SIZE = 256`, `PNG_SIGNATURE` (Buffer)
  - `encodePng(width, height, rgba: Buffer) → Buffer` (8-bit RGBA, filter 0)
  - `sampleKelvin(grid, latDeg, lonDeg) → number` (bilinear; longitude wraps when the grid spans 360°; latitude clamps)
  - `renderTemperatureTile(grid, { z, x, y }, size = 256) → Buffer`: a Web Mercator tile sampled at pixel centres; NaN pixels stay transparent

- [ ] **Step 1: Write the failing test**

`src/data/weatherOverlaysRender.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { crc32, inflateSync } from 'node:zlib';
import {
  PNG_SIGNATURE,
  encodePng,
  renderTemperatureTile,
  sampleKelvin,
} from '../../server/providers/weather-overlays/render.js';
import { parseGfsCsv } from '../../server/providers/weather-overlays/sources.js';
import {
  celsiusToFahrenheit,
  temperatureRgb,
} from '../layers/weather-overlays/palette.js';

/** Decode the unfiltered RGBA PNGs encodePng writes, checking every chunk CRC. */
function decodeRgba(png) {
  assert.ok(png.subarray(0, 8).equals(PNG_SIGNATURE));
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    assert.equal(
      png.readUInt32BE(offset + 8 + length),
      crc32(png.subarray(offset + 4, offset + 8 + length)),
      `${type} CRC`,
    );
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.deepEqual([data[8], data[9]], [8, 6], '8-bit RGBA');
    }
    if (type === 'IDAT') idat.push(data);
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    assert.equal(raw[y * (stride + 1)], 0, 'no row filter');
    raw.copy(pixels, y * stride, y * (stride + 1) + 1, (y + 1) * (stride + 1));
  }
  return { width, height, pixels };
}

test('the temperature ramp interpolates between stops and clamps at both ends', () => {
  assert.deepEqual(temperatureRgb(-50), [0x5e, 0x3c, 0x99]);
  assert.deepEqual(temperatureRgb(45), [0xa5, 0x0f, 0x15]);
  assert.deepEqual(temperatureRgb(10), [0xff, 0xf3, 0xa0]);
  assert.deepEqual(
    temperatureRgb(5),
    [207, 230, 200],
    'halfway from 0 °C to 10 °C',
  );
  assert.equal(temperatureRgb(Number.NaN), null);
  assert.equal(celsiusToFahrenheit(-30), -22);
  assert.equal(celsiusToFahrenheit(40), 104);
});

test('encodePng writes a valid RGBA PNG', () => {
  const rgba = Buffer.from([
    255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 1, 2, 3, 4,
  ]);
  const { width, height, pixels } = decodeRgba(encodePng(2, 2, rgba));
  assert.deepEqual([width, height], [2, 2]);
  assert.ok(pixels.equals(rgba));
});

test('bilinear sampling wraps longitude and clamps latitude', () => {
  const grid = {
    lat0: -90,
    latStep: 90,
    latCount: 3,
    lon0: 0,
    lonStep: 90,
    lonCount: 4,
    kelvin: Float32Array.from([
      200, 200, 200, 200, 280, 290, 300, 310, 250, 250, 250, 250,
    ]),
  };
  assert.equal(sampleKelvin(grid, 0, 0), 280);
  assert.equal(sampleKelvin(grid, 0, 45), 285);
  assert.equal(
    sampleKelvin(grid, 0, 315),
    295,
    'between 270°E and the wrapped 0°E',
  );
  assert.equal(sampleKelvin(grid, 0, -45), 295);
  assert.equal(sampleKelvin(grid, 45, 0), 265);
  assert.equal(
    sampleKelvin(grid, -100, 90),
    200,
    'clamped to the south pole row',
  );
});

test('a rendered tile colours each pixel from the sampled grid, and missing data stays clear', () => {
  const grid = parseGfsCsv(
    readFileSync(
      new URL(
        './fixtures/weather-overlays/gfs-tmp2m-30deg.csv',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  const size = 32;
  const { width, pixels } = decodeRgba(
    renderTemperatureTile(grid, { z: 0, x: 0, y: 0 }, size),
  );
  assert.equal(width, size);
  for (const [px, py] of [
    [16, 16],
    [3, 9],
    [30, 25],
  ]) {
    const lon = ((px + 0.5) / size) * 360 - 180;
    const lat =
      (Math.atan(Math.sinh(Math.PI * (1 - (2 * (py + 0.5)) / size))) * 180) /
      Math.PI;
    const offset = (py * size + px) * 4;
    assert.deepEqual(
      [...pixels.subarray(offset, offset + 4)],
      [...temperatureRgb(sampleKelvin(grid, lat, lon) - 273.15), 255],
      `pixel ${px},${py}`,
    );
  }

  const empty = {
    ...grid,
    kelvin: new Float32Array(grid.kelvin.length).fill(Number.NaN),
  };
  const clear = decodeRgba(
    renderTemperatureTile(empty, { z: 0, x: 0, y: 0 }, 4),
  ).pixels;
  assert.ok(clear.every((byte) => byte === 0));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/data/weatherOverlaysRender.test.mjs`
Expected: FAIL with `Cannot find module` for `render.js`.

- [ ] **Step 3: Write the renderer**

`server/providers/weather-overlays/render.js`:

```js
import { deflateSync } from 'node:zlib';
import { temperatureRgb } from '../../../src/layers/weather-overlays/palette.js';

export const TILE_SIZE = 256;
export const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const KELVIN_OFFSET = 273.15;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Encode 8-bit RGBA pixels (row-major) as a PNG with no row filtering. */
export function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Bilinear sample of a `parseGfsCsv` grid; wraps longitude when the grid spans 360°. */
export function sampleKelvin(grid, latDeg, lonDeg) {
  const { lat0, latStep, latCount, lon0, lonStep, lonCount, kelvin } = grid;
  const rowPosition = Math.min(
    Math.max((latDeg - lat0) / latStep, 0),
    latCount - 1,
  );
  const row = Math.min(Math.floor(rowPosition), latCount - 2);
  const rowT = rowPosition - row;
  const wraps = Math.abs(lonCount * lonStep - 360) < 1e-6;
  let columnPosition = ((((lonDeg - lon0) % 360) + 360) % 360) / lonStep;
  if (!wraps) columnPosition = Math.min(columnPosition, lonCount - 1);
  const column = Math.min(
    Math.floor(columnPosition),
    wraps ? lonCount - 1 : lonCount - 2,
  );
  const nextColumn = wraps ? (column + 1) % lonCount : column + 1;
  const columnT = columnPosition - column;
  const at = (r, c) => kelvin[r * lonCount + c];
  const south = at(row, column) * (1 - columnT) + at(row, nextColumn) * columnT;
  const north =
    at(row + 1, column) * (1 - columnT) + at(row + 1, nextColumn) * columnT;
  return south * (1 - rowT) + north * rowT;
}

/** Render one Web Mercator tile of the temperature ramp; missing values stay transparent. */
export function renderTemperatureTile(grid, { z, x, y }, size = TILE_SIZE) {
  const rgba = Buffer.alloc(size * size * 4);
  const tiles = 2 ** z;
  for (let py = 0; py < size; py += 1) {
    const mercatorY = (y + (py + 0.5) / size) / tiles;
    const lat =
      (Math.atan(Math.sinh(Math.PI * (1 - 2 * mercatorY))) * 180) / Math.PI;
    for (let px = 0; px < size; px += 1) {
      const lon = ((x + (px + 0.5) / size) / tiles) * 360 - 180;
      const rgb = temperatureRgb(sampleKelvin(grid, lat, lon) - KELVIN_OFFSET);
      if (!rgb) continue;
      const offset = (py * size + px) * 4;
      rgba[offset] = rgb[0];
      rgba[offset + 1] = rgb[1];
      rgba[offset + 2] = rgb[2];
      rgba[offset + 3] = 255;
    }
  }
  return encodePng(size, size, rgba);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/data/weatherOverlaysRender.test.mjs`
Expected: PASS, 4 tests. (`crc32` from `node:zlib` needs Node ≥ 22.2; the repo requires 24.14.)

- [ ] **Step 5: Commit**

```bash
git add server/providers/weather-overlays/render.js src/data/weatherOverlaysRender.test.mjs
git commit -m "feat(weather-overlays): render GFS temperature tiles as PNG

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Overlay proxy routes, tile cache and plugin

**Files:**
- Create: `server/providers/weather-overlays.js`
- Modify: `server/providers/local.js` (import, `localProviderPlugins()` entry, re-export)
- Test: `src/data/weatherOverlaysProxy.test.mjs` (fixtures `gmgsi-capabilities.xml`, `gmgsi-longwave-tile.png`, `gfs-tmp2m-30deg.csv`, `google-air-quality-tile.png`, `google-pollen-tile.png`, `google-invalid-map-type.json`)

**Interfaces:**
- Consumes:
  - Task 2 `sources.js` and Task 3 `render.js`;
  - `googleServerApiKey()` from `server/providers/places/google-key.js`;
  - `makeRateLimiter`, `clientKey` from `server/providers/common/rate-limit.js`;
  - `coalesceProxyRequest`, `readResponseTextCapped` from `server/providers/common/http.js`.
- Produces:
  - `createWeatherOverlaysHandler({ fetchImpl, now, apiKey, limiter, tileLimiter, log, tileCache }) → async (req, res)`, mounted at `/api/weather-overlays`:
    - `GET /manifest?mode=<key>` → `{ mode, googleConfigured, available, time, stale }` (keyless Google: `available: false, reason: 'not-configured', time: null`); 400 unknown mode; 502 `{ error: 'upstream unavailable', googleConfigured }`.
    - `GET /tiles/<key>/<time>/<z>/<x>/<y>.png` → `image/png` with `X-Overlay-Cache: HIT|MISS`; 400 bad key or coordinates; 404 unknown time or Google without a key; 502 upstream failure (never cached); 429 `Retry-After: 10`.
  - `createTileCache(limit) → { get(key, nowMs), set(key, bytes, nowMs, ttlMs), prune(nowMs), size() }`
  - `weatherOverlaysProxy(options) → { name: 'weather-overlays-proxy', configureServer, configurePreviewServer }`
  - Constants `CAPABILITIES_TTL_MS`, `GRID_TTL_MS`, `GOOGLE_TILE_TTL_MS`, `CLOUD_TILE_TTL_MS`, `TEMPERATURE_TILE_TTL_MS`, `TILE_CACHE_LIMIT`, `PRUNE_INTERVAL_MS`, `UPSTREAM_TIMEOUT_MS`, `GRID_TIMEOUT_MS`.

- [ ] **Step 1: Write the failing test**

`src/data/weatherOverlaysProxy.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import createViteConfig from '../../vite.config.js';
import {
  CAPABILITIES_TTL_MS,
  GOOGLE_TILE_TTL_MS,
  GRID_TTL_MS,
  createTileCache,
  createWeatherOverlaysHandler,
} from '../../server/providers/weather-overlays.js';

const bytes = (name) =>
  readFileSync(new URL(`./fixtures/weather-overlays/${name}`, import.meta.url));
const text = (name) => bytes(name).toString('utf8');
const NOW = Date.UTC(2026, 8, 14, 16, 20);
const T15 = Date.UTC(2026, 8, 14, 15);
const H16 = Date.UTC(2026, 8, 14, 16);
const pngResponse = (name) => () =>
  new Response(bytes(name), {
    status: 200,
    headers: { 'content-type': 'image/png' },
  });

/** Route by URL substring (first match wins); count calls per route; answers may throw. */
function upstream(routes) {
  const calls = [];
  const fetchImpl = async (url) => {
    const href = String(url);
    calls.push(href);
    for (const [match, answer] of routes) {
      if (href.includes(match)) return answer(href);
    }
    throw new Error(`unexpected upstream ${href}`);
  };
  return {
    fetchImpl,
    calls,
    count: (match) => calls.filter((href) => href.includes(match)).length,
  };
}

function invoke(handler, url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = {
      method,
      url,
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
    };
    const res = {
      writeHead(status, headers) {
        this.status = status;
        this.headers = headers || {};
      },
      end(body) {
        const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body || '');
        resolve({
          status: this.status,
          headers: this.headers,
          buffer,
          json: () => JSON.parse(buffer.toString('utf8')),
        });
      },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

function harness({
  key = 'TEST-KEY',
  routes = [],
  limiter = () => true,
  tileLimiter = () => true,
} = {}) {
  const clock = { now: NOW };
  const logs = [];
  const down = { capabilities: false, grid: false };
  const net = upstream([
    ...routes,
    [
      'GetCapabilities',
      () => {
        if (down.capabilities) throw new Error('offline');
        return new Response(text('gmgsi-capabilities.xml'));
      },
    ],
    ['request=GetMap', pngResponse('gmgsi-longwave-tile.png')],
    [
      'ncep_global.csvp',
      () => {
        if (down.grid) throw new Error('offline');
        return new Response(text('gfs-tmp2m-30deg.csv'));
      },
    ],
    ['airquality.googleapis.com', pngResponse('google-air-quality-tile.png')],
    ['pollen.googleapis.com', pngResponse('google-pollen-tile.png')],
  ]);
  const handler = createWeatherOverlaysHandler({
    fetchImpl: net.fetchImpl,
    now: () => clock.now,
    apiKey: () => key,
    limiter,
    tileLimiter,
    log: (message) => logs.push(message),
  });
  return { handler, net, logs, clock, down };
}

test('manifests: newest GMGSI time, nearest GFS step, and the current hour for Google modes', async () => {
  const h = harness();
  const clouds = await invoke(h.handler, '/manifest?mode=clouds');
  assert.equal(clouds.status, 200);
  assert.deepEqual(clouds.json(), {
    mode: 'clouds',
    googleConfigured: true,
    available: true,
    time: T15,
    stale: false,
  });

  const temperature = await invoke(h.handler, '/manifest?mode=temperature');
  assert.deepEqual(temperature.json(), {
    mode: 'temperature',
    googleConfigured: true,
    available: true,
    time: T15,
    stale: false,
  });
  await invoke(h.handler, '/manifest?mode=temperature');
  assert.equal(
    h.net.count('ncep_global.csvp'),
    1,
    'the grid is held for an hour',
  );
  assert.ok(
    h.net.calls.some((href) =>
      href.includes('tmp2m%5B(2026-09-14T15:00:00Z)%5D'),
    ),
  );

  for (const mode of ['air-quality', 'pollen-weed']) {
    assert.deepEqual(
      (await invoke(h.handler, `/manifest?mode=${mode}`)).json(),
      {
        mode,
        googleConfigured: true,
        available: true,
        time: H16,
        stale: false,
      },
    );
  }
  assert.equal(h.net.count('googleapis.com'), 0, 'manifests never call Google');
  assert.equal((await invoke(h.handler, '/manifest?mode=pollen')).status, 400);
  assert.equal((await invoke(h.handler, '/manifest')).status, 400);
});

test('without a Google key the Google modes are unavailable and their tiles 404; NOAA modes still work', async () => {
  const h = harness({ key: '' });
  assert.deepEqual(
    (await invoke(h.handler, '/manifest?mode=air-quality')).json(),
    {
      mode: 'air-quality',
      googleConfigured: false,
      available: false,
      reason: 'not-configured',
      time: null,
      stale: false,
    },
  );
  assert.equal(
    (await invoke(h.handler, `/tiles/pollen-tree/${H16}/3/1/2.png`)).status,
    404,
  );
  const clouds = (await invoke(h.handler, '/manifest?mode=clouds')).json();
  assert.equal(clouds.available, true);
  assert.equal(clouds.googleConfigured, false);
  assert.equal(h.net.count('googleapis.com'), 0);
});

test('Google tiles use the server key, are never cached, never log the key, and failures are not cached', async () => {
  let failPollen = true;
  const h = harness({
    routes: [
      [
        'GRASS_UPI',
        () =>
          failPollen
            ? new Response(text('google-invalid-map-type.json'), {
                status: 400,
              })
            : pngResponse('google-pollen-tile.png')(),
      ],
    ],
  });
  const route = `/tiles/air-quality/${H16}/3/1/2.png`;
  const miss = await invoke(h.handler, route);
  assert.equal(miss.status, 200);
  assert.equal(miss.headers['Content-Type'], 'image/png');
  assert.equal(miss.headers['X-Overlay-Cache'], 'MISS');
  assert.ok(miss.buffer.equals(bytes('google-air-quality-tile.png')));
  assert.ok(
    h.net.calls.includes(
      'https://airquality.googleapis.com/v1/mapTypes/US_AQI/heatmapTiles/3/1/2?key=TEST-KEY',
    ),
  );
  assert.equal(
    (await invoke(h.handler, route)).headers['X-Overlay-Cache'],
    'HIT',
  );
  assert.equal(h.net.count('US_AQI'), 1);
  h.clock.now += GOOGLE_TILE_TTL_MS + 1;
  assert.equal(
    (await invoke(h.handler, route)).headers['X-Overlay-Cache'],
    'MISS',
  );
  assert.equal(h.net.count('US_AQI'), 2);

  const pollen = `/tiles/pollen-grass/${H16}/5/7/12.png`;
  assert.equal((await invoke(h.handler, pollen)).status, 502);
  failPollen = false;
  assert.equal((await invoke(h.handler, pollen)).status, 200);
  assert.equal(h.net.count('GRASS_UPI'), 2, 'the failed tile was not cached');
  assert.ok(h.logs.length > 0);
  assert.ok(
    h.logs.every((line) => !line.includes('TEST-KEY')),
    'logs never carry the key',
  );

  assert.equal(
    (
      await invoke(
        h.handler,
        `/tiles/air-quality/${H16 - 4 * 3_600_000}/3/1/2.png`,
      )
    ).status,
    404,
  );
  assert.equal(
    (await invoke(h.handler, `/tiles/air-quality/${H16}/13/0/0.png`)).status,
    400,
  );
  assert.equal(
    (await invoke(h.handler, `/tiles/pollen-grass/${H16}/11/0/0.png`)).status,
    400,
  );
});

test('cloud tiles are served only for advertised GMGSI times; capabilities refresh every ten minutes and go stale on failure', async () => {
  const h = harness();
  const route = `/tiles/clouds/${T15}/7/30/53.png`;
  const miss = await invoke(h.handler, route);
  assert.equal(miss.status, 200);
  assert.ok(miss.buffer.equals(bytes('gmgsi-longwave-tile.png')));
  const getMap = new URL(
    h.net.calls.find((href) => href.includes('request=GetMap')),
  );
  assert.equal(getMap.searchParams.get('time'), '2026-09-14T15:00:00Z');
  assert.equal(
    getMap.searchParams.get('layers'),
    'global_longwave_imagery_mosaic',
  );
  assert.equal(
    (await invoke(h.handler, route)).headers['X-Overlay-Cache'],
    'HIT',
  );
  assert.equal(
    (
      await invoke(
        h.handler,
        `/tiles/clouds/${Date.UTC(2026, 8, 14, 9)}/7/30/53.png`,
      )
    ).status,
    404,
  );
  assert.equal(
    (await invoke(h.handler, `/tiles/clouds/${T15}/8/0/0.png`)).status,
    400,
    'zoom 8 is beyond the cloud cap',
  );
  assert.equal(h.net.count('GetCapabilities'), 1);

  h.down.capabilities = true;
  h.clock.now += CAPABILITIES_TTL_MS + 1;
  assert.deepEqual((await invoke(h.handler, '/manifest?mode=clouds')).json(), {
    mode: 'clouds',
    googleConfigured: true,
    available: true,
    time: T15,
    stale: true,
  });

  const cold = harness();
  cold.down.capabilities = true;
  const failed = await invoke(cold.handler, '/manifest?mode=clouds');
  assert.equal(failed.status, 502);
  assert.deepEqual(failed.json(), {
    error: 'upstream unavailable',
    googleConfigured: true,
  });
});

test('temperature tiles are rendered from the GFS grid; a failed refresh falls back to the held grid as stale', async () => {
  const h = harness();
  const route = `/tiles/temperature/${T15}/0/0/0.png`;
  const miss = await invoke(h.handler, route);
  assert.equal(miss.status, 200);
  assert.equal(miss.headers['X-Overlay-Cache'], 'MISS');
  assert.equal(miss.buffer.subarray(1, 4).toString('ascii'), 'PNG');
  assert.deepEqual(
    [miss.buffer.readUInt32BE(16), miss.buffer.readUInt32BE(20)],
    [256, 256],
  );
  assert.equal(
    (await invoke(h.handler, route)).headers['X-Overlay-Cache'],
    'HIT',
  );
  assert.equal(
    (
      await invoke(
        h.handler,
        `/tiles/temperature/${Date.UTC(2026, 8, 14, 14)}/0/0/0.png`,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await invoke(
        h.handler,
        `/tiles/temperature/${Date.UTC(2026, 8, 15, 3)}/0/0/0.png`,
      )
    ).status,
    404,
  );
  assert.equal(
    (await invoke(h.handler, `/tiles/temperature/${T15}/7/0/0.png`)).status,
    400,
  );

  h.down.grid = true;
  h.clock.now += GRID_TTL_MS + 1;
  assert.deepEqual(
    (await invoke(h.handler, '/manifest?mode=temperature')).json(),
    {
      mode: 'temperature',
      googleConfigured: true,
      available: true,
      time: T15,
      stale: true,
    },
  );

  const cold = harness();
  cold.down.grid = true;
  assert.equal(
    (await invoke(cold.handler, '/manifest?mode=temperature')).status,
    502,
  );
});

test('manifest and tile rate limits are separate; methods, unknown paths and non-PNG bodies', async () => {
  const manifestLimited = harness({ limiter: () => false });
  const refused = await invoke(
    manifestLimited.handler,
    '/manifest?mode=clouds',
  );
  assert.equal(refused.status, 429);
  assert.equal(refused.headers['Retry-After'], '10');
  assert.equal(
    (
      await invoke(
        manifestLimited.handler,
        `/tiles/air-quality/${H16}/0/0/0.png`,
      )
    ).status,
    200,
    'tiles keep their own budget',
  );

  const tileLimited = harness({ tileLimiter: () => false });
  assert.equal(
    (await invoke(tileLimited.handler, `/tiles/air-quality/${H16}/0/0/0.png`))
      .status,
    429,
  );
  assert.equal(
    (await invoke(tileLimited.handler, '/manifest?mode=clouds')).status,
    200,
  );

  const h = harness({
    routes: [['request=GetMap', () => new Response('<html>not a tile</html>')]],
  });
  assert.equal(
    (await invoke(h.handler, '/manifest?mode=clouds', 'POST')).status,
    405,
  );
  assert.equal((await invoke(h.handler, '/nope')).status, 404);
  assert.equal(
    (await invoke(h.handler, `/tiles/fog/${T15}/0/0/0.png`)).status,
    400,
  );
  assert.equal(
    (await invoke(h.handler, `/tiles/clouds/${T15}/0/0/0.jpg`)).status,
    400,
  );
  assert.equal(
    (await invoke(h.handler, `/tiles/clouds/${T15}/2/1/1.png`)).status,
    502,
  );
});

test('the tile cache evicts the oldest entry past its limit and prunes by age', () => {
  const cache = createTileCache(2);
  const one = Buffer.from('1');
  cache.set('a', one, 0, 100);
  cache.set('b', one, 0, 1000);
  cache.set('c', one, 0, 1000);
  assert.equal(cache.get('a', 1), null, 'evicted');
  assert.equal(cache.size(), 2);
  assert.equal(cache.get('b', 1000), one);
  assert.equal(cache.get('b', 1001), null, 'expired on read');
  cache.prune(5000);
  assert.equal(cache.size(), 0);
});

test('the plugin is registered in the Vite config at /api/weather-overlays', () => {
  const plugin = createViteConfig({ mode: 'test' }).plugins.find(
    (p) => p.name === 'weather-overlays-proxy',
  );
  assert.ok(plugin, 'weather-overlays-proxy must be registered');
  const routes = new Map();
  plugin.configureServer({
    middlewares: { use: (route, handler) => routes.set(route, handler) },
  });
  assert.equal(typeof routes.get('/api/weather-overlays'), 'function');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/data/weatherOverlaysProxy.test.mjs`
Expected: FAIL with `Cannot find module` for `server/providers/weather-overlays.js`.

- [ ] **Step 3: Write the handler and plugin**

`server/providers/weather-overlays.js`:

```js
import { googleServerApiKey } from './places/google-key.js';
import { clientKey, makeRateLimiter } from './common/rate-limit.js';
import { coalesceProxyRequest, readResponseTextCapped } from './common/http.js';
import {
  GFS_WINDOW_MS,
  gfsGridUrl,
  gfsValidTime,
  gmgsiCapabilitiesUrl,
  gmgsiTileUrl,
  googleTileUrl,
  googleTimeBucket,
  isGfsTime,
  isGoogleKey,
  isGoogleTime,
  isOverlayKey,
  parseGfsCsv,
  parseGmgsiTimes,
  parseTileCoords,
} from './weather-overlays/sources.js';
import {
  PNG_SIGNATURE,
  renderTemperatureTile,
} from './weather-overlays/render.js';

export const CAPABILITIES_TTL_MS = 10 * 60_000;
export const GRID_TTL_MS = 60 * 60_000;
export const GOOGLE_TILE_TTL_MS = 10 * 60_000;
export const CLOUD_TILE_TTL_MS = 3 * 60 * 60_000;
export const TEMPERATURE_TILE_TTL_MS = 60 * 60_000;
export const TILE_CACHE_LIMIT = 1500;
export const PRUNE_INTERVAL_MS = 60_000;
export const UPSTREAM_TIMEOUT_MS = 15_000;
export const GRID_TIMEOUT_MS = 30_000;
const CAPABILITIES_MAX_BYTES = 1024 * 1024;
const GRID_MAX_BYTES = 8 * 1024 * 1024;
const TILE_MAX_BYTES = 2 * 1024 * 1024;
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
    'X-Overlay-Cache': cacheStatus,
  });
  res.end(bytes);
}

async function readPngCapped(response) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > TILE_MAX_BYTES) {
    throw new Error('overlay tile too large');
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > TILE_MAX_BYTES) throw new Error('overlay tile too large');
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('overlay tile is not a PNG');
  }
  return bytes;
}

/** In-memory tile cache: per-entry age limit, oldest-first eviction, periodic prune. */
export function createTileCache(limit = TILE_CACHE_LIMIT) {
  const entries = new Map();
  return {
    get(key, nowMs) {
      const entry = entries.get(key);
      if (!entry) return null;
      if (nowMs - entry.at > entry.ttlMs) {
        entries.delete(key);
        return null;
      }
      return entry.bytes;
    },
    set(key, bytes, nowMs, ttlMs) {
      entries.delete(key);
      entries.set(key, { bytes, at: nowMs, ttlMs });
      while (entries.size > limit) entries.delete(entries.keys().next().value);
    },
    prune(nowMs) {
      for (const [key, entry] of entries) {
        if (nowMs - entry.at > entry.ttlMs) entries.delete(key);
      }
    },
    size: () => entries.size,
  };
}

export function createWeatherOverlaysHandler({
  fetchImpl = (...args) => fetch(...args),
  now = Date.now,
  apiKey = googleServerApiKey,
  limiter = makeRateLimiter({ windowMs: 60_000, max: 600, globalMax: 2000 }),
  tileLimiter = makeRateLimiter({
    windowMs: 60_000,
    max: 6000,
    globalMax: 20000,
  }),
  log = (message) => console.warn(message),
  tileCache = createTileCache(),
} = {}) {
  const inFlight = new Map();
  const grids = new Map();
  let capabilities = null;
  let lastPrune = 0;
  const googleKey = () => String(apiKey() || '').trim();

  // Log names only: Google upstream URLs carry the key.
  const logFailure = (label, error) =>
    log(`[weather-overlays] ${label} failed (${error?.name || 'Error'})`);

  async function fetchUpstream(url, timeoutMs = UPSTREAM_TIMEOUT_MS) {
    const response = await fetchImpl(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`upstream HTTP ${response.status}`);
    return response;
  }

  async function cloudTimes() {
    if (capabilities && now() - capabilities.checkedAt < CAPABILITIES_TTL_MS) {
      return capabilities;
    }
    try {
      const { promise } = coalesceProxyRequest(
        inFlight,
        'gmgsi-capabilities',
        async () =>
          parseGmgsiTimes(
            await readResponseTextCapped(
              await fetchUpstream(gmgsiCapabilitiesUrl()),
              CAPABILITIES_MAX_BYTES,
            ),
          ),
      );
      const times = await promise;
      if (!times.length) throw new Error('no GMGSI times');
      capabilities = { times, checkedAt: now(), stale: false };
    } catch (error) {
      if (!capabilities) throw error;
      capabilities = { ...capabilities, checkedAt: now(), stale: true };
      logFailure('GMGSI capabilities refresh', error);
    }
    return capabilities;
  }

  async function gridFor(timeMs) {
    const held = grids.get(timeMs);
    if (held && now() - held.fetchedAt < GRID_TTL_MS) {
      return { grid: held.grid, stale: false };
    }
    try {
      const { promise } = coalesceProxyRequest(
        inFlight,
        `gfs:${timeMs}`,
        async () => {
          const grid = parseGfsCsv(
            await readResponseTextCapped(
              await fetchUpstream(gfsGridUrl(timeMs), GRID_TIMEOUT_MS),
              GRID_MAX_BYTES,
            ),
          );
          if (!grid) throw new Error('malformed GFS grid');
          return grid;
        },
      );
      const grid = await promise;
      grids.set(timeMs, { grid, fetchedAt: now() });
      for (const time of [...grids.keys()]) {
        if (Math.abs(time - now()) > GFS_WINDOW_MS) grids.delete(time);
      }
      return { grid, stale: false };
    } catch (error) {
      if (!held) throw error;
      logFailure('GFS grid refresh', error);
      return { grid: held.grid, stale: true };
    }
  }

  function nearestHeldGridTime() {
    const times = [...grids.keys()].sort(
      (a, b) => Math.abs(a - now()) - Math.abs(b - now()),
    );
    return times[0] ?? null;
  }

  function maybePrune() {
    if (now() - lastPrune < PRUNE_INTERVAL_MS) return;
    lastPrune = now();
    tileCache.prune(now());
  }

  async function manifest(key, res) {
    const googleConfigured = Boolean(googleKey());
    const base = { mode: key, googleConfigured };
    if (isGoogleKey(key)) {
      if (!googleConfigured) {
        return sendJson(res, 200, {
          ...base,
          available: false,
          reason: 'not-configured',
          time: null,
          stale: false,
        });
      }
      return sendJson(res, 200, {
        ...base,
        available: true,
        time: googleTimeBucket(now()),
        stale: false,
      });
    }
    try {
      if (key === 'clouds') {
        const { times, stale } = await cloudTimes();
        return sendJson(res, 200, {
          ...base,
          available: true,
          time: times.at(-1),
          stale,
        });
      }
      const time = gfsValidTime(now());
      const { stale } = await gridFor(time);
      return sendJson(res, 200, { ...base, available: true, time, stale });
    } catch (error) {
      logFailure(`${key} manifest`, error);
      const fallback = key === 'temperature' ? nearestHeldGridTime() : null;
      if (fallback !== null) {
        return sendJson(res, 200, {
          ...base,
          available: true,
          time: fallback,
          stale: true,
        });
      }
      return sendJson(res, 502, {
        error: 'upstream unavailable',
        googleConfigured,
      });
    }
  }

  async function sendTile(res, cacheKey, ttlMs, produce) {
    const cached = tileCache.get(cacheKey, now());
    if (cached) return sendPng(res, cached, 'HIT');
    const { promise } = coalesceProxyRequest(
      inFlight,
      `tile:${cacheKey}`,
      produce,
    );
    const bytes = await promise;
    tileCache.set(cacheKey, bytes, now(), ttlMs);
    return sendPng(res, bytes, 'MISS');
  }

  async function tile(parts, res) {
    const [, key, timeText, z, x, file] = parts;
    if (!isOverlayKey(key))
      return sendJson(res, 400, { error: 'unknown overlay' });
    const coords = file.endsWith('.png')
      ? parseTileCoords(key, z, x, file.slice(0, -4))
      : null;
    if (!coords)
      return sendJson(res, 400, { error: 'invalid tile coordinates' });
    const time = /^\d+$/.test(timeText) ? Number(timeText) : Number.NaN;
    const cacheKey = `${key}/${timeText}/${coords.z}/${coords.x}/${coords.y}`;
    maybePrune();
    if (isGoogleKey(key)) {
      const secret = googleKey();
      if (!secret)
        return sendJson(res, 404, { error: 'overlay not configured' });
      if (!isGoogleTime(time, now())) {
        return sendJson(res, 404, { error: 'unknown overlay time' });
      }
      return sendTile(res, cacheKey, GOOGLE_TILE_TTL_MS, async () =>
        readPngCapped(await fetchUpstream(googleTileUrl(key, coords, secret))),
      );
    }
    if (key === 'clouds') {
      const { times } = await cloudTimes();
      if (!times.includes(time)) {
        return sendJson(res, 404, { error: 'unknown overlay time' });
      }
      return sendTile(res, cacheKey, CLOUD_TILE_TTL_MS, async () =>
        readPngCapped(await fetchUpstream(gmgsiTileUrl(time, coords))),
      );
    }
    if (!isGfsTime(time, now())) {
      return sendJson(res, 404, { error: 'unknown overlay time' });
    }
    return sendTile(res, cacheKey, TEMPERATURE_TILE_TTL_MS, async () =>
      renderTemperatureTile((await gridFor(time)).grid, coords),
    );
  }

  return async function handle(req, res) {
    try {
      if (req.method !== 'GET') {
        return sendJson(res, 405, { error: 'method not allowed' });
      }
      const url = new URL(req.url || '/', 'http://weather-overlays.local');
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length === 1 && parts[0] === 'manifest') {
        if (!limiter(clientKey(req))) {
          return sendJson(
            res,
            429,
            { error: 'rate limited' },
            { 'Retry-After': '10' },
          );
        }
        const key = url.searchParams.get('mode');
        if (!isOverlayKey(key))
          return sendJson(res, 400, { error: 'unknown overlay' });
        return await manifest(key, res);
      }
      if (parts.length === 6 && parts[0] === 'tiles') {
        if (!tileLimiter(clientKey(req))) {
          return sendJson(
            res,
            429,
            { error: 'rate limited' },
            { 'Retry-After': '10' },
          );
        }
        return await tile(parts, res);
      }
      return sendJson(res, 404, { error: 'not found' });
    } catch (error) {
      logFailure('request', error);
      return sendJson(res, 502, { error: 'upstream unavailable' });
    }
  };
}

export function weatherOverlaysProxy(options = {}) {
  const handler = createWeatherOverlaysHandler(options);
  const install = (server) => {
    server.middlewares.use('/api/weather-overlays', handler);
  };
  return {
    name: 'weather-overlays-proxy',
    configureServer: install,
    configurePreviewServer: install,
  };
}
```

- [ ] **Step 4: Register the plugin in `server/providers/local.js`**

Directly after `import { weatherReportProxy } from './weather-report.js';` add:

```js
import { weatherOverlaysProxy } from './weather-overlays.js';
```

In `localProviderPlugins()`, directly after `    weatherReportProxy(),` add `    weatherOverlaysProxy(),`. Leave `keySetupEndpoint()` last.

Directly after the block

```js
export {
  createWeatherReportHandler,
  weatherReportProxy,
} from './weather-report.js';
```

add a blank line and:

```js
export {
  createWeatherOverlaysHandler,
  weatherOverlaysProxy,
} from './weather-overlays.js';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test src/data/weatherOverlaysProxy.test.mjs src/data/weatherOverlaysSources.test.mjs src/data/weatherOverlaysRender.test.mjs`
Expected: PASS, 17 tests.

- [ ] **Step 6: Commit**

```bash
git add server/providers/weather-overlays.js server/providers/local.js src/data/weatherOverlaysProxy.test.mjs
git commit -m "feat(weather-overlays): caching overlay proxy with split rate limits

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Layer-state registry and options

**Files:**
- Modify: `src/data/layerState.js`, `src/data/layerState.test.mjs`

**Interfaces:**
- Consumes: `enumOption`, `normalizeRadarOpacity` already in `src/data/layerState.js`.
- Produces:
  - Registry entry `weather-overlays`, token `o`, sorted directly before `weather-radar`.
  - `options['weather-overlays'] = { mode, pollenType, opacity }`, defaults `clouds`, `tree`, 0.7.
  - Restoration calls `dataManager.setLayerParams('weather-overlays', { mode, pollenType, opacity }, { origin })`, so Task 8's `setParams` accepts exactly those keys.
  - A module-private `opacityOption(key, token, defaultValue)`, used by both weather layers.

- [ ] **Step 1: Write the failing test**

In `src/data/layerState.test.mjs`, test `'production registry is exact, canonical, and rejects incomplete contracts'`: **raise both registry-count assertions by 1 from their current value.** Today they read `18`, so they become `19`. If sub-project 3 (tide and current stations) has merged, they read `20` and become `21`. `assert.deepEqual(REGISTERED_LAYER_IDS, [...REGISTERED_LAYER_IDS].sort())` stays and enforces the sorted position.

Append at the end of the file:

```js
test('weather overlays options round-trip through the compact URL and normalize strictly', () => {
  const state = createDefaultLayerState();
  assert.deepEqual(state.options['weather-overlays'], { mode: 'clouds', pollenType: 'tree', opacity: 0.7 });

  state.enabledLayerIds = ['weather-overlays', 'weather-radar'];
  state.options['weather-overlays'] = { mode: 'pollen', pollenType: 'weed', opacity: 1 };
  const params = encodeLayerStateParams(new URLSearchParams('v=2'), state);
  assert.equal(params.get('l'), 'o.n');
  const assignments = String(params.get('lo') || '').split('_');
  for (const expected of ['o.m.p', 'o.p.w', 'o.o.100']) {
    assert.ok(assignments.includes(expected), assignments.join('_'));
  }
  assert.deepEqual(decodeLayerStateParams(params).options['weather-overlays'], {
    mode: 'pollen',
    pollenType: 'weed',
    opacity: 1,
  });

  state.options['weather-overlays'] = { mode: 'clouds', pollenType: 'tree', opacity: 0.7 };
  const defaults = encodeLayerStateParams(new URLSearchParams('v=2'), state);
  assert.equal(String(defaults.get('lo') || '').split('_').some((entry) => entry.startsWith('o.')), false);

  assert.deepEqual(
    decodeLayerStateParams(new URLSearchParams('v=2&l=o&lo=o.m.x_o.p.g_o.o.55')).options['weather-overlays'],
    { mode: 'clouds', pollenType: 'grass', opacity: 0.7 },
    'unknown mode and opacity tokens fall back to their defaults',
  );
  assert.deepEqual(
    normalizeLayerState({ options: { 'weather-overlays': { mode: 'fog', pollenType: 'grass', opacity: 0.4 } } }).options['weather-overlays'],
    { mode: 'clouds', pollenType: 'grass', opacity: 0.4 },
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/data/layerState.test.mjs`
Expected: FAIL: the registry is one id short, and `options['weather-overlays']` is `undefined`.

- [ ] **Step 3: Implement**

In `src/data/layerState.js`, directly after the `function normalizeRadarOpacity(value) { … }` function add:

```js

function opacityOption(key, token, defaultValue) {
  return Object.freeze({
    key,
    token,
    defaultValue,
    normalize: normalizeRadarOpacity,
    encode: (value) => String(Math.round(value * 100)),
    decode: (value) => (/^(40|70|100)$/.test(value) ? Number(value) / 100 : null),
  });
}
```

In `OPTION_GROUPS`, in the `'weather-radar'` group, replace its inline opacity spec

```js
    Object.freeze({
      key: 'opacity',
      token: 'o',
      defaultValue: 0.7,
      normalize: normalizeRadarOpacity,
      encode: (value) => String(Math.round(value * 100)),
      decode: (value) => (/^(40|70|100)$/.test(value) ? Number(value) / 100 : null),
    }),
```

with `    opacityOption('opacity', 'o', 0.7),`. Then, directly before the line `  'weather-radar': Object.freeze([`, add:

```js
  'weather-overlays': Object.freeze([
    enumOption('mode', 'm', 'clouds', ['clouds', 'temperature', 'air-quality', 'pollen'], {
      clouds: 'c',
      temperature: 't',
      'air-quality': 'a',
      pollen: 'p',
    }),
    enumOption('pollenType', 'p', 'tree', ['tree', 'grass', 'weed'], {
      tree: 't',
      grass: 'g',
      weed: 'w',
    }),
    opacityOption('opacity', 'o', 0.7),
  ]),
```

In `LAYER_STATE_REGISTRY`, directly before the `weather-radar` entry, add:

```js
  Object.freeze({ id: 'weather-overlays', token: 'o', disposition: 'enabled+options', optionOwner: 'weather-overlays' }),
```

(`src/data/layerState.js` and its test are outside the Prettier scope; keep the file's long-line style.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test src/data/layerState.test.mjs`
Expected: PASS (the whole file, including the radar round-trip test and the new one).

- [ ] **Step 5: Commit**

```bash
git add src/data/layerState.js src/data/layerState.test.mjs
git commit -m "feat(weather-overlays): layer-state token and options

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Row controls and legends

**Files:**
- Create: `src/layers/weather-overlays/controls.js`
- Test: `src/layers/weather-overlays/controls.test.mjs`

**Interfaces:**
- Consumes:
  - `IMAGERY_OPACITIES` (Task 1);
  - `MODES`, `MODE_INFO`, `POLLEN_LABELS`, `POLLEN_TYPES` (Task 2);
  - the legends and `celsiusToFahrenheit` (Task 2);
  - the Layers panel row-control contract. Chips are `{ id, label, title, active, disabled, params }`, and the panel applies `params` through `setLayerParams`. Legend entries are `{ label, count, color, blurb }`, rendered as `${label} ${count}`, so `count` must always be a string.
- Produces:
  - `buildLegend(mode) → legend[]`
  - `buildRowControls({ mode, pollenType, opacity, googleConfigured }) → { chips, legend }`. Chip ids are `mode-<mode>`, `pollen-<type>` (pollen mode only) and `opacity-40|70|100`. Google chips are `disabled` only when `googleConfigured === false`.

- [ ] **Step 1: Write the failing test**

`src/layers/weather-overlays/controls.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MODES,
  OVERLAY_KEYS,
  maximumLevelFor,
  modeOfKey,
  normalizeMode,
  normalizePollenType,
  overlayKey,
  sourceName,
} from './modes.js';
import { buildLegend, buildRowControls } from './controls.js';

const base = {
  mode: 'clouds',
  pollenType: 'tree',
  opacity: 0.7,
  googleConfigured: true,
};

test('modes map to proxy keys, source names and zoom caps', () => {
  assert.deepEqual(MODES, ['clouds', 'temperature', 'air-quality', 'pollen']);
  assert.equal(overlayKey('pollen', 'grass'), 'pollen-grass');
  assert.equal(overlayKey('temperature', 'grass'), 'temperature');
  assert.equal(modeOfKey('pollen-weed'), 'pollen');
  assert.deepEqual(OVERLAY_KEYS.map(maximumLevelFor), [7, 6, 12, 10, 10, 10]);
  assert.equal(maximumLevelFor('fog'), null);
  assert.equal(sourceName('pollen', 'weed'), 'Google Pollen · Weed');
  assert.equal(sourceName('clouds', 'weed'), 'NOAA GMGSI satellite');
  assert.equal(normalizeMode('air-quality'), 'air-quality');
  assert.equal(normalizeMode('fog'), null);
  assert.equal(normalizePollenType('grass'), 'grass');
  assert.equal(normalizePollenType('pine'), null);
});

test('chips: four modes, pollen types only in pollen mode, then three opacities', () => {
  const clouds = buildRowControls(base).chips;
  assert.deepEqual(
    clouds.map((chip) => chip.id),
    [
      'mode-clouds',
      'mode-temperature',
      'mode-air-quality',
      'mode-pollen',
      'opacity-40',
      'opacity-70',
      'opacity-100',
    ],
  );
  assert.deepEqual(clouds[0], {
    id: 'mode-clouds',
    label: 'Clouds',
    title: 'Cloud cover from geostationary satellites',
    active: true,
    disabled: false,
    params: { mode: 'clouds' },
  });
  assert.deepEqual(
    clouds
      .slice(4)
      .map((chip) => [chip.label, chip.active, chip.params.opacity]),
    [
      ['40%', false, 0.4],
      ['70%', true, 0.7],
      ['100%', false, 1],
    ],
  );

  const pollen = buildRowControls({
    ...base,
    mode: 'pollen',
    pollenType: 'grass',
  }).chips;
  assert.deepEqual(
    pollen
      .slice(4, 7)
      .map((chip) => [chip.id, chip.label, chip.active, chip.params]),
    [
      ['pollen-tree', 'Tree', false, { pollenType: 'tree' }],
      ['pollen-grass', 'Grass', true, { pollenType: 'grass' }],
      ['pollen-weed', 'Weed', false, { pollenType: 'weed' }],
    ],
  );
  assert.equal(pollen.find((chip) => chip.id === 'mode-pollen').active, true);
});

test('Google modes are disabled with a reason only once the server reports no key', () => {
  const unknown = buildRowControls({ ...base, googleConfigured: null }).chips;
  assert.equal(
    unknown.find((chip) => chip.id === 'mode-air-quality').disabled,
    false,
  );

  const keyless = buildRowControls({
    ...base,
    mode: 'pollen',
    googleConfigured: false,
  }).chips;
  for (const id of ['mode-air-quality', 'mode-pollen', 'pollen-tree']) {
    assert.equal(keyless.find((chip) => chip.id === id).disabled, true, id);
  }
  assert.equal(
    keyless.find((chip) => chip.id === 'mode-air-quality').title,
    'Air quality (US AQI): needs a Google Maps API key',
  );
  assert.equal(
    keyless.find((chip) => chip.id === 'mode-clouds').disabled,
    false,
  );
  assert.equal(
    keyless.find((chip) => chip.id === 'opacity-40').disabled,
    false,
  );
});

test('legends carry text for every entry and the measured colours', () => {
  assert.deepEqual(
    buildLegend('clouds').map((item) => [item.label, item.count, item.color]),
    [
      ['Low', 'warm tops', '#8c8c8c'],
      ['Mid', 'cool tops', '#c8c8c8'],
      ['High', 'cold tops', '#ffffff'],
    ],
  );
  assert.deepEqual(
    buildLegend('temperature').map((item) => `${item.label} ${item.count}`),
    [
      '-30°C -22°F',
      '-15°C 5°F',
      '0°C 32°F',
      '10°C 50°F',
      '20°C 68°F',
      '30°C 86°F',
      '40°C 104°F',
    ],
  );
  assert.deepEqual(
    buildLegend('air-quality').map((item) => item.color),
    ['#00e400', '#ffff00', '#ff7e00', '#ff0000', '#8f3f97', '#7e0023'],
  );
  assert.deepEqual(
    buildLegend('pollen').map((item) => [item.count, item.color]),
    [
      ['UPI 1', '#009e3a'],
      ['UPI 2', '#84cf33'],
      ['UPI 3', '#ffff00'],
      ['UPI 4', '#ff8c00'],
      ['UPI 5', '#ff0000'],
    ],
  );
  for (const mode of MODES) {
    for (const item of buildLegend(mode)) {
      assert.equal(typeof item.count, 'string', `${mode} ${item.label}`);
      assert.ok(item.blurb.length > 0);
    }
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/layers/weather-overlays/controls.test.mjs`
Expected: FAIL with `Cannot find module` for `./controls.js`.

- [ ] **Step 3: Write the controls**

`src/layers/weather-overlays/controls.js`:

```js
import { IMAGERY_OPACITIES } from '../weather-imagery/opacity.js';
import { MODES, MODE_INFO, POLLEN_LABELS, POLLEN_TYPES } from './modes.js';
import {
  AIR_QUALITY_LEGEND,
  CLOUD_LEGEND,
  POLLEN_LEGEND,
  TEMPERATURE_STOPS,
  celsiusToFahrenheit,
} from './palette.js';

/**
 * Legend entries for the Layers panel. The panel renders `${label} ${count}`,
 * so `count` always carries the secondary text and is never undefined.
 */
export function buildLegend(mode) {
  if (mode === 'temperature') {
    return TEMPERATURE_STOPS.map(({ celsius, color }) => ({
      label: `${celsius}°C`,
      count: `${celsiusToFahrenheit(celsius)}°F`,
      color,
      blurb: `${celsius}°C (${celsiusToFahrenheit(celsius)}°F) at 2 m`,
    }));
  }
  if (mode === 'air-quality') {
    return AIR_QUALITY_LEGEND.map(({ label, range, color }) => ({
      label,
      count: range,
      color,
      blurb: `US AQI ${range}: ${label}`,
    }));
  }
  if (mode === 'pollen') {
    return POLLEN_LEGEND.map(({ label, index, color }) => ({
      label,
      count: `UPI ${index}`,
      color,
      blurb: `Universal Pollen Index ${index}: ${label}`,
    }));
  }
  return CLOUD_LEGEND.map(({ label, detail, color }) => ({
    label,
    count: detail,
    color,
    blurb: `Infrared cloud: ${label.toLowerCase()} cloud, ${detail}; clear sky is transparent`,
  }));
}

/** Row chips and legend (see layerPanel._syncRowControls). */
export function buildRowControls({
  mode,
  pollenType,
  opacity,
  googleConfigured,
}) {
  const keyMissing = googleConfigured === false;
  const chips = MODES.map((id) => {
    const info = MODE_INFO[id];
    const needsKey = info.google && keyMissing;
    return {
      id: `mode-${id}`,
      label: info.label,
      title: needsKey
        ? `${info.title}: needs a Google Maps API key`
        : info.title,
      active: mode === id,
      disabled: needsKey,
      params: { mode: id },
    };
  });
  if (mode === 'pollen') {
    for (const id of POLLEN_TYPES) {
      chips.push({
        id: `pollen-${id}`,
        label: POLLEN_LABELS[id],
        title: `${POLLEN_LABELS[id]} pollen`,
        active: pollenType === id,
        disabled: keyMissing,
        params: { pollenType: id },
      });
    }
  }
  for (const value of IMAGERY_OPACITIES) {
    const percent = Math.round(value * 100);
    chips.push({
      id: `opacity-${percent}`,
      label: `${percent}%`,
      title: `Overlay opacity ${percent}%`,
      active: opacity === value,
      disabled: false,
      params: { opacity: value },
    });
  }
  return { chips, legend: buildLegend(mode) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/layers/weather-overlays/controls.test.mjs`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/layers/weather-overlays/controls.js src/layers/weather-overlays/controls.test.mjs
git commit -m "feat(weather-overlays): mode, pollen and opacity chips with legends

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Overlay imagery

**Files:**
- Create: `src/layers/weather-overlays/imagery.js`
- Test: `src/layers/weather-overlays/imagery.test.mjs`

**Interfaces:**
- Consumes: `createFrameImagery` (Task 1); `maximumLevelFor`, `modeOfKey` (Task 2); Cesium `UrlTemplateImageryProvider`, `ImageryLayer` (`colorToAlpha`, `colorToAlphaThreshold`), `Credit(html, showOnScreen)`, `Color.BLACK`.
- Produces:
  - `OVERLAY_INSERT_INDEX = 1`, `CLOUD_CLEAR_THRESHOLD = 0.3`, `GOOGLE_IMAGERY_CREDITS`
  - `overlayTemplate(key, timeMs) → '/api/weather-overlays/tiles/<key>/<time>/{z}/{x}/{y}.png'`
  - `createOverlayProvider(key, timeMs)`, `createOverlayLayer(provider, key)`
  - `createOverlayImagery(viewer, options?)`: the Task 1 imagery API, inserting at index 1

- [ ] **Step 1: Write the failing test**

`src/layers/weather-overlays/imagery.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  CLOUD_CLEAR_THRESHOLD,
  OVERLAY_INSERT_INDEX,
  createOverlayImagery,
  createOverlayLayer,
  createOverlayProvider,
  overlayTemplate,
} from './imagery.js';

const T = Date.UTC(2026, 8, 14, 15);

test('the URL template points at the proxy with Cesium tile tags', () => {
  assert.equal(
    overlayTemplate('pollen-grass', T),
    `/api/weather-overlays/tiles/pollen-grass/${T}/{z}/{x}/{y}.png`,
  );
});

test('providers cap zoom per mode, and Google imagery carries its attribution on screen', () => {
  const air = createOverlayProvider('air-quality', T);
  assert.ok(air instanceof Cesium.UrlTemplateImageryProvider);
  assert.equal(air.maximumLevel, 12);
  assert.equal(
    air.credit.html,
    'Source: Includes air quality data from Google',
  );
  assert.equal(air.credit.showOnScreen, true);

  const pollen = createOverlayProvider('pollen-weed', T);
  assert.equal(pollen.maximumLevel, 10);
  assert.equal(pollen.credit.html, 'Source: Includes pollen data from Google');
  assert.equal(pollen.credit.showOnScreen, true);

  assert.equal(createOverlayProvider('clouds', T).maximumLevel, 7);
  assert.equal(createOverlayProvider('clouds', T).credit, undefined);
  assert.equal(createOverlayProvider('temperature', T).maximumLevel, 6);
});

test('cloud layers turn dark, warm pixels transparent; other modes draw as served', () => {
  const clouds = createOverlayLayer(
    createOverlayProvider('clouds', T),
    'clouds',
  );
  assert.ok(clouds instanceof Cesium.ImageryLayer);
  assert.ok(Cesium.Color.equals(clouds.colorToAlpha, Cesium.Color.BLACK));
  assert.equal(clouds.colorToAlphaThreshold, CLOUD_CLEAR_THRESHOLD);
  assert.equal(CLOUD_CLEAR_THRESHOLD, 0.3);
  const temperature = createOverlayLayer(
    createOverlayProvider('temperature', T),
    'temperature',
  );
  assert.equal(temperature.colorToAlpha, undefined);
});

test('overlay frames sit directly above the base map, below radar layers', () => {
  const listeners = new Set();
  const layers = [{ base: true }, { radar: true }];
  const viewer = {
    imageryLayers: {
      get length() {
        return layers.length;
      },
      add(layer, index) {
        if (index === undefined) layers.push(layer);
        else layers.splice(index, 0, layer);
      },
      remove(layer) {
        layers.splice(layers.indexOf(layer), 1);
      },
    },
    scene: {
      globe: {
        tileLoadProgressEvent: {
          addEventListener: (listener) => (
            listeners.add(listener),
            () => listeners.delete(listener)
          ),
        },
      },
    },
  };
  assert.equal(OVERLAY_INSERT_INDEX, 1);
  const imagery = createOverlayImagery(viewer, {
    createProvider: (source, time) => ({ source, time }),
    createLayer: (provider, source) => ({ provider, source, alpha: 1 }),
  });
  imagery.setSource('temperature');
  imagery.show(T);
  assert.deepEqual(
    layers.map((layer) =>
      layer.base ? 'base' : layer.radar ? 'radar' : layer.source,
    ),
    ['base', 'temperature', 'radar'],
  );
  imagery.destroy();
  assert.equal(listeners.size, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/layers/weather-overlays/imagery.test.mjs`
Expected: FAIL with `Cannot find module` for `./imagery.js`.

- [ ] **Step 3: Write the imagery module**

`src/layers/weather-overlays/imagery.js`:

```js
import * as Cesium from 'cesium';
import { createFrameImagery } from '../weather-imagery/frameImagery.js';
import { maximumLevelFor, modeOfKey } from './modes.js';

/** Directly above the base map (index 0), so radar added later stays on top. */
export const OVERLAY_INSERT_INDEX = 1;
/** GMGSI longwave pixels darker than this (0-1) are warm surface: made clear. */
export const CLOUD_CLEAR_THRESHOLD = 0.3;
/** Google's required attribution, shown on screen while its imagery is drawn. */
export const GOOGLE_IMAGERY_CREDITS = Object.freeze({
  'air-quality': 'Source: Includes air quality data from Google',
  pollen: 'Source: Includes pollen data from Google',
});

export function overlayTemplate(key, timeMs) {
  return `/api/weather-overlays/tiles/${key}/${timeMs}/{z}/{x}/{y}.png`;
}

export function createOverlayProvider(key, timeMs) {
  const creditText = GOOGLE_IMAGERY_CREDITS[modeOfKey(key)];
  return new Cesium.UrlTemplateImageryProvider({
    url: overlayTemplate(key, timeMs),
    tileWidth: 256,
    tileHeight: 256,
    maximumLevel: maximumLevelFor(key),
    ...(creditText ? { credit: new Cesium.Credit(creditText, true) } : {}),
  });
}

export function createOverlayLayer(provider, key) {
  if (key !== 'clouds') return new Cesium.ImageryLayer(provider);
  return new Cesium.ImageryLayer(provider, {
    colorToAlpha: Cesium.Color.BLACK,
    colorToAlphaThreshold: CLOUD_CLEAR_THRESHOLD,
  });
}

export function createOverlayImagery(viewer, options = {}) {
  return createFrameImagery(viewer, {
    createProvider: createOverlayProvider,
    createLayer: createOverlayLayer,
    insertIndex: OVERLAY_INSERT_INDEX,
    ...options,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/layers/weather-overlays/imagery.test.mjs`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/layers/weather-overlays/imagery.js src/layers/weather-overlays/imagery.test.mjs
git commit -m "feat(weather-overlays): overlay providers, cloud transparency and Google credit

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Weather overlays layer

**Files:**
- Create: `src/layers/weather-overlays/index.js`, `src/data/weatherOverlays.js`
- Modify: `src/data/dataCredits.js` (four credits directly after `IEM_NEXRAD_CREDIT`)
- Test: `src/layers/weather-overlays/index.test.mjs`

**Interfaces:**
- Consumes:
  - `swapToFrame`, `normalizeImageryOpacity` (Task 1);
  - Task 2 `modes.js`; `buildRowControls` (Task 6); `createOverlayImagery` (Task 7);
  - `registerDynamicCredit(viewer, credit)` and `governorRequestRender(reason)` in the wrapper;
  - `LayerPanel` from `src/ui/layerPanel.js`, in the test only.
- Produces:
  - `REFRESH_MS = 600000`, `SWAP_CHECK_MS = 1000`
  - `createWeatherOverlaysLayer({ fetchImpl, createImagery, registerCredit, credits: { clouds, temperature, 'air-quality', pollen }, eventTarget, isVisible, timers, now, requestRender }) → layer`, with the manager contract: `init`, `enable`, `disable`, `update(viewer, { signal })`, `destroy`, `getStats`, `getParams → { mode, pollenType, opacity }`, `setParams({ mode?, pollenType?, opacity? }) → true | false`, `getRowControls`, `setRowControlsListener`, `attachMapStack({ getActiveId })`.
  - `src/data/weatherOverlays.js`: a default instance with real credits and `governorRequestRender`, plus `export *` of the layer module.
  - `NOAA_GMGSI_CREDIT`, `NOAA_GFS_CREDIT`, `GOOGLE_AIR_QUALITY_CREDIT`, `GOOGLE_POLLEN_CREDIT` in `src/data/dataCredits.js`.

- [ ] **Step 1: Write the failing test**

`src/layers/weather-overlays/index.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REFRESH_MS,
  SWAP_CHECK_MS,
  createWeatherOverlaysLayer,
} from './index.js';
import defaultLayer from '../../data/weatherOverlays.js';
import {
  GOOGLE_AIR_QUALITY_CREDIT,
  GOOGLE_POLLEN_CREDIT,
  NOAA_GFS_CREDIT,
  NOAA_GMGSI_CREDIT,
} from '../../data/dataCredits.js';
import { LayerPanel } from '../../ui/layerPanel.js';

const T15 = Date.UTC(2026, 8, 14, 15);
const T16 = Date.UTC(2026, 8, 14, 16);
const NOW = Date.UTC(2026, 8, 14, 16, 20);

function fakeImagery() {
  const calls = [];
  const ready = new Set();
  const layers = new Set();
  let shown = null;
  let source = null;
  const api = {
    setSource(next) {
      calls.push(['setSource', next]);
      if (next !== source) {
        layers.clear();
        ready.clear();
        shown = null;
      }
      source = next;
    },
    preload(times) {
      calls.push(['preload', [...times]]);
      for (const time of times) layers.add(time);
    },
    show(time) {
      calls.push(['show', time]);
      layers.add(time);
      shown = time;
    },
    setAlpha(alpha) {
      calls.push(['setAlpha', alpha]);
    },
    release(keep) {
      calls.push(['release', [...keep]]);
      for (const time of [...layers])
        if (!keep.includes(time)) layers.delete(time);
    },
    isReady: (time) => ready.has(time),
    readyCount: () => [...layers].filter((time) => ready.has(time)).length,
    shownTime: () => shown,
    clear() {
      calls.push(['clear']);
      layers.clear();
      shown = null;
    },
    destroy() {
      calls.push(['destroy']);
    },
  };
  return { api, calls, ready, layers, source: () => source };
}

function fakeTimers() {
  let pending = [];
  return {
    setTimeout(fn, ms) {
      const timer = { fn, ms };
      pending.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      pending = pending.filter((t) => t !== timer);
    },
    delays: () => pending.map((t) => t.ms),
    run(ms) {
      const timer = pending.find((t) => t.ms === ms);
      assert.ok(timer, `no pending ${ms} ms timer`);
      pending = pending.filter((t) => t !== timer);
      timer.fn();
    },
  };
}

const manifest = (mode, time, extra = {}) => ({
  mode,
  googleConfigured: true,
  available: true,
  time,
  stale: false,
  ...extra,
});

/** Answers are keyed by the manifest `mode` query; an answer may be an Error, a Promise, or `{ status, body }`. */
function harness({ answers = {}, visible = true } = {}) {
  const imagery = fakeImagery();
  const timers = fakeTimers();
  const credited = [];
  const requests = [];
  const renderRequests = [];
  const events = new EventTarget();
  const clock = { now: NOW, visible };
  const table = {
    clouds: manifest('clouds', T15),
    temperature: manifest('temperature', T15),
    'air-quality': manifest('air-quality', T16),
    'pollen-tree': manifest('pollen-tree', T16),
    'pollen-grass': manifest('pollen-grass', T16),
    'pollen-weed': manifest('pollen-weed', T16),
    ...answers,
  };
  const layer = createWeatherOverlaysLayer({
    fetchImpl: async (url) => {
      requests.push(url);
      const answer =
        await table[new URL(url, 'http://app.local').searchParams.get('mode')];
      if (answer instanceof Error) throw answer;
      if (answer?.status)
        return Response.json(answer.body, { status: answer.status });
      return Response.json(answer);
    },
    createImagery: () => imagery.api,
    registerCredit: (_viewer, credit) => credited.push(credit.key),
    credits: {
      clouds: { key: 'clouds' },
      temperature: { key: 'temperature' },
      'air-quality': { key: 'air-quality' },
      pollen: { key: 'pollen' },
    },
    eventTarget: events,
    isVisible: () => clock.visible,
    timers,
    now: () => clock.now,
    requestRender: (reason) => renderRequests.push(reason),
  });
  return {
    layer,
    imagery,
    timers,
    credited,
    requests,
    renderRequests,
    events,
    clock,
    table,
    viewer: {},
  };
}

async function enabled(h) {
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  await h.layer.update(h.viewer, {});
}

test('the layer identifies itself, refreshes every ten minutes and ships real credits', () => {
  const { layer } = harness();
  assert.equal(layer.id, 'weather-overlays');
  assert.equal(layer.name, 'Weather Overlays');
  assert.equal(layer.icon, '🌡️');
  assert.equal(layer.updateInterval, REFRESH_MS);
  assert.equal(REFRESH_MS, 600_000);
  assert.equal(defaultLayer.id, 'weather-overlays');
  assert.equal(
    NOAA_GMGSI_CREDIT.html,
    'Clouds: <a href="https://nowcoast.noaa.gov/" target="_blank" rel="noopener">NOAA nowCOAST</a> GMGSI geostationary satellite mosaic',
  );
  assert.equal(
    NOAA_GFS_CREDIT.html,
    'Temperature: NOAA NCEP GFS via <a href="https://pae-paha.pacioos.hawaii.edu/erddap/griddap/ncep_global.html" target="_blank" rel="noopener">PacIOOS ERDDAP</a>',
  );
  assert.equal(
    GOOGLE_AIR_QUALITY_CREDIT.html,
    'Air quality overlay: Source: Includes air quality data from Google',
  );
  assert.equal(
    GOOGLE_POLLEN_CREDIT.html,
    'Pollen overlay: Source: Includes pollen data from Google',
  );
});

test('enabling credits the mode, fetches its manifest and shows the cloud image with its age', async () => {
  const h = harness();
  await enabled(h);
  assert.deepEqual(h.credited, ['clouds']);
  assert.deepEqual(h.requests, ['/api/weather-overlays/manifest?mode=clouds']);
  assert.equal(h.imagery.source(), 'clouds');
  assert.equal(h.imagery.api.shownTime(), T15);
  assert.deepEqual(h.layer.getStats(), {
    status: 'ok',
    source: 'NOAA GMGSI satellite · 15:00 UTC · 80 min old',
    lastUpdate: NOW,
    countLabel: 'CLOUDS',
  });
  assert.ok(h.renderRequests.includes('weather-overlays'));
});

test('temperature shows its model valid time and the temperature legend', async () => {
  const h = harness();
  assert.notEqual(
    h.layer.setParams({ mode: 'temperature' }, { origin: 'local-restore' }),
    false,
  );
  await enabled(h);
  assert.deepEqual(h.credited, ['temperature']);
  assert.equal(h.layer.getStats().source, 'NOAA GFS model · valid 15:00 UTC');
  assert.equal(h.layer.getStats().countLabel, 'TEMP');
  assert.equal(h.layer.getRowControls().legend[0].label, '-30°C');
});

test('switching mode clears imagery, credits the new source and refetches; pollen type changes the key', async () => {
  const h = harness();
  await enabled(h);
  const renders = h.renderRequests.length;
  assert.notEqual(
    h.layer.setParams({ mode: 'pollen' }, { origin: 'user' }),
    false,
  );
  assert.equal(h.imagery.source(), 'pollen-tree');
  assert.equal(
    h.imagery.api.shownTime(),
    null,
    'the old mode is cleared at once',
  );
  assert.ok(h.renderRequests.length > renders, 'clearing requests a render');
  assert.deepEqual(h.credited, ['clouds', 'pollen']);
  assert.equal(
    h.requests.at(-1),
    '/api/weather-overlays/manifest?mode=pollen-tree',
  );
  assert.equal(await h.layer.update(h.viewer, {}), true);
  assert.equal(h.imagery.api.shownTime(), T16);
  assert.deepEqual(h.layer.getStats(), {
    status: 'ok',
    source: 'Google Pollen · Tree',
    lastUpdate: NOW,
    countLabel: 'POLLEN',
  });

  h.layer.setParams({ pollenType: 'grass' }, { origin: 'user' });
  assert.equal(h.imagery.source(), 'pollen-grass');
  assert.deepEqual(
    h.credited,
    ['clouds', 'pollen'],
    'same credit for another pollen type',
  );
  assert.equal(
    h.requests.at(-1),
    '/api/weather-overlays/manifest?mode=pollen-grass',
  );
  await h.layer.update(h.viewer, {});
  assert.deepEqual(h.layer.getParams(), {
    mode: 'pollen',
    pollenType: 'grass',
    opacity: 0.7,
  });

  assert.equal(h.layer.setParams({ mode: 'fog' }, { origin: 'user' }), false);
  assert.equal(
    h.layer.setParams({ pollenType: 'pine' }, { origin: 'user' }),
    false,
  );
  assert.equal(h.layer.setParams({ opacity: 0.5 }, { origin: 'user' }), false);
  const before = h.renderRequests.length;
  assert.notEqual(
    h.layer.setParams({ opacity: 0.4 }, { origin: 'user' }),
    false,
  );
  assert.deepEqual(
    h.imagery.calls.filter(([name]) => name === 'setAlpha').at(-1),
    ['setAlpha', 0.4],
  );
  assert.ok(
    h.renderRequests.length > before,
    'an alpha change requests a render',
  );
  assert.deepEqual(h.layer.getParams(), {
    mode: 'pollen',
    pollenType: 'grass',
    opacity: 0.4,
  });
});

test('a Google mode without a server key reports unavailable, draws nothing, and disables Google chips', async () => {
  const h = harness({
    answers: {
      'air-quality': {
        mode: 'air-quality',
        googleConfigured: false,
        available: false,
        reason: 'not-configured',
        time: null,
        stale: false,
      },
    },
  });
  h.layer.setParams({ mode: 'air-quality' }, { origin: 'share-restore' });
  await enabled(h);
  assert.deepEqual(h.layer.getStats(), {
    status: 'unavailable',
    source: 'Google Air Quality',
    error: 'Google Maps API key not configured',
    countLabel: 'AQI',
  });
  assert.equal(h.imagery.api.shownTime(), null);
  const chips = h.layer.getRowControls().chips;
  assert.equal(
    chips.find((chip) => chip.id === 'mode-air-quality').disabled,
    true,
  );
  assert.equal(chips.find((chip) => chip.id === 'mode-clouds').disabled, false);
});

test('loading, a hidden-tab skip, stale with an image, and unavailable without one', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const h = harness({ answers: { clouds: gate } });
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  const pending = h.layer.update(h.viewer, {});
  assert.deepEqual(h.layer.getStats(), {
    loading: true,
    source: 'NOAA GMGSI satellite',
    loadingLabel: 'Loading',
    countLabel: 'CLOUDS',
  });
  release(manifest('clouds', T15));
  assert.equal(await pending, true);
  assert.equal(h.layer.getStats().status, 'ok');

  h.clock.visible = false;
  assert.equal(
    await h.layer.update(h.viewer, {}),
    true,
    'a skipped refresh is not a failure',
  );
  assert.equal(h.requests.length, 1);

  h.clock.visible = true;
  h.table.clouds = new Error('offline');
  assert.equal(
    await h.layer.update(h.viewer, {}),
    true,
    'failures are reported through stats',
  );
  assert.deepEqual(h.layer.getStats(), {
    stale: true,
    source: 'NOAA GMGSI satellite · 15:00 UTC',
    error: 'Overlay source unavailable — showing 15:00 UTC',
    lastUpdate: NOW,
    countLabel: 'CLOUDS',
  });

  h.table.clouds = manifest('clouds', T15, { stale: true });
  await h.layer.update(h.viewer, {});
  assert.equal(h.layer.getStats().stale, true, 'a stale manifest reads stale');

  const cold = harness({
    answers: {
      clouds: {
        status: 502,
        body: { error: 'upstream unavailable', googleConfigured: false },
      },
    },
  });
  await enabled(cold);
  assert.deepEqual(cold.layer.getStats(), {
    status: 'unavailable',
    source: 'NOAA GMGSI satellite',
    error: 'Overlay source unavailable',
    countLabel: 'CLOUDS',
  });
  assert.equal(
    cold.layer.getRowControls().chips.find((chip) => chip.id === 'mode-pollen')
      .disabled,
    true,
    'key state is read from error bodies too',
  );
});

test('a newer image is shown only once its tiles are ready, and the delayed swap requests a render', async () => {
  const h = harness();
  await enabled(h);
  h.table.clouds = manifest('clouds', T16);
  h.clock.now = Date.UTC(2026, 8, 14, 17, 5);
  await h.layer.update(h.viewer, {});
  assert.equal(h.imagery.api.shownTime(), T15, 'still showing the older image');
  assert.ok(h.timers.delays().includes(SWAP_CHECK_MS));
  h.timers.run(SWAP_CHECK_MS);
  assert.equal(h.imagery.api.shownTime(), T15, 'not ready yet');
  assert.ok(h.timers.delays().includes(SWAP_CHECK_MS), 're-armed');
  h.imagery.ready.add(T16);
  const renders = h.renderRequests.length;
  h.timers.run(SWAP_CHECK_MS);
  assert.equal(h.imagery.api.shownTime(), T16);
  assert.deepEqual([...h.imagery.layers], [T16], 'the older image is released');
  assert.ok(h.renderRequests.length > renders);
});

test('Google 3D is reported from the attached controller and from map-stack events', async () => {
  const h = harness();
  let active = 'photoreal';
  h.layer.attachMapStack({ getActiveId: () => active });
  await enabled(h);
  assert.deepEqual(h.layer.getStats(), {
    status: 'idle',
    source: 'NOAA GMGSI satellite',
    statusMessage: 'Hidden by Google 3D map source',
    countLabel: 'CLOUDS',
  });
  active = 'esri-imagery';
  assert.equal(h.layer.getStats().status, 'ok');

  const evented = harness();
  await enabled(evented);
  evented.events.dispatchEvent(
    new CustomEvent('gev:map-stack-changed', {
      detail: { activeStack: { id: 'photoreal' } },
    }),
  );
  assert.equal(evented.layer.getStats().status, 'idle');
});

test('row listeners are notified; disable clears imagery with a render; destroy unsubscribes', async () => {
  const h = harness();
  let notified = 0;
  h.layer.setRowControlsListener(() => {
    notified += 1;
  });
  await enabled(h);
  assert.ok(notified > 0);
  const renders = h.renderRequests.length;
  h.layer.disable(h.viewer);
  assert.equal(h.imagery.calls.at(-1)[0], 'clear');
  assert.ok(h.renderRequests.length > renders);
  assert.equal(
    await h.layer.update(h.viewer, {}),
    false,
    'a disabled layer cannot refresh',
  );
  h.layer.destroy(h.viewer);
  assert.equal(h.imagery.calls.at(-1)[0], 'destroy');
  h.events.dispatchEvent(
    new CustomEvent('gev:map-stack-changed', {
      detail: { activeStack: { id: 'photoreal' } },
    }),
  );
  assert.notEqual(
    h.layer.getStats().status,
    'idle',
    'a destroyed layer no longer listens',
  );
});

/** The Layers row text, rendered by the real panel with a fixed "just now". */
function rowText(stats) {
  return LayerPanel.prototype._buildMetaText.call(
    { _timeAgo: () => 'just now' },
    {
      id: 'weather-overlays',
      source: 'NOAA GMGSI satellite',
      enabled: true,
      lifecycleState: 'enabled',
      stats,
    },
  );
}

test('the Layers panel renders every status shape as the spec states', async () => {
  const h = harness();
  await enabled(h);
  assert.equal(
    rowText(h.layer.getStats()),
    'NOAA GMGSI satellite · 15:00 UTC · 80 min old · just now',
  );
  h.table.clouds = new Error('offline');
  await h.layer.update(h.viewer, {});
  assert.equal(
    rowText(h.layer.getStats()),
    'STALE · NOAA GMGSI satellite · 15:00 UTC · Overlay source unavailable — showing 15:00 UTC',
  );

  const temperature = harness();
  temperature.layer.setParams(
    { mode: 'temperature' },
    { origin: 'local-restore' },
  );
  await enabled(temperature);
  assert.equal(
    rowText(temperature.layer.getStats()),
    'NOAA GFS model · valid 15:00 UTC · just now',
  );

  const keyless = harness({
    answers: {
      'air-quality': {
        mode: 'air-quality',
        googleConfigured: false,
        available: false,
        reason: 'not-configured',
        time: null,
        stale: false,
      },
    },
  });
  keyless.layer.setParams({ mode: 'air-quality' }, { origin: 'user' });
  await enabled(keyless);
  assert.equal(
    rowText(keyless.layer.getStats()),
    'UNAVAILABLE · Google Air Quality · Google Maps API key not configured',
  );

  const cold = harness({ answers: { clouds: new Error('offline') } });
  await enabled(cold);
  assert.equal(
    rowText(cold.layer.getStats()),
    'UNAVAILABLE · NOAA GMGSI satellite · Overlay source unavailable',
  );

  const loading = harness({ answers: { clouds: new Promise(() => {}) } });
  loading.layer.init(loading.viewer);
  loading.layer.enable(loading.viewer);
  void loading.layer.update(loading.viewer, {});
  assert.equal(
    rowText(loading.layer.getStats()),
    'NOAA GMGSI satellite · Loading',
  );

  const hidden = harness();
  hidden.layer.attachMapStack({ getActiveId: () => 'photoreal' });
  await enabled(hidden);
  assert.equal(
    rowText(hidden.layer.getStats()),
    'NOAA GMGSI satellite · Hidden by Google 3D map source',
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/layers/weather-overlays/index.test.mjs`
Expected: FAIL with `Cannot find module` for `./index.js`.

- [ ] **Step 3: Add the credits**

In `src/data/dataCredits.js`, directly after the `IEM_NEXRAD_CREDIT` declaration (its closing `});`), add:

```js

export const NOAA_GMGSI_CREDIT = Object.freeze({
  key: 'noaa-gmgsi',
  html: 'Clouds: <a href="https://nowcoast.noaa.gov/" target="_blank" rel="noopener">NOAA nowCOAST</a> GMGSI geostationary satellite mosaic',
});

export const NOAA_GFS_CREDIT = Object.freeze({
  key: 'noaa-gfs',
  html: 'Temperature: NOAA NCEP GFS via <a href="https://pae-paha.pacioos.hawaii.edu/erddap/griddap/ncep_global.html" target="_blank" rel="noopener">PacIOOS ERDDAP</a>',
});

export const GOOGLE_AIR_QUALITY_CREDIT = Object.freeze({
  key: 'google-air-quality',
  html: 'Air quality overlay: Source: Includes air quality data from Google',
});

export const GOOGLE_POLLEN_CREDIT = Object.freeze({
  key: 'google-pollen',
  html: 'Pollen overlay: Source: Includes pollen data from Google',
});
```

- [ ] **Step 4: Write the layer**

`src/layers/weather-overlays/index.js`:

```js
import { swapToFrame } from '../weather-imagery/frameImagery.js';
import { normalizeImageryOpacity } from '../weather-imagery/opacity.js';
import { buildRowControls } from './controls.js';
import { createOverlayImagery } from './imagery.js';
import {
  DEFAULT_MODE,
  DEFAULT_OPACITY,
  DEFAULT_POLLEN_TYPE,
  MODE_INFO,
  normalizeMode,
  normalizePollenType,
  overlayKey,
  sourceName,
} from './modes.js';

export const REFRESH_MS = 10 * 60 * 1000;
export const SWAP_CHECK_MS = 1000;
const MAP_STACK_EVENT = 'gev:map-stack-changed';
const RENDER_REASON = 'weather-overlays';

const hhmm = (timeMs) => new Date(timeMs).toISOString().slice(11, 16);

export function createWeatherOverlaysLayer({
  fetchImpl = (...args) => fetch(...args),
  createImagery = createOverlayImagery,
  registerCredit = () => false,
  credits = {},
  eventTarget = globalThis.window,
  isVisible = () => globalThis.document?.visibilityState !== 'hidden',
  timers = {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (timer) => clearTimeout(timer),
  },
  now = Date.now,
  requestRender = () => {},
} = {}) {
  let viewer = null;
  let imagery = null;
  let enabled = false;
  let mode = DEFAULT_MODE;
  let pollenType = DEFAULT_POLLEN_TYPE;
  let opacity = DEFAULT_OPACITY;
  let targetTime = null;
  let lastUpdate = null;
  let error = null;
  let stale = false;
  let unavailableReason = null;
  let loading = false;
  let googleConfigured = null;
  let mapStackId = null;
  let mapStackController = null;
  let rowListener = null;
  let request = null;
  let swapTimer = null;

  const currentKey = () => overlayKey(mode, pollenType);
  const notifyRows = () => rowListener?.();
  const onMapStack = (event) => {
    mapStackId = event?.detail?.activeStack?.id ?? mapStackId;
    notifyRows();
  };

  function clearTimer(timer) {
    if (timer) timers.clearTimeout(timer);
    return null;
  }

  function renderTarget() {
    if (!imagery) return;
    if (targetTime === null) {
      swapTimer = clearTimer(swapTimer);
      imagery.clear();
    } else if (swapToFrame(imagery, targetTime)) {
      swapTimer = clearTimer(swapTimer);
    } else if (!swapTimer && isVisible()) {
      // Do not re-arm while hidden: the next update() re-evaluates the swap.
      swapTimer = timers.setTimeout(() => {
        swapTimer = null;
        if (enabled) renderTarget();
      }, SWAP_CHECK_MS);
    }
    notifyRows();
    requestRender(RENDER_REASON);
  }

  function resetForKeyChange() {
    swapTimer = clearTimer(swapTimer);
    request?.abort();
    request = null;
    loading = false;
    targetTime = null;
    error = null;
    stale = false;
    unavailableReason = null;
    imagery?.setSource(currentKey());
    requestRender(RENDER_REASON);
  }

  function shownDetail(name, shown) {
    if (mode === 'clouds') {
      const ageMinutes = Math.max(0, Math.floor((now() - shown) / 60_000));
      return `${name} · ${hhmm(shown)} UTC · ${ageMinutes} min old`;
    }
    if (mode === 'temperature') return `${name} · valid ${hhmm(shown)} UTC`;
    return name;
  }

  const layer = {
    id: 'weather-overlays',
    name: 'Weather Overlays',
    icon: '🌡️',
    source: MODE_INFO[DEFAULT_MODE].name,
    updateInterval: REFRESH_MS,

    init(nextViewer) {
      viewer = nextViewer;
      imagery = createImagery(nextViewer);
      imagery.setAlpha(opacity);
      eventTarget?.addEventListener?.(MAP_STACK_EVENT, onMapStack);
    },

    attachMapStack(mapStack) {
      mapStackController = mapStack ?? null;
      notifyRows();
    },

    enable(nextViewer) {
      enabled = true;
      registerCredit(nextViewer, credits[mode]);
      imagery?.setSource(currentKey());
    },

    disable() {
      enabled = false;
      swapTimer = clearTimer(swapTimer);
      request?.abort();
      request = null;
      loading = false;
      targetTime = null;
      error = null;
      stale = false;
      unavailableReason = null;
      imagery?.clear();
      notifyRows();
      requestRender(RENDER_REASON);
    },

    async update(_viewer, { signal } = {}) {
      if (!enabled || !imagery) return false;
      // The manager treats `false` as a failed refresh; skipping a hidden tab is not one.
      if (!isVisible() && targetTime !== null) return true;
      const key = currentKey();
      request?.abort();
      const controller = new AbortController();
      request = controller;
      signal?.addEventListener?.('abort', () => controller.abort(), {
        once: true,
      });
      loading = true;
      notifyRows();
      try {
        const response = await fetchImpl(
          `/api/weather-overlays/manifest?mode=${key}`,
          { signal: controller.signal },
        );
        const payload = await response.json().catch(() => null);
        if (typeof payload?.googleConfigured === 'boolean') {
          googleConfigured = payload.googleConfigured;
        }
        if (!response.ok) {
          throw new Error(`overlay manifest HTTP ${response.status}`);
        }
        // Superseded by a newer request or a mode switch: not a failure.
        if (!enabled || key !== currentKey() || request !== controller) {
          return true;
        }
        loading = false;
        lastUpdate = now();
        if (payload?.available === false) {
          unavailableReason =
            payload.reason === 'not-configured'
              ? 'Google Maps API key not configured'
              : 'Overlay unavailable';
          error = null;
          stale = false;
          targetTime = null;
          renderTarget();
          return true;
        }
        const time = Number(payload?.time);
        if (!Number.isFinite(time) || time <= 0) {
          throw new Error('malformed overlay manifest');
        }
        unavailableReason = null;
        error = null;
        stale = payload.stale === true;
        targetTime = time;
        renderTarget();
        return true;
      } catch (failure) {
        if (signal?.aborted) return false;
        if (controller.signal.aborted) return true;
        loading = false;
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
      const name = sourceName(mode, pollenType);
      const countLabel = MODE_INFO[mode].short;
      const shown = imagery?.shownTime() ?? null;
      const activeStackId = mapStackController
        ? (mapStackController.getActiveId?.() ?? null)
        : mapStackId;
      if (activeStackId === 'photoreal') {
        return {
          status: 'idle',
          source: name,
          statusMessage: 'Hidden by Google 3D map source',
          countLabel,
        };
      }
      if (unavailableReason) {
        return {
          status: 'unavailable',
          source: name,
          error: unavailableReason,
          countLabel,
        };
      }
      if (error && shown === null) {
        return {
          status: 'unavailable',
          source: name,
          error: 'Overlay source unavailable',
          countLabel,
        };
      }
      if ((error || stale) && shown !== null) {
        return {
          stale: true,
          source: `${name} · ${hhmm(shown)} UTC`,
          error: `Overlay source unavailable — showing ${hhmm(shown)} UTC`,
          lastUpdate,
          countLabel,
        };
      }
      if (loading && shown === null) {
        return {
          loading: true,
          source: name,
          loadingLabel: 'Loading',
          countLabel,
        };
      }
      if (shown === null) {
        return { status: 'ok', source: name, lastUpdate, countLabel };
      }
      return {
        status: 'ok',
        source: shownDetail(name, shown),
        lastUpdate,
        countLabel,
      };
    },

    getParams() {
      return { mode, pollenType, opacity };
    },

    setParams(params = {}) {
      const next = {};
      if (Object.hasOwn(params, 'mode')) {
        next.mode = normalizeMode(params.mode);
        if (!next.mode) return false;
      }
      if (Object.hasOwn(params, 'pollenType')) {
        next.pollenType = normalizePollenType(params.pollenType);
        if (!next.pollenType) return false;
      }
      if (Object.hasOwn(params, 'opacity')) {
        next.opacity = normalizeImageryOpacity(params.opacity);
        if (next.opacity === null) return false;
      }

      if (Object.hasOwn(next, 'opacity') && next.opacity !== opacity) {
        opacity = next.opacity;
        imagery?.setAlpha(opacity);
        requestRender(RENDER_REASON);
      }
      const previousKey = currentKey();
      const previousMode = mode;
      if (next.mode) mode = next.mode;
      if (next.pollenType) pollenType = next.pollenType;
      if (currentKey() !== previousKey) {
        resetForKeyChange();
        if (enabled) {
          if (mode !== previousMode) registerCredit(viewer, credits[mode]);
          void layer.update(viewer, {});
        }
      }
      notifyRows();
      return true;
    },

    getRowControls() {
      return buildRowControls({ mode, pollenType, opacity, googleConfigured });
    },

    setRowControlsListener(listener) {
      rowListener = typeof listener === 'function' ? listener : null;
    },
  };

  return layer;
}
```

- [ ] **Step 5: Write the concrete instance**

`src/data/weatherOverlays.js`:

```js
import { createWeatherOverlaysLayer as createLayer } from '../layers/weather-overlays/index.js';
import {
  GOOGLE_AIR_QUALITY_CREDIT,
  GOOGLE_POLLEN_CREDIT,
  NOAA_GFS_CREDIT,
  NOAA_GMGSI_CREDIT,
  registerDynamicCredit,
} from './dataCredits.js';
import { governorRequestRender } from '../renderGovernor.js';

export * from '../layers/weather-overlays/index.js';

/** Wire real credits and the render governor; everything else uses browser defaults. */
export function createWeatherOverlaysLayer(options = {}) {
  return createLayer({
    registerCredit: registerDynamicCredit,
    credits: {
      clouds: NOAA_GMGSI_CREDIT,
      temperature: NOAA_GFS_CREDIT,
      'air-quality': GOOGLE_AIR_QUALITY_CREDIT,
      pollen: GOOGLE_POLLEN_CREDIT,
    },
    requestRender: governorRequestRender,
    ...options,
  });
}

export default createWeatherOverlaysLayer();
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test src/layers/weather-overlays/index.test.mjs`
Expected: PASS, 10 tests.

- [ ] **Step 7: Commit**

```bash
git add src/layers/weather-overlays/index.js src/layers/weather-overlays/index.test.mjs src/data/weatherOverlays.js src/data/dataCredits.js
git commit -m "feat(weather-overlays): data layer with modes, swaps and status

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Registration, package wiring, docs and CI parity

**Files:**
- Modify: `src/app/data.js`, `package.json` (`exports`), `scripts/package-boundaries.json`, `scripts/format-scope.json`, `DATA_SOURCES.md`, `CHANGELOG.md`

**Interfaces:**
- Consumes:
  - the Task 8 default export of `src/data/weatherOverlays.js`;
  - the Task 4 plugin, already registered;
  - `createApplicationData({ scene: { viewer, mapStackController }, … })` in `src/app/data.js`.
- Produces: the layer in the production catalog (so `finalizeRegistrations(LAYER_STATE_REGISTRY)` finds the Task 5 entry), and a green CI-parity run.

- [ ] **Step 1: Register the layer**

In `src/app/data.js`, directly after `import weatherRadarLayer from '../data/weatherRadar.js';` add:

```js
import weatherOverlaysLayer from '../data/weatherOverlays.js';
```

Directly after `  weatherRadarLayer.attachMapStack(mapStackController);` add:

```js
  dataManager.register(weatherOverlaysLayer);
  weatherOverlaysLayer.attachMapStack(mapStackController);
```

- [ ] **Step 2: Declare the package exports**

In `package.json` `exports`, directly after the `"./server/providers/weather-report": { … },` entry add:

```json
    "./server/providers/weather-overlays": {
      "node": "./server/providers/weather-overlays.js"
    },
```

and directly after `"./layers/weather-radar": "./src/layers/weather-radar/index.js",` add:

```json
    "./layers/weather-overlays": "./src/layers/weather-overlays/index.js",
```

- [ ] **Step 3: Add the boundary groups**

In `scripts/package-boundaries.json`, directly before `  "firms-provider": {` add:

```json
  "weather-overlays-provider": {
    "runtime": "node",
    "exports": ["./server/providers/weather-overlays"],
    "modules": [
      "server/providers/weather-overlays.js",
      "server/providers/weather-overlays/render.js",
      "server/providers/weather-overlays/sources.js",
      "src/layers/weather-overlays/modes.js",
      "src/layers/weather-overlays/palette.js",
      "server/providers/places/google-key.js",
      "scripts/google-server-key.mjs",
      "server/providers/common/rate-limit.js",
      "server/providers/common/http.js"
    ],
    "external": []
  },
```

Directly before `  "weather-report": {` add:

```json
  "weather-overlays-layer": {
    "exports": ["./layers/weather-overlays"],
    "modules": [
      "src/layers/weather-imagery/frameImagery.js",
      "src/layers/weather-imagery/opacity.js",
      "src/layers/weather-overlays/controls.js",
      "src/layers/weather-overlays/imagery.js",
      "src/layers/weather-overlays/index.js",
      "src/layers/weather-overlays/modes.js",
      "src/layers/weather-overlays/palette.js"
    ],
    "external": ["cesium"]
  },
```

In the `"application-components"` group, directly before `"src/data/weatherRadar.js",` add `"src/data/weatherOverlays.js",`. Directly before its `"src/layers/weather-radar/controls.js",` line, and after the two `weather-imagery` lines from Task 1, add:

```json
      "src/layers/weather-overlays/controls.js",
      "src/layers/weather-overlays/imagery.js",
      "src/layers/weather-overlays/index.js",
      "src/layers/weather-overlays/modes.js",
      "src/layers/weather-overlays/palette.js",
```

- [ ] **Step 4: Run the boundary check**

Run: `npm run check:boundaries`
Expected: exit 0, with these lines among the output:
```
Checked weather-overlays-provider: 1 exports, 9 owned modules.
Checked weather-radar-layer: 1 exports, 6 owned modules.
Checked weather-overlays-layer: 1 exports, 7 owned modules.
```
If it reports `imports an unowned module`, the named file is a real import. Add it to that group only if the group owns it.

- [ ] **Step 5: Bring the remaining files into formatting scope**

In `scripts/format-scope.json`, directly after the three `weather-imagery` entries from Task 1, add:

```json
  "server/providers/weather-overlays.js",
  "server/providers/weather-overlays/render.js",
  "server/providers/weather-overlays/sources.js",
  "src/data/weatherOverlays.js",
  "src/data/weatherOverlaysProxy.test.mjs",
  "src/data/weatherOverlaysRender.test.mjs",
  "src/data/weatherOverlaysSources.test.mjs",
  "src/layers/weather-overlays/controls.js",
  "src/layers/weather-overlays/controls.test.mjs",
  "src/layers/weather-overlays/imagery.js",
  "src/layers/weather-overlays/imagery.test.mjs",
  "src/layers/weather-overlays/index.js",
  "src/layers/weather-overlays/index.test.mjs",
  "src/layers/weather-overlays/modes.js",
  "src/layers/weather-overlays/palette.js",
```

Run: `npm run format`, then `npm run format:check`
Expected: the check exits 0. The code blocks above are already formatted, so `format` should change nothing in these files.

- [ ] **Step 6: Document the sources**

In `DATA_SOURCES.md`, in the live-sources table, directly after the **Iowa Environmental Mesonet** row add:

```markdown
| **NOAA nowCOAST GMGSI** (Global Mosaic of Geostationary Satellite Imagery, longwave infrared WMS) | Cloud cover mode of the Weather Overlays layer | NOAA/NESDIS product served by NOAA nowCOAST; U.S. Government work (public domain); courtesy attribution. Tiles are proxied and held in server memory through `/api/weather-overlays` | "Clouds: NOAA nowCOAST GMGSI geostationary satellite mosaic", registered when cloud cover is first shown |
| **NOAA NCEP GFS** 2 m temperature via **PacIOOS ERDDAP** (`ncep_global`) | Temperature mode of the Weather Overlays layer: a 1° global grid rendered into colour tiles server-side | NOAA model output (U.S. public domain); the PacIOOS dataset licence allows free use and redistribution | "Temperature: NOAA NCEP GFS via PacIOOS ERDDAP", registered when temperature is first shown |
| **Google Maps Platform Air Quality API** (US_AQI heatmap tiles) | Air quality mode of the Weather Overlays layer | Google Maps Platform Terms and Air Quality API policies (your own key and billing). Tiles are never cached (server `Cache-Control: no-store`); a server-wide in-memory daily tile budget (`GEV_GOOGLE_OVERLAY_TILES_PER_DAY`, default 25,000, resets at UTC midnight) bounds request volume — also set per-API daily quotas in Google Cloud Console for hard spend protection | "Source: Includes air quality data from Google" on the globe credit line while the overlay is drawn, and in Data attribution |
| **Google Maps Platform Pollen API** (TREE_UPI, GRASS_UPI, WEED_UPI heatmap tiles) | Pollen mode of the Weather Overlays layer | Google Maps Platform Terms and Pollen API policies (your own key and billing). Tiles are never cached (server `Cache-Control: no-store`; the Pollen API policy prohibits caching/storage); the same daily tile budget as Air Quality above applies — also set per-API daily quotas in Google Cloud Console for hard spend protection | "Source: Includes pollen data from Google" on the globe credit line while the overlay is drawn, and in Data attribution |
```

At the top of `CHANGELOG.md`, directly under `# Changelog` and its blank line, add:

```markdown
## Weather overlays layer (fork)

- Add a Weather Overlays layer with four modes, one shown at a time: cloud cover (NOAA GMGSI
  geostationary infrared, hourly), 2 m temperature (NOAA GFS via PacIOOS ERDDAP, rendered into
  colour tiles), Google Air Quality (US AQI) and Google Pollen (tree, grass or weed).
- Row controls for mode, pollen type and 40/70/100% opacity, with a legend per mode. Mode, pollen
  type and opacity travel in share links (layer token `o`).
- Served through a `/api/weather-overlays` proxy with separate manifest and tile rate limits and an
  in-memory tile cache pruned by age. Google modes report "Google Maps API key not configured"
  without a key, and every mode reports when the Google 3D map source hides it.
- Weather Radar and Weather Overlays now share one frame-imagery helper; overlays sit directly above
  the base map, so radar draws on top.
```

- [ ] **Step 7: Run the full CI-parity sequence**

Run each in order, stopping at the first failure:

```bash
npm run format:check
npm run check:boundaries
npm test
npm run build
```

Expected: all four exit 0. `npm test` discovers every `*.test.mjs`, including the eight new files and the unchanged radar tests.

- [ ] **Step 8: Smoke-check the proxy once against the live sources**

Keep this to the minimum:
- Start the dev server in the background on a free port: `npx vite --port 5314 --strictPort`. The key is read from the environment as usual, so do not echo it.
- Do not open the app, so no AISStream connection is spent.

Then run:

```bash
B=http://localhost:5314/api/weather-overlays
for m in clouds temperature air-quality pollen-grass; do curl -s "$B/manifest?mode=$m"; echo; done
CT=$(curl -s "$B/manifest?mode=clouds" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).time')
curl -s -o /dev/null -w '%{http_code} %{content_type} %{size_download}\n' "$B/tiles/clouds/$CT/3/2/3.png"
```

Expected (as measured while planning):
- **Manifests:** every one answers `"available":true`; air quality and pollen answer `"available":false,"reason":"not-configured"` when no key is set.
- **Cloud tile:** `200 image/png`, about 45 KB.

Stop the dev server by the port listener's PID (`netstat -ano | grep :5314`, then `taskkill //PID <pid> //F //T`), not by the background job PID. Confirm that `curl` then gets connection refused.

Optionally view the Clouds mode in the app once to confirm that clear sky is transparent at threshold 0.3 (spec Risks).

- [ ] **Step 9: Commit**

```bash
git add src/app/data.js package.json scripts/package-boundaries.json scripts/format-scope.json DATA_SOURCES.md CHANGELOG.md
git commit -m "feat(weather-overlays): register the layer, package boundaries and docs

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
