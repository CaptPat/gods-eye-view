# Weather overlays layer — design

Status: approved design (2026-09-14), not yet implemented
Fork: CaptPat/gods-eye-view (Cyclops View). Fork-only work; nothing is proposed upstream.

## Purpose

One Layers-panel row, **Weather Overlays**, that paints a gridded weather field over the globe. A
mode chip picks one of four fields, and only one shows at a time:

- **Clouds:** where the clouds are now, worldwide, from geostationary satellites.
- **Temp:** air temperature at 2 m, worldwide, from a numerical weather model.
- **Air:** air quality (US AQI) from Google.
- **Pollen:** the Universal Pollen Index from Google, for tree, grass or weed pollen.

It stacks with the Weather Radar layer: overlays draw directly above the base map and radar draws
above them.

## Place in the weather suite

Weather-suite sub-project 4 of 5. Each has its own spec, plan and build:

1. Weather radar (`2026-09-14-weather-radar-design.md`), which established the imagery-overlay
   pattern this layer reuses;
2. Right-click weather report (`2026-09-14-weather-report-design.md`);
3. Tide stations and current stations;
4. **Weather overlays** (this document);
5. Severe weather.

## Sources (measured 2026-09-14, 15:50–16:35 UTC)

Every candidate was measured with curl or node. Imagery that takes a time parameter was checked by
comparing image hashes across times, not by HTTP status.

### Google Air Quality heatmap tiles (with the fork's key)

| What was measured | Result |
|---|---|
| `GET https://airquality.googleapis.com/v1/mapTypes/{type}/heatmapTiles/2/0/1?key=…` for `US_AQI`, `UAQI_RED_GREEN`, `UAQI_INDIGO_PERSIAN`, `PM25_INDIGO_PERSIAN`, `GBR_DEFRA`, `DEU_UBA`, `CAN_EC`, `FRA_ATMO` | All HTTP 200, `image/png`, 256 × 256 RGBA, 17–55 KB, eight distinct hashes |
| An unknown type (`BOGUS`) | HTTP 400 JSON `INVALID_ARGUMENT` (recorded as `google-invalid-map-type.json`) |
| No `key` | HTTP 403 JSON `PERMISSION_DENIED`, "Method doesn't allow unregistered callers" (recorded as `google-no-key.json`) |
| Zoom range, central Europe and Houston columns | z0–z16 return 200; z17 returns 400 |
| Detail by zoom, US_AQI over Houston (distinct colours per tile) | z10 526, z12 188, z13 148, z14 47, z15 17, z16 1 |
| Coverage at z3 | Europe, India, Africa and North America tiles carry data; mid-Pacific is sparse (2.3 KB); Antarctica is a 674-byte blank |
| Colours in the US_AQI tile | `#00e400` dominates the clean-air areas, matching the EPA "Good" colour Google documents for `usa_epa` |
| Response caching headers | None (`Content-Type` and `nosniff` only) |

### Google Pollen heatmap tiles (with the fork's key)

| What was measured | Result |
|---|---|
| `GET https://pollen.googleapis.com/v1/mapTypes/{TREE_UPI\|GRASS_UPI\|WEED_UPI}/heatmapTiles/2/0/1?key=…` | All HTTP 200 PNG, 256 × 256 RGBA, three distinct hashes; `BOGUS` returns 400 |
| Zoom range | z0–z16 return 200; z17 returns 400 |
| Detail by zoom, GRASS_UPI over Houston | z9 161 colours, z10 202, z11 and above 1 (a uniform tile) |
| Colours sampled from TREE and GRASS tiles | `#009e3a`, `#84cf33`, `#ffff00`, `#ff8c00`, `#ff0000` (the Pollen Index page shows colour squares but gives no hex values) |

### Google policies (developers.google.com, read 2026-09-14)

- **Air Quality API attribution:** "Source: Includes air quality data from Google", on or next to
  the data or imagery. **Caching:** "subject to caching restrictions outlined in your Google
  Agreement".
- **Pollen API attribution:** "Source: Includes pollen data from Google". **Caching:** "Content
  pre-fetching, caching, or storage is generally prohibited", except place IDs.

### Cloud cover candidates

| Source | What was measured | Verdict |
|---|---|---|
| **NOAA nowCOAST GMGSI** `https://nowcoast.noaa.gov/geoserver/satellite/ows`, layer `global_longwave_imagery_mosaic` | Keyless. WMS 1.3.0 capabilities for the `satellite` namespace: 44 KB in 0.1 s. Time dimension lists six hourly times, 10:00–15:00 UTC, at 16:30 UTC (newest about 1 h 30 m old; the abstract states "hourly update frequency, approximately 3 km … latency is two to three hours"). CRS `EPSG:3857` and `CRS:84` only; extent ±72.7° latitude. GetMap tiles 256 × 256 in 0.05–0.3 s, `Cache-Control: max-age=600`. **Hashes differ for 15:00, 14:00, 12:00 and 11:00.** An unlisted time returns HTTP 200 with a fully transparent tile. Tiles are 8-bit gray+alpha and opaque inside the coverage (bright = cold cloud tops, dark = warm surface). A composite of GOES, Himawari and Meteosat, so Europe and Africa are covered | **Chosen** |
| NASA GIBS WMTS (`epsg3857/best`) | Capabilities 5.8 MB in 7.6 s. `GOES-East_ABI_Band13_Clean_Infrared`, `GOES-West_…`, `Himawari_AHI_Band13_Clean_Infrared`: PT10M, newest 15:20 at 16:05; hashes differ for 15:20, 14:20 and 12:20. Tile matrix `GoogleMapsCompatible_Level6` (z7 returns 400). **No Meteosat layer** in the EPSG:3857 or EPSG:4326 capabilities, so Europe, Africa and western Asia have no geostationary imagery. MODIS and AIRS cloud fraction are daily | Rejected: a continental gap and z6 cap |
| EUMETSAT EUMETView `mumi:worldcloudmap_ir108` | Worldwide IR10.8 composite, time dimension PT3H, default 12:00 UTC at 16:10 UTC (about 4 h behind); −24 h returns 502 | Rejected: 3-hourly, 4 h late |
| RainViewer manifest | `satellite.infrared` is empty (radar-sources memory) | Rejected |
| Open-Meteo `cloud_cover` lattice | See temperature | Rejected: call budget |

### Temperature candidates

| Source | What was measured | Verdict |
|---|---|---|
| **NOAA NCEP GFS via PacIOOS ERDDAP** `https://pae-paha.pacioos.hawaii.edu/erddap/griddap/ncep_global.csvp` | Keyless. NOAA CoastWatch's `NCEP_Global_Best` answers 302 to this PacIOOS dataset. `tmp2m` in kelvin, 0.5°, `time_coverage_resolution` PT3H, coverage 2022-12-01 to 7 days ahead. A 1° global grid (stride 2, 65,160 rows) is 2.48 MB in 6.2 s, one request. **Values differ for 12:00, 15:00 and 18:00** (hashes). A non-step time snaps to the nearest step (14:00 → 15:00). `(now)` returns 400; a time past the axis returns 404. Licence: "The data may be used and redistributed for free" | **Chosen** |
| Open-Meteo Forecast, comma-separated coordinates | 306 points by GET: 200, 115 KB, 0.74 s, `current.temperature_2m` and `cloud_cover` per point. 1,260 points by GET: 414 URI too large. 3,420 points by POST: 400 "Only up to 1000 locations can be requested at once". Open-Meteo's own post on multiple locations gives the call weight as `nLocations × (nDays / 14) × (nVariables / 10)`; the free tier is 10,000 calls/day, 5,000/hour, 600/minute. A 920-point global lattice refreshed hourly costs about 22,000 calls/day, and it is shared with the cockpit weather and the weather report | Rejected: over the free budget |
| UCAR THREDDS GFS 0.25° NCSS | `accept=csv` answers 400 "Format csv is not supported for Grid data" (netCDF only) | Rejected: would need a netCDF decoder |
| nowCOAST NDFD `ndfd_temperature:air_temperature` | CONUS, Alaska, Hawaii, Puerto Rico and Guam only | Rejected: not worldwide |
| NASA GIBS temperature layers | AIRS surface air temperature daily (newest 2026-09-10) and monthly; MERRA-2 monthly | Rejected: not near-real-time |
| OpenWeatherMap tiles | Needs a key | Rejected: keyless sources work |

## Rulings

| Decision | Ruling | Reason |
|---|---|---|
| Cloud source | GMGSI longwave, the newest advertised hour | Only keyless worldwide hourly cloud imagery measured |
| Cloud transparency | Cesium `ImageryLayer` `colorToAlpha: Color.BLACK`, `colorToAlphaThreshold: 0.3` | Tiles are opaque gray; warm clear surfaces are the darkest pixels (the Galveston tile's histogram peaks at gray 32–63), so darker than 77/255 becomes clear and cloud stays |
| Cloud zoom cap | `maximumLevel` 7 (proxy rejects z8+) | 3 km source; z7 is about 1.2 km per pixel at the equator |
| Temperature source | GFS `tmp2m`, the 3-hour step nearest now | The only keyless worldwide grid within budget. The row says `valid 15:00 UTC`, so the 3-hour step is stated, not hidden. No time interpolation (YAGNI) |
| Temperature rendering | The server fetches one 1° grid per step and renders 256 × 256 Web Mercator PNG tiles with bilinear sampling; `maximumLevel` 6 | Uniform tile path for all four modes; a 1° grid holds no more detail past z6. Pure Node (`zlib` plus a 30-line PNG encoder), testable without a browser |
| Air quality type | `US_AQI` only; no type sub-option | All eight types work, but one index keeps one legend. US AQI's EPA colours match the tiles, and the index renders worldwide |
| Google zoom caps | Air quality 12, pollen 10 | Google bills per tile. Measured detail falls off after z12 (AQ) and vanishes after z10 (pollen); Cesium upsamples beyond the cap |
| Tile cache | Memory only, per-entry age limit (Google 10 min, clouds 3 h, temperature 1 h), at most 1,500 entries, oldest evicted first, age prune at most once a minute. Nothing is written to disk | Refines "disk or memory with an age prune" by the Pollen policy, which prohibits caching and storage: Google tiles never touch disk, and the short in-memory window only absorbs Cesium's repeated requests. See Risks |
| Rate limits | Manifest 600/min per client and 2,000 global; tiles 6,000/min per client and 20,000 global, as two limiters | Lessons memory: Cesium never retries a 429 tile |
| Refresh | Every 10 minutes while the tab is visible | GMGSI updates hourly; a new hour appears within 10 minutes of being advertised |
| Stacking | Overlay imagery layers are inserted at imagery index 1 (clamped to the collection length) | Directly above the base map (index 0), so radar, which appends, draws on top whatever the enable order |
| Code shared with radar | Extract `src/layers/weather-imagery/frameImagery.js` (`PRELOAD_ALPHA`, `createFrameImagery`, `swapToFrame`) and `opacity.js` (`IMAGERY_OPACITIES`, `normalizeImageryOpacity`). Radar's `imagery.js`, `controls.js` and `index.js` import them; their exports and tests are unchanged | The ready-gated frame swap and the opacity steps are the same logic; copying 90 lines would duplicate them |
| Google attribution | Each Google provider carries `new Cesium.Credit('Source: Includes … data from Google', true)`, so the globe credit line shows it while that imagery draws; a Data attribution entry is registered too | The policies require the text on or next to the imagery |
| NOAA attribution | Data attribution entries only | U.S. public domain; courtesy credit, like the IEM radar credit |
| Keyless | The manifest reports `available: false, reason: 'not-configured'` for Google modes and `googleConfigured: false` on every response. Google chips are disabled with a reason, and a restored Google mode shows `Google Maps API key not configured` | Clear status without failing the enable |

## Scope

In scope: the proxy; the four modes; the pollen type choice; opacity; per-mode legends; the
Google 3D status; credits; share-link state; the shared imagery helper.

Out of scope: time loops or history; forecast hours; other AQ index types; tapping the overlay for a
value; drawing overlays over Google 3D photorealistic tiles; cockpit behaviour.

## Architecture

### Server: `server/providers/weather-overlays.js`

A Vite plugin, `weatherOverlaysProxy()`, registered in `localProviderPlugins()` directly after
`weatherReportProxy()` (so `keySetupEndpoint()` stays last). Conventions: `makeRateLimiter` in two
limiters, `coalesceProxyRequest`, a `User-Agent` identifying the fork, JSON `{ error }` bodies, and
logs that carry only a label and an error name, never an upstream URL (Google URLs carry the key).
The key comes from `googleServerApiKey()` in `server/providers/places/google-key.js`.

Pure helpers:
- `server/providers/weather-overlays/sources.js`: keys, zoom caps, Web Mercator bounds, upstream
  URLs, GMGSI time parsing, GFS step and Google hour windows, and the ERDDAP CSV grid parser.
- `server/providers/weather-overlays/render.js`: the PNG encoder, bilinear grid sampling and the
  temperature tile renderer.
- `src/layers/weather-overlays/modes.js` and `palette.js` are pure modules shared by the server and
  the browser: keys, zoom caps and colours are defined once.

Routes, mounted at `/api/weather-overlays`:

- `GET /manifest?mode=<key>`, where key is `clouds`, `temperature`, `air-quality`, `pollen-tree`,
  `pollen-grass` or `pollen-weed`. Returns 200 with
  `{ mode, googleConfigured, available, time, stale }`.
  - `clouds`: `time` is the newest GMGSI time (epoch ms). Capabilities are cached for 10 minutes;
    if a refresh fails the last list is served with `stale: true`. With no list at all: 502.
  - `temperature`: `time` is the 3-hour step nearest now; the grid for that step is loaded (held
    for 1 hour). If loading fails, the nearest held grid's time is served with `stale: true`; with
    none held: 502.
  - Google keys: `time` is the current UTC hour. Without a key:
    `{ mode, googleConfigured: false, available: false, reason: 'not-configured', time: null, stale: false }`.
  - Anything else: 400. A 502 body is `{ error: 'upstream unavailable', googleConfigured }`.
- `GET /tiles/<key>/<time>/<z>/<x>/<y>.png`:
  - 400 unless the key is known, the file ends `.png`, and z/x/y are integers inside the tile grid
    and at or below the key's zoom cap (clouds 7, temperature 6, air quality 12, pollen 10).
  - Google keys: 404 without a key; 404 unless `time` is a whole UTC hour from 3 h back to 1 h
    ahead. Upstream `…/heatmapTiles/{z}/{x}/{y}?key=…`.
  - `clouds`: 404 unless `time` is in the current capability list. Upstream GetMap: version 1.3.0,
    `crs=EPSG:3857`, the tile's bbox in metres, 256 × 256 PNG, `transparent=true`, `time` as ISO
    seconds.
  - `temperature`: 404 unless `time` is a 3-hour step within 6 h of now. The tile is rendered from
    that step's grid.
  - Upstream bodies are capped at 2 MB and must start with the PNG signature; failures answer 502
    and are never cached. Responses carry `X-Overlay-Cache: HIT|MISS` and
    `Cache-Control: private, max-age=600`.
- 405 for non-GET, 404 for other paths, and 429 with `Retry-After: 10` from the matching limiter.

### Client: `src/layers/weather-overlays/`

Follows the radar layer's structure; `src/data/weatherOverlays.js` supplies credits and
`governorRequestRender`, and is registered in `src/app/data.js` after the radar.

- **`modes.js`**: modes, pollen types, defaults (`clouds`, `tree`, 0.7), `MODE_INFO` (chip label,
  title, source name, count label, Google flag, zoom cap), `overlayKey`, `modeOfKey`,
  `maximumLevelFor`, `sourceName`, normalizers.
- **`palette.js`**: temperature stops and `temperatureRgb`, and the AQ, pollen and cloud legends.
- **`controls.js`**: `buildRowControls({ mode, pollenType, opacity, googleConfigured })` returns
  `{ chips, legend }`.
- **`imagery.js`**: `overlayTemplate`, `createOverlayProvider` (Web Mercator
  `UrlTemplateImageryProvider` with the zoom cap and, for Google, the on-screen credit),
  `createOverlayLayer` (colour-to-alpha for clouds), and
  `createOverlayImagery(viewer)` = `createFrameImagery` with index-1 insertion.
- **`index.js`**: `createWeatherOverlaysLayer({ fetchImpl, createImagery, registerCredit, credits,
  eventTarget, isVisible, timers, now, requestRender })` returns the manager contract
  (`id: 'weather-overlays'`, `name: 'Weather Overlays'`, `icon: '🌡️'`, `updateInterval: 600000`,
  `init`, `enable`, `disable`, `update`, `destroy`, `getStats`, `getParams`, `setParams`,
  `getRowControls`, `setRowControlsListener`, `attachMapStack`).

## Behaviour

- **Enable:** register the current mode's credit, set the imagery source to the current key, then
  `update()` fetches the manifest.
- **Update:** resolves `false` only when the manager's own signal aborted. A hidden tab with an image
  shown skips (`true`). A superseded request resolves `true`. A failure is stored and reported
  through `getStats()` (`true`). The manifest's `googleConfigured` is recorded from success and
  error bodies alike.
- **Showing:** a new `time` goes through `swapToFrame`: shown at once when nothing is shown, else
  preloaded at alpha 0.001 and shown when the tile queue has drained. A 1-second check timer
  re-tries while visible and is not re-armed while hidden. Every shown, cleared or re-alpha'd image
  calls `requestRender('weather-overlays')`.
- **Mode or pollen type change:** abort the request, clear the imagery (new source key), request a
  render, register the new mode's credit when the mode changed, and refetch. A pollen type change
  while not in pollen mode only stores the choice.
- **Opacity:** 0.4, 0.7 (default) or 1, applied to the shown image with a render request.
- **Google 3D:** when the attached map-stack controller (or the last `gev:map-stack-changed`
  event) reports `photoreal`, the row says so and nothing switches.

## Status strings (exact)

`getStats()` always carries `countLabel` (`CLOUDS`, `TEMP`, `AQI` or `POLLEN`), which the panel
shows in the count slot. `<name>` is `NOAA GMGSI satellite`, `NOAA GFS model`,
`Google Air Quality` or `Google Pollen · Tree|Grass|Weed`. The row text below is what
`layerPanel._buildMetaText` renders for each shape (tested against it):

| State | `getStats()` | Row |
|---|---|---|
| Clouds shown | `{ status: 'ok', source: 'NOAA GMGSI satellite · 15:00 UTC · 80 min old', lastUpdate }` | `NOAA GMGSI satellite · 15:00 UTC · 80 min old · just now` |
| Temperature shown | `source: 'NOAA GFS model · valid 15:00 UTC'` | `NOAA GFS model · valid 15:00 UTC · just now` |
| Google shown | `source: 'Google Pollen · Tree'` | `Google Pollen · Tree · just now` |
| Loading, nothing shown | `{ loading: true, source: <name>, loadingLabel: 'Loading' }` | `NOAA GMGSI satellite · Loading` |
| No key | `{ status: 'unavailable', source: <name>, error: 'Google Maps API key not configured' }` | `UNAVAILABLE · Google Air Quality · Google Maps API key not configured` |
| Failure, nothing shown | `{ status: 'unavailable', source: <name>, error: 'Overlay source unavailable' }` | `UNAVAILABLE · NOAA GMGSI satellite · Overlay source unavailable` |
| Failure or stale manifest, image shown | `{ stale: true, source: '<name> · 15:00 UTC', error: 'Overlay source unavailable — showing 15:00 UTC', lastUpdate }` | `STALE · NOAA GMGSI satellite · 15:00 UTC · Overlay source unavailable — showing 15:00 UTC` |
| Google 3D | `{ status: 'idle', source: <name>, statusMessage: 'Hidden by Google 3D map source' }` | `NOAA GMGSI satellite · Hidden by Google 3D map source` |

## Row controls and legends (phone width)

Chips, in order: `Clouds`, `Temp`, `Air`, `Pollen`; then `Tree`, `Grass`, `Weed` only in pollen
mode; then `40%`, `70%`, `100%`. At most 10 short chips. `.data-toggle-controls` is a wrapping flex
row (`flex-wrap: wrap`, 4 px × 8 px gaps, 26 px left padding), so at 400 px they wrap onto two or
three lines without widening the rail. No new CSS and no right-rail panel.

Legends (each entry renders as `label count`):

| Mode | Entries |
|---|---|
| Clouds | `Low warm tops` `#8c8c8c`, `Mid cool tops` `#c8c8c8`, `High cold tops` `#ffffff` |
| Temp | `-30°C -22°F` `#5e3c99`, `-15°C 5°F` `#3b6fd8`, `0°C 32°F` `#9fd8f0`, `10°C 50°F` `#fff3a0`, `20°C 68°F` `#ffb050`, `30°C 86°F` `#f05a28`, `40°C 104°F` `#a50f15` (the renderer interpolates linearly between these and clamps outside) |
| Air | `Good 0-50` `#00e400`, `Moderate 51-100` `#ffff00`, `Sensitive 101-150` `#ff7e00`, `Unhealthy 151-200` `#ff0000`, `Very unhealthy 201-300` `#8f3f97`, `Hazardous 301+` `#7e0023` |
| Pollen | `Very low UPI 1` `#009e3a`, `Low UPI 2` `#84cf33`, `Moderate UPI 3` `#ffff00`, `High UPI 4` `#ff8c00`, `Very high UPI 5` `#ff0000` |

## State and sharing

- `LAYER_STATE_REGISTRY` gains
  `{ id: 'weather-overlays', token: 'o', disposition: 'enabled+options', optionOwner: 'weather-overlays' }`
  directly before `weather-radar`, keeping ids sorted.
- `OPTION_GROUPS['weather-overlays']`:
  - `mode`, token `m`, default `clouds`; codes `clouds` `c`, `temperature` `t`, `air-quality` `a`,
    `pollen` `p`.
  - `pollenType`, token `p`, default `tree`; codes `tree` `t`, `grass` `g`, `weed` `w`.
  - `opacity`, token `o`, default 0.7; `40`, `70`, `100`. A new `opacityOption()` helper builds
    this spec, and radar's opacity spec uses it too, unchanged in behaviour.
- Example: overlays in pollen/weed at 100% with radar on encodes `l=o.n` and
  `lo=…o.m.p_o.p.w_o.o.100`.

## Credits and terms

In `src/data/dataCredits.js`, registered with `registerDynamicCredit` when a mode is first shown:

- `NOAA_GMGSI_CREDIT`: `Clouds: <a href="https://nowcoast.noaa.gov/" target="_blank" rel="noopener">NOAA nowCOAST</a> GMGSI geostationary satellite mosaic`
- `NOAA_GFS_CREDIT`: `Temperature: NOAA NCEP GFS via <a href="https://pae-paha.pacioos.hawaii.edu/erddap/griddap/ncep_global.html" target="_blank" rel="noopener">PacIOOS ERDDAP</a>`
- `GOOGLE_AIR_QUALITY_CREDIT`: `Air quality overlay: Source: Includes air quality data from Google`
- `GOOGLE_POLLEN_CREDIT`: `Pollen overlay: Source: Includes pollen data from Google`

The Google providers also carry the on-screen credits `Source: Includes air quality data from Google`
and `Source: Includes pollen data from Google`. `DATA_SOURCES.md` gains four rows and `CHANGELOG.md`
an entry.

## Testing

Colocated `*.test.mjs`, `node:test`, no live network; fixtures under
`src/data/fixtures/weather-overlays/` (see its README).

- `src/layers/weather-imagery/frameImagery.test.mjs`: opacity steps; `createLayer` receives the
  source; index-1 insertion and clamping; `swapToFrame` show-now versus wait-for-ready.
- `src/data/weatherOverlaysSources.test.mjs`: keys and zoom caps, bounds, all upstream URLs, GMGSI
  times from the recorded capabilities (and ISO ranges), GFS and Google time windows, the recorded
  GFS grid.
- `src/data/weatherOverlaysRender.test.mjs`: the ramp, a CRC-checked PNG round trip, wraparound
  sampling, rendered pixels against the sampled grid, transparent missing data.
- `src/data/weatherOverlaysProxy.test.mjs`: every manifest shape, keyless behaviour, Google key use
  and cache TTL, key-free logs, uncached failures, cloud time validation and stale capabilities,
  temperature rendering and stale fallback, the split limiters, method and path errors, cache
  eviction and prune, and plugin registration.
- `src/layers/weather-overlays/controls.test.mjs`, `imagery.test.mjs`, `index.test.mjs`: chips,
  legends, providers, credits, colour-to-alpha, stacking, lifecycle, render requests, every stats
  shape, and the row text from `LayerPanel.prototype._buildMetaText`.
- `src/data/layerState.test.mjs`: count +1 and the option round-trip.
- The existing radar tests pass unchanged after the helper extraction.

`package.json` exports `./layers/weather-overlays` and `./server/providers/weather-overlays`.
`scripts/package-boundaries.json` gains `weather-overlays-provider` and `weather-overlays-layer`, and
the shared helpers join `weather-radar-layer` and `application-components`. The CI-parity sequence
must pass: format check, boundaries, `npm test`, build.

## Risks

- **Pollen caching policy.** The 10-minute in-memory tile window may still count as caching under
  the Pollen policy. Setting `GOOGLE_TILE_TTL_MS` to 0 turns it off at the cost of more billed
  tiles.
- **Google billing.** Air quality and pollen tiles are billed per request; the zoom caps and the
  cache bound it, but a long session at z12 can still request many tiles.
- **GMGSI brightness threshold.** 0.3 was chosen from one tile's histogram; the smoke check in the
  plan's last task looks at it on the globe.
- **Upstream moves.** CoastWatch already redirects GFS to PacIOOS; if PacIOOS drops `ncep_global`,
  the temperature row reports unavailable.
