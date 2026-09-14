# Weather radar layer — design

Status: approved design (2026-09-14), not yet implemented
Fork: CaptPat/gods-eye-view (Cyclops View). Fork-only work; nothing is proposed upstream.

## Purpose

Show where precipitation is falling, anywhere on the globe, with a two-hour loop to see how it
moves. Over the contiguous US, an optional high-detail mode switches to NEXRAD.

## Place in the weather suite

This is the first of five sub-projects. Each has its own spec, plan and build, in this order:

1. **Weather radar** (this document). It establishes the transparent imagery-overlay pattern.
2. **Click-for-weather card:** click empty ground for current conditions and short, long and
   marine forecasts. The source choice between Google Weather API and Open-Meteo is made in that
   design.
3. **Tide stations and current stations:** two NOAA CO-OPS point layers.
4. **Gridded overlays:** cloud cover, temperature, and Google Air Quality and Pollen heatmaps.
   These reuse this document's overlay pattern.
5. **Severe weather:** an on/off data layer like Dams and Fires. Candidate sources are NWS active
   alerts (US; most alerts reference forecast zones), GDACS (global events) and Google Weather
   `publicAlerts:lookup` (point lookup).

## Sources (measured 2026-09-14)

| Source | What was measured | Consequence |
|---|---|---|
| RainViewer manifest `https://api.rainviewer.com/public/weather-maps.json` | 13 past frames at 10-minute steps (2 h); no nowcast frames; no satellite frames | Worldwide loop covers 2 h |
| RainViewer tiles `{host}{path}/256/{z}/{x}/{y}/{color}/{smooth}_{snow}.png` | Zoom 7 is the maximum (a zoom 8 request returns a 1.4 KB empty tile). Colour schemes 0–8 return byte-identical images (Universal Blue); 255 returns raw data | `maximumLevel: 7`; request scheme 2 with `1_1` options |
| RainViewer terms | "free for personal or educational use only"; credit with a link to `https://www.rainviewer.com/` requested | Acceptable for this personal fork; credit required |
| IEM `cgi-bin/wms/nexrad/n0q-t.cgi`, layer `nexrad-n0q-wmst` | Distinct images for now, −1 h, −2 h and −30 d at 5-minute boundaries (`time=YYYY-MM-DDTHH:MM:00Z`) | US detail frames are fetched by time |
| IEM `cgi-bin/wms/nexrad/n0q.cgi`, layer `nexrad-n0q` | Byte-identical image for all four times: `time` is ignored | Must not be used for frames |
| Google Maps Platform Weather API | Point data only (current, hourly, daily, 24 h history); no overlay tiles | Not used by this layer |

## Scope

In scope:
- a reflectivity overlay above the base map;
- live refresh and a two-hour loop;
- the US-detail toggle;
- three opacity steps and a per-source legend;
- data credits;
- a status note when the Google 3D map source hides the overlay.

Out of scope:
- other radar products (velocity, echo tops);
- forecast frames;
- recolouring RainViewer tiles;
- drawing radar over Google 3D photorealistic tiles;
- cockpit-specific behaviour;
- archive or replay integration. The frame model keeps "frame at or before time T" available
  for that later work.

## Architecture

### Server: `server/providers/weather-radar.js`

A Vite plugin, `weatherRadarProxy()`, registered in `localProviderPlugins()` in
`server/providers/local.js`. It follows the existing provider conventions:
- `makeRateLimiter` per client and globally;
- `coalesceProxyRequest` per upstream URL;
- a disk cache under `.gev-cache/radar/`;
- a 15 s upstream timeout and a 2 MB response cap;
- a `User-Agent` identifying the fork;
- JSON error bodies `{ error }` with status 400, 404, 429 or 502.

Upstream failures are never cached.

Routes:

- `GET /api/radar/frames?source=rainviewer|iem` →
  `{ source, frames: [{ time }], generatedAt, stale }`, where `time` is epoch milliseconds,
  oldest first.
  - `rainviewer`: taken from the manifest's `radar.past`. The manifest is cached for 120 s.
    Each frame's upstream `host` and `path` stay server-side, and the client never sees them.
    If a refresh fails, the last good manifest is served with `stale: true`.
  - `iem`: 13 synthesized times at 10-minute steps. The newest is the most recent 10-minute
    boundary at least 5 minutes in the past.
- `GET /api/radar/rainviewer/:time/:z/:x/:y.png` fetches
  `{host}{path}/256/{z}/{x}/{y}/2/1_1.png`.
  - Rejected with 404 unless `time` is in the current manifest.
  - Rejected with 400 unless `z` is an integer 0–7 and `x`, `y` are integers in `[0, 2^z)`.
  - Cached at `.gev-cache/radar/rainviewer/<time>/<z>/<x>/<y>.png`. A time's directory is
    removed during a manifest refresh once that time has been out of the manifest for 1 h.
- `GET /api/radar/iem?time=<ISO-8601 UTC>&bbox=<w,s,e,n>&width=<px>&height=<px>` fetches `n0q-t.cgi` with `service=WMS`,
  `version=1.1.1`, `request=GetMap`, `layers=nexrad-n0q-wmst`, `srs=EPSG:4326`,
  `format=image/png`, `transparent=true` and the given values.
  - Rejected with 400 unless:
    - `time` is a 5-minute boundary within the last 6 hours;
    - the bbox lies within `[-135, 0, -45, 67.5]` and spans at most 70° × 35°. This envelope is
      the contiguous US widened to Cesium's level-3 geographic tile edges (22.5° grid), so every
      tile the client requests passes;
    - width and height are integers 1–512.
  - Cached at `.gev-cache/radar/iem/<sha1 of normalized params>.png`: 5 minutes for frames
    younger than 15 minutes, 24 hours otherwise.

### Client: `src/layers/weather-radar/`

Follows the earthquakes layer's structure, with `src/data/weatherRadar.js` supplying concrete
dependencies and the default instance. The layer is registered in `src/standalone/data.js`.

- **`frames.js`**: pure logic, no Cesium.
  - `parseFramesPayload(payload)`: validates and sorts.
  - `pruneFrames(frames, nowMs, retainMs = 7_200_000)`.
  - `newestFrame(frames)` and `frameAtOrBefore(frames, timeMs)`.
  - `nextLoopStep(index, count)`: returns `{ index, delayMs }`, with 500 ms per frame and a
    1500 ms hold on the newest.
- **`imagery.js`**: `createRadarImagery(viewer)`. Returns
  `{ syncFrames(frames, source), show(frame), setAlpha(alpha), clear(), readyCount() }`.
  - One `Cesium.ImageryLayer` per retained frame, added with `viewer.imageryLayers.add(layer)`
    so it sits above the base map at index 0.
  - Providers are `UrlTemplateImageryProvider`:
    - RainViewer: `/api/radar/rainviewer/<time>/{z}/{x}/{y}.png`, Web Mercator tiling,
      `maximumLevel: 7`.
    - IEM: `/api/radar/iem?time=<iso>&bbox={westDegrees},{southDegrees},{eastDegrees},{northDegrees}&width={width}&height={height}`
      with `GeographicTilingScheme`, `tileWidth`/`tileHeight` 256, `minimumLevel: 3`,
      `maximumLevel: 9`, `rectangle` `[-130, 20, -60, 55]` degrees. Level 3 is the coarsest
      geographic level whose tiles (22.5°) fit the proxy's 70° × 35° span limit; the rectangle
      keeps requests over the contiguous US.
  - Preloading frames stay `show: true` with `alpha: 0.001`, so Cesium requests their tiles.
    A frame counts as ready once it has been added and `scene.globe.tileLoadProgressEvent`
    has reported 0 pending tiles.
  - Switching frames sets the new frame to the opacity option, and the previous frame to
    0.001 or removes it.
  - `clear()` removes every radar imagery layer. The base-map switcher only replaces its own
    index-0 layer, so radar layers survive base-map changes.
- **`controls.js`**: `buildRowControls(state)` returns the `{ chips, legend }` the Layers panel
  renders.
  - Chips:
    - `loop` (label `▶ Loop` or `❚❚ Pause`, params `{ loop: !playing }`);
    - `us-detail` (label `US detail`, active when on, params `{ usDetail: !usDetail }`);
    - `opacity-40`, `opacity-70`, `opacity-100` (params `{ opacity: 0.4 | 0.7 | 1 }`).
  - Legend, four swatches from RainViewer's published colour table
    (`https://www.rainviewer.com/files/rainviewer_api_colors_table.csv`):
    - RainViewer ("Universal Blue" column): Light (20 dBZ) `#00a3e0`, Moderate (30) `#005588`,
      Heavy (50) `#c10000`, Extreme (65) `#ffffff`.
    - US detail ("NEXRAD Level III" column, the NWS palette IEM uses): Light `#00ff00`,
      Moderate `#087305`, Heavy `#ff0000`, Extreme `#fe00fe`.
- **`index.js`**: `createWeatherRadarLayer({ fetchImpl, createImagery, registerCredit, credits,
  eventTarget, isVisible, timers, now })`; `src/data/weatherRadar.js` supplies the real credits.
  - Returns `{ id: 'weather-radar', name: 'Weather Radar', icon: '🌧️', init, enable, disable,
    update, destroy, getStats, getParams, setParams, getRowControls, setRowControlsListener,
    attachMapStack }`.
  - `attachMapStack({ getActiveId })` receives `MapStackController` at registration. The layer
    also listens for the window event `gev:map-stack-changed` (`detail.activeStack.id`).
  - `update()` resolves `false` only when the manager's signal aborted: `DataLayerManager`
    treats `false` as a failed enable or refresh. Skips, superseded requests and handled
    failures resolve `true`, and failures surface through `getStats().error`.

## Behaviour

- **Enable:** fetch frames for the current source, retain the 2 hours back from the newest frame
  (counting from the clock would drop the 13th frame to upstream latency), show the newest.
- **Refresh:** every 5 minutes while enabled and `document.visibilityState === 'visible'`. A new
  newest frame is shown only once ready. Frames more than 2 hours older than the newest are pruned
  and their imagery layers removed.
- **Loop:** `setParams({ loop: true })` starts stepping from the oldest ready frame to the
  newest, using `nextLoopStep`. Frames not yet ready are skipped. Pause (`loop: false`) returns
  to the newest frame. While looping, every retained frame is preloaded; otherwise only the
  current and next newest.
- **US detail:** `setParams({ usDetail })` switches the frame source and provider type, then
  clears and rebuilds the frames. No automatic switching by camera position.
- **Opacity:** one of 0.4, 0.7 (default) or 1.0, applied to the shown frame.
- **Google 3D:** when the active map stack is `photoreal`, the overlay stays managed but cannot
  appear (the photorealistic tileset covers the globe surface). The status reports it and
  nothing switches automatically.
- **Status** (`getStats()`, rendered by `layerPanel._buildMetaText`). `<name>` is `RainViewer`,
  or `Iowa State NEXRAD` in US detail. Times are UTC `HH:MM` of the shown frame; `<age>` is
  whole minutes since that frame.
  - normal: `{ status: 'ok', source: '<name> · 04:50 UTC · 6 min old', count: <retained frames>,
    lastUpdate: <epoch ms of last successful frames fetch> }`;
  - while frames load: `{ loading: true, source: '<name> · Loading 9/13' }`, where 9 is
    `readyCount()` and 13 the retained frames;
  - stale manifest or a failed refresh with a frame still shown:
    `{ stale: true, source: '<name> · 04:30 UTC', error: 'Radar source unavailable — showing 04:30 UTC' }`;
  - no frame at all: `{ status: 'unavailable', source: '<name>', error: 'Radar source unavailable' }`;
  - Google 3D active: `{ status: 'idle', source: '<name>', statusMessage: 'Hidden by Google 3D map source' }`.
    `idle` is a guidance status, so the row shows `<name> · Hidden by Google 3D map source`
    without reporting a fault.

## State and sharing

- `LAYER_STATE_REGISTRY` in `src/data/layerState.js` gains
  `{ id: 'weather-radar', token: 'p', disposition: 'enabled+options', optionOwner: 'weather-radar' }`.
  Token `p` is unused.
- `OPTION_GROUPS['weather-radar']`:
  - `{ key: 'usDetail', token: 'u', defaultValue: false, normalize: boolean or null,
    encode: v => (v ? '1' : '0'), decode: '1' → true, '0' → false, else null }`.
  - `{ key: 'opacity', token: 'o', defaultValue: 0.7, normalize: snap to 0.4 | 0.7 | 1 or null,
    encode: v => String(Math.round(v * 100)), decode: '40' | '70' | '100' → number, else null }`.
- The loop state is not persisted.

## Credits and terms

In `src/data/dataCredits.js`, registered with `registerDynamicCredit(viewer, credit)` (idempotent,
the TomTom pattern):
- `RAINVIEWER_CREDIT` on first enable:
  `Radar: <a href="https://www.rainviewer.com/" target="_blank" rel="noopener">RainViewer</a>`;
- `IEM_NEXRAD_CREDIT` on first US detail:
  `US radar: <a href="https://mesonet.agron.iastate.edu/" target="_blank" rel="noopener">Iowa Environmental Mesonet</a> NEXRAD`.

`DATA_SOURCES.md` gains both rows, including RainViewer's personal/educational-use condition.

## Failures and validation

- A frames request failure with frames already shown keeps the current frame and reports stale.
  With nothing shown, it reports unavailable. The next refresh retries on the normal 5-minute
  cadence; there is no faster retry loop.
- Tile failures return an error status from the proxy, uncached. Cesium leaves that tile empty.
- US detail failure reports the same way. It never silently falls back to RainViewer.
- Proxy validation (above) prevents fetching arbitrary upstream paths, times or sizes.

## Testing

Colocated `*.test.mjs`, `node:test`, no live network:

- `src/data/weatherRadarProxy.test.mjs` mounts the plugin through the Vite config, as existing
  provider tests do, with a recorded manifest fixture
  `src/data/fixtures/rainviewer-weather-maps.json` and PNG bytes built in the test. It covers:
  - frames for both sources, including `stale`;
  - each validation rejection;
  - cache hit versus miss;
  - upstream failure not cached;
  - rate-limit response.
- `src/layers/weather-radar/frames.test.mjs`: parsing, pruning, newest and at-or-before
  selection, loop stepping and hold.
- `src/layers/weather-radar/imagery.test.mjs` uses a fake `viewer.imageryLayers` and globe event.
  It covers:
  - one layer per frame, placed above the base;
  - alpha handling and readiness counting;
  - removal on `clear()`;
  - survival of an index-0 base replacement.
- `src/layers/weather-radar/controls.test.mjs`: chip labels, active states and params for each
  state; the legend per source.
- `src/layers/weather-radar/index.test.mjs`: lifecycle, refresh cadence with fake timers and
  visibility, loop start and stop, US-detail switch, Google 3D status from the initial id and
  from the event, and every stats shape.
- Layer-state tests cover token `p` and the option encode/decode round-trip.

`package.json` exports `./layers/weather-radar` and `./server/providers/weather-radar`.
`scripts/package-boundaries.json` gains a `weather-radar-layer` group (the files under
`src/layers/weather-radar/`, external `cesium`; like `earthquakes`, the `src/data/` wrapper stays
outside the export) and a `weather-radar-provider` group (the provider and the common helpers it
imports). `scripts/format-scope.json` includes the new files. The
fork's CI-parity sequence must pass: format check, boundaries, `npm test`, build.
`CHANGELOG.md` gains an entry.
