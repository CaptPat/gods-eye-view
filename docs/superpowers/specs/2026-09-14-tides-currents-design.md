# Tide stations and current stations — design

Status: implemented (merged to fork main 2026-09-14, 9ec8930)
Fork: CaptPat/gods-eye-view (Cyclops View). Fork-only work; nothing is proposed upstream.

## Purpose

Two on/off point layers for US coastal waters:
- **Tide Stations** shows NOAA water-level stations. Clicking one gives the next four high and low
  tides and the latest observed water level against its prediction.
- **Current Stations** shows NOAA current-prediction stations. Clicking one gives the next maximum
  flood and ebb (speed and direction), the next slack, and the prediction bin's depth.

Both cards show station-local times and open the NOAA station page when clicked.

## Place in the weather suite

This is weather-suite sub-project 3 of 5:
1. Weather radar (`2026-09-14-weather-radar-design.md`, built);
2. Right-click weather report (`2026-09-14-weather-report-design.md`, built);
3. **Tide stations and current stations** (this document);
4. Gridded overlays;
5. Severe weather.

Plans 3 → 4 → 5 run in order, each merged before the next starts. This plan's edits to shared files
are insertions against anchors that exist on main at `6462f0a`.

## Sources (measured 2026-09-14)

All requests below were made live with `User-Agent: CyclopsView/0.1 (+https://github.com/CaptPat/gods-eye-view)`.
Trimmed responses are recorded under `src/data/fixtures/tides-currents/`.

### CO-OPS Metadata API (`mdapi`)

`GET https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=<type>`

| `type` | Result | Consequence |
|---|---|---|
| `waterlevels` | HTTP 200, 777 KB, 0.2 s. 302 stations: 238 `tidal`, 52 `greatlakes`, 12 neither | Tide layer source |
| `currentpredictions` | HTTP 200, 3.75 MB, 0.5 s. 4,430 entries but only 2,785 distinct ids: one entry per prediction bin (up to 5 per id, bins 0–19+) | Group by id |
| `tidepredictions` | HTTP 200, 3,499 stations (mostly subordinate prediction sites) | Not used: the ruling is water-level stations |

Field facts:
- Water-level entries carry `id`, `name`, `lat`, `lng`, `state`, `timezone` (an abbreviation), `timezonecorr` (standard offset), `observedst`, `tidal` and `greatlakes`.
- **`observedst` is unreliable.** Pearl Harbor (1612401) has `true` yet stays at UTC−10.
- Current entries carry `id`, `name`, `lat`, `lng`, `currbin`, `type` (`H` 2,212, `S` 1,939, `W` 279), `depth` (feet, or `null` for 1,066), `depthType` (`U`/`S`/`B`) and `timezone_offset` (blank for 2,046 entries).
- Every id in both lists matches `^[A-Za-z0-9]{1,16}$`.
- The top-level `units` field is `null`.

### CO-OPS Data API (`datagetter`)

`GET https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?...&units=metric&time_zone=gmt&format=json&application=CyclopsView`

| Request | Result |
|---|---|
| `product=predictions&interval=hilo&datum=MLLW&begin_date=20260914&range=72` (Providence 8454000) | HTTP 200, `{ predictions: [{ t: "2026-09-14 02:34", v: "1.445", type: "H" }, …] }`, 12 events |
| same with `date=today&range=48` | only today's 4 events: **`date=today` ignores `range`** |
| `begin_date=20260914 16:00` (hour precision; also sent `+`/`%3A`-encoded as `URLSearchParams` does) | HTTP 200, events start after 16:00 |
| `product=water_level&date=latest&datum=MLLW` | HTTP 200, `{ metadata, data: [{ t: "2026-09-14 16:06", v: "1.474", s, f, q }] }`, about 6 minutes behind the clock |
| `product=predictions&date=latest&datum=MLLW` | HTTP 200, the last six 6-minute predictions, including the observation's timestamp (16:06 → 1.429) |
| `time_zone=lst_ldt` versus `gmt` | Same data shifted by the station's local offset, including DST (see Time zones) |
| `units=english` versus `metric` | Heights ft versus m; currents `"feet, knots"` versus `"meters, cm/s"` |
| hilo at a Great Lakes station (Buffalo 9063020) | HTTP 400 `{"error":{"message":" Great Lakes stations don't have Predictions data."}}` |
| water level at Buffalo, `datum=MLLW` | HTTP 400 `There is no MLLW for the station`; `datum=IGLD` → HTTP 200, 174.372 m |
| hilo at the 12 non-tidal stations | HTTP 200 with `No Predictions data was found` |
| their water level with MLLW, MSL, NAVD | HTTP 400 `no MLLW` / `no MSL`, or HTTP 200 `No data was found` |
| water level at 4 tidal stations (e.g. 8551910) | HTTP 200 `{"error":{"message":"No data was found. This product may not be offered at this station at the requested time."}}` |
| invalid station | HTTP 400 `The station is not a valid station or there is system error.` |
| `product=currents_predictions&interval=MAX_SLACK&bin=1` (Pollock Rip ACT1616) | HTTP 200, `{ current_predictions: { units: "meters, cm/s", cp: [{ Type: "flood"|"ebb"|"slack", meanFloodDir: 37, meanEbbDir: 226, Bin: "1", Depth: "4.6", Time: "2026-09-14 01:03", Velocity_Major: 107.8 }] } }`: 24 events in 72 h; ebb speeds negative |
| currents without `bin` | NOAA picks bin 1 |
| currents at an absent bin | HTTP 400 `Available bin number of ACT0311: 1, 2, ` |
| currents at `W` (weak and variable) stations, bin 0, or an invalid id | **HTTP 200** `{"error":{"message":"Currents predictions are not available from the requested station."}}` (5 of 5 sampled) |
| burst of ~620 requests in about a minute (4 concurrent) | every request answered `{"message":"Forbidden"}` (API Gateway) for several minutes, then recovered |

### NOAA station pages

| URL | Result |
|---|---|
| `https://tidesandcurrents.noaa.gov/stationhome.html?id=8454000` | HTTP 200 "Station Home Page - NOAA Tides & Currents" |
| `https://tidesandcurrents.noaa.gov/noaacurrents/predictions?id=ACT1616_1` | HTTP 200 "NOAA Current Predictions" (`<id>_<bin>`) |

### Time zones

`lst_ldt` minus `gmt` for the latest water level at one station per metadata zone combination, on
2026-09-14:

| Metadata `timezone` / `state` | Station | Offset | IANA zone chosen |
|---|---|---|---|
| EST (all states incl. Great Lakes) | Ogdensburg 8311030 | −4 | `America/New_York` |
| CST | Panama City 8729108 | −5 | `America/Chicago` |
| PST | San Diego 9410170 | −7 | `America/Los_Angeles` |
| AKST | Ketchikan 9450460 | −8 | `America/Anchorage` |
| HAST / AK | Adak Island 9461380 | −9 | `America/Adak` |
| HAST / HI (`observedst` true or false) | Nawiliwili, Pearl Harbor | −10 | `Pacific/Honolulu` |
| SST | Midway 1619910 | −11 | `Pacific/Pago_Pago` |
| ChST | Apra Harbor 1630000 | +10 | `Pacific/Guam` |
| NZST | Kwajalein 1820000 | +12 | `Pacific/Kwajalein` |
| AST / Bermuda | Bermuda 2695535 | −3 | `Atlantic/Bermuda` |
| AST / VI, PR | Christiansted 9751364 | −4 | `America/Puerto_Rico` |

For current stations, the nearest water-level station's zone agreed with the entry's non-blank
`timezone_offset` for 2,377 of 2,384 entries. The 7 disagreements are Kahului Harbor (−9 in NOAA's
metadata, an error for Maui) and two Umnak Pass/Konets Head stations near the Alaska–Aleutian line.
Median nearest distance is 16 km, p95 94 km, and the maximum is 1,039 km (Magdalena Bay, Mexico →
San Diego).

## Rulings

| # | Ruling | Reason |
|---|---|---|
| R1 | Tide layer = the 290 `tidal` or `greatlakes` water-level stations. The 12 non-tidal stations are dropped | They have neither predictions nor an MLLW/MSL observation (measured), so a click could show nothing |
| R2 | Great Lakes stations show only the latest observation, in IGLD | Predictions are 400; MLLW is 400; IGLD works |
| R3 | Current layer = one marker per station id after dropping `type: 'W'` and `currbin < 1`: 2,553 markers from 4,151 entries | W and bin 0 always answer "not available" |
| R4 | A current card uses the station's lowest bin, which is also what NOAA picks with no `bin` | Measured default. The card names the bin count when there are several |
| R5 | The proxy always requests `units=metric&time_zone=gmt`, returns SI values and epoch ms, and the client formats in the station's IANA zone | GMT gives absolute times, so "next" is comparable with the clock. The zone gives correct DST |
| R6 | Zones come from the `timezone` abbreviation (HAST and AST split by `state`), never from `observedst` | The measured table above. `observedst` is wrong at Pearl Harbor |
| R7 | A current station borrows the nearest tide station's zone; an unknown zone formats as UTC | 99.7 % agreement with NOAA's own offsets; `timezone_offset` is blank for 46 % of entries |
| R8 | Tide window: `begin_date` = the current UTC hour, `range=72`. Currents use the same window | `date=today` ignores `range`. An hour-start window always holds ≥ 71 h of future events, enough for four extremes even at diurnal stations |
| R9 | The observed-versus-predicted comparison uses `predictions&date=latest` matched on the observation's exact `t` | Measured to include the observation's 6-minute timestamp |
| R10 | Units follow the weather report's preference `gev.weatherReport.units` (`imperial` default). Imperial shows ft and kn; metric shows m and m/s | The card is canvas-drawn (world overlay), so a switch of its own is not cheap. Knots are the nautical norm; m/s matches the report's SI base |
| R11 | Upstream failures are any non-2xx, any body with `error.message`, or a body with `message`. HTTP 200 bodies are always checked | CO-OPS returns errors as HTTP 200 (currents, no data) and as API-Gateway `{message}` |
| R12 | Station lists are cached in memory 24 h. A failed refresh serves the last list with `stale: true` and retries after 10 min | Metadata changes rarely; lists are large |
| R13 | Station reports are cached in memory 10 min, only when complete, age-pruned on every insert and capped at 500 keys. Partial reports are served uncached | Satisfies "a prune for every cache". A transient failure is retried on the next click |
| R14 | Rate limit: 60 requests/min per client, 150/min global, one limiter for all JSON routes | No tile routes. The global cap keeps the worst case (3 upstream calls per tide report) well under the ~600/min burst that NOAA blocked |
| R15 | Rendering follows the bikeshare pattern: one `PointPrimitiveCollection` per layer with distance scaling and `disableDepthTestDistance` 50 km. There is no clustering or LOD budget | 2,553 points cost one draw call. Cesium frustum-culls and the globe depth test hides the far side. Bikeshare runs up to 8,000 |
| R16 | Selection follows the bikeshare pattern: an enlarged point plus a protected `variant: 'selected'` world-overlay card (cohort 1), cleared by an empty click or Escape. The card is `interactive` with `activate` and `accessibilityLabel`. The layer's own click handler hit-tests the card (the FIRMS/CCTV pattern) and opens the NOAA page | The existing point-layer card pattern; world-overlay cards cannot hold links, so the whole card is the link |
| R17 | Share links carry only the enabled state (`enabled-only`, tokens `h` tide, `k` current) | No option needs persisting; units belong to the weather report |
| R18 | Both layers use `updateInterval: 0` and `refreshInterval: 3,600,000`. `update()` refetches the list only when it is missing, stale or older than 6 h | The manager's periodic loop retries a failed list hourly without repeated 3.7 MB transfers |
| R19 | `update()` resolves `false` only when the manager's signal is already aborted. Handled failures resolve `true` and surface through `getStats().error` | The weather-radar contract: an enabled row saying why beats a failed enable |

## Scope

In scope:
- the provider proxy;
- both layers, their markers and selection cards;
- the NOAA credit, `DATA_SOURCES.md` and `CHANGELOG.md` rows;
- layer-state tokens;
- package exports and boundaries.

Out of scope:
- tide or current charts and curves;
- choosing a different current bin;
- tide-prediction (subordinate) stations;
- non-US sources;
- voice tool enums;
- cockpit-specific behaviour;
- archive or replay.

## Architecture

### Server: `server/providers/tides.js` and `server/providers/tides/normalize.js`

A Vite plugin, `tidesProxy()`, is mounted at `/api/tides` and registered in `localProviderPlugins()`
directly after `weatherReportProxy()`, so `keySetupEndpoint()` stays last. It uses
`makeRateLimiter`, `coalesceProxyRequest` and `readResponseJsonCapped`, with:
- a 15 s upstream timeout;
- a response cap of 8 MB for lists and 256 KB for data;
- JSON errors.

Routes:

- `GET /stations?kind=tide|current` → `{ kind, stations, generatedAt, stale }`.
  - Tide station: `{ id, name, lat, lon, state, timeZone, greatLakes }`.
  - Current station: `{ id, name, lat, lon, bins: [1, 12, 23], timeZone }`.
  - Coordinates are rounded to 5 decimals. The current list loads the tide list first, for zones.
- `GET /tide?id=<id>` → 404 unless the id is in the tide list. Response:
  `{ id, kind: 'tide', datum: 'MLLW'|'IGLD', generatedAt, sources: { predictions, observed }, predictions: [{ time, type: 'high'|'low', heightM }] | null, observed: { time, heightM, predictedM } | null }`.
  - Source states are `ok`, `unavailable` or `none` (Great Lakes predictions).
  - Tidal stations make three concurrent upstream calls (hilo, water level, latest predictions); Great Lakes stations make one (IGLD water level).
- `GET /current?id=<id>[&bin=<n>]` → 404 unless the id is listed; 400 unless `bin` is one of its bins (default: the lowest). Response:
  `{ id, kind: 'current', bin, generatedAt, sources: { predictions }, depthM, floodDirDeg, ebbDirDeg, events: [{ time, type: 'flood'|'ebb'|'slack', speedMs }] | null }`.
- Status codes:
  - 200 when any source is `ok`;
  - 502 `{ error: 'NOAA CO-OPS unavailable' }` when none is, or when a list cannot load cold;
  - 429 `{ error: 'rate limited' }` with `Retry-After: 10`;
  - 405 for non-GET;
  - 404 for unknown paths.
- `handle.cacheSizes()` exposes `{ lists, reports }` for tests.

### Client: `src/layers/tides/`

The layer package stays cesium-only. `src/data/tides.js` injects the world overlay host (including
`hitTest`), `governorRequestRender`, `registerDynamicCredit` with `NOAA_COOPS_CREDIT`, a read-only
`localStorage` view and `window.open`.

- **`model.js`** (pure):
  - `STATION_LAYERS` (ids, names, icons 🌊 and 🧭, colours `#38bdf8` and `#f59e0b`, selected overlay source ids);
  - `UNITS_STORAGE_KEY`, `normalizeUnits`, `cardinal`, `parseStationsPayload`;
  - `formatStationTime` (`Mon 16:11 EDT`), `formatHeight`, `formatSpeed`, `formatDepth`;
  - `noaaStationUrl`, `stationTitle`;
  - `buildPendingCard`, `buildTideCard`, `buildCurrentCard`.
- **`points.js`**: `createStationPoints(viewer, { layerId, color })` returns
  `{ setStations, setSelected, selectedId, positionOf, stationIdFromPick, setShow, count, destroy }`.
  Points are 7 px (13 px with a white outline when selected), 5 m above the ellipsoid, and use
  `NearFarScalar(50 km, 1.2, 12,000 km, 0.55)`. Pick ids are `<layerId>:<stationId>`.
- **`index.js`**: `createNoaaStationsLayer({ kind, overlayHost, fetchImpl, createPoints, createClickHandler, requestRender, registerCredit, credit, storage, openUrl, documentTarget, now })`, plus `createTideStationsLayer` and `createCurrentStationsLayer`.

The layers are registered in `src/app/data.js` directly after `weatherRadarLayer.attachMapStack(mapStackController);`.

## Behaviour

- **Enable** registers the NOAA credit, shows the points, makes the selected-card source visible,
  installs the click handler and Escape listener, and requests a render. The manager's first
  `update()` fetches the list.
- **List refresh** happens on the manager's hourly tick. It skips when the list is fresh (< 6 h, not
  stale). New results replace the points, drop a selection whose station vanished, and request a render.
- **Click:**
  1. If a card is open and the click hits it, open the NOAA page.
  2. Otherwise, if the pick is one of this layer's stations, select it: enlarge the point, request a
     render, publish a `Loading NOAA CO-OPS…` card, fetch the report, then publish the full card or
     `NOAA CO-OPS unavailable`.
  3. Otherwise clear the selection.

  A newer selection aborts the older request.
- **Escape** clears the selection. It does not stop propagation, so the tracking layers' document
  listeners still run.
- **Disable** aborts requests, clears the selection and card, removes the listeners and click handler,
  hides and empties the points, and requests a render. The station list stays cached, so re-enabling
  costs no request.
- **Render governor:** every point mutation (`setStations`, selection restyle, enable/disable) calls the
  injected `requestRender('<layer id>')`. Overlay host calls invalidate the overlay themselves.

## Card copy (exact)

Tide card: title `<name, ≤ 30 chars with …> · <id>`. Details, in order:
- up to four `High 4.4 ft · Mon 23:19 EDT` / `Low 0.3 ft · Tue 04:18 EDT`, or `No upcoming tides in range`, or `Tide predictions unavailable`, or (Great Lakes) `Great Lakes: no tide predictions`;
- `Obs 4.8 ft vs pred 4.7 ft · Mon 12:06 EDT`; without a prediction `Obs 174.37 m · Mon 12:06 EDT`; missing `Latest observation unavailable`;
- `Datum MLLW · click card for NOAA page` (or `Datum IGLD · …`).

Heights are `x.x ft` or `x.xx m`.

Current card: the same title rule. Details:
- `Bin 1 · depth 15 ft · 3 bins` (the depth part only when known, the bin count only when > 1);
- `Flood 2.0 kn NE (37°) · Mon 21:45 EDT` (or `Flood —`);
- `Ebb 1.8 kn SW (226°) · Mon 15:12 EDT` (or `Ebb —`);
- `Slack · Mon 12:27 EDT` (or `Slack —`);
- on failure the three prediction lines become `Current predictions unavailable`;
- `Click card for NOAA predictions`.

Speeds are `x.x kn` or `x.xx m/s`.

Directions are NOAA's mean flood and ebb directions, in degrees true, with a 16-point cardinal.

## Status text (checked against `layerPanel._buildMetaText`)

Source name `NOAA CO-OPS`.

| `getStats()` | Row text |
|---|---|
| `{ count, lastUpdate }` | `NOAA CO-OPS · 5m ago` |
| `{ loading: true, loadingLabel: 'Loading stations', count, lastUpdate }` | `NOAA CO-OPS · Loading stations` |
| `{ stale: true, count, lastUpdate }` (server served a stale list) | `STALE · NOAA CO-OPS · 5m ago` |
| `{ stale: true, count, lastUpdate, error: 'Station list refresh failed' }` | `STALE · NOAA CO-OPS · Station list refresh failed` |
| `{ count: 0, lastUpdate: null, error: 'Station list unavailable' }` | `UNAVAILABLE · NOAA CO-OPS · Station list unavailable` |

During the manager's own enable transition the row reads `ENABLING · NOAA CO-OPS`.

## State, credits and docs

- `LAYER_STATE_REGISTRY` gains `{ id: 'current-stations', token: 'k', disposition: 'enabled-only' }`
  (after `cctv`) and `{ id: 'tide-stations', token: 'h', disposition: 'enabled-only' }` (after
  `telegeography-submarine-cables`). The registry count rises by 2.
- `NOAA_COOPS_CREDIT` (key `noaa-coops`):
  `Tides and currents: <a href="https://tidesandcurrents.noaa.gov/" target="_blank" rel="noopener">NOAA CO-OPS</a>`.
  It is registered with `registerDynamicCredit` on first enable. NOAA data is a U.S. Government work.
- `DATA_SOURCES.md` gains a NOAA CO-OPS row after the Iowa Environmental Mesonet row. `CHANGELOG.md`
  gains a fork entry at the top.

## Testing

Colocated `*.test.mjs`, `node:test`, no live network. The fixtures are trimmed live responses.

- `src/data/tidesNormalize.test.mjs`:
  - list URLs;
  - tide station filtering;
  - zones checked against the measured offsets through `Intl`;
  - current grouping and zone borrowing;
  - datagetter URLs;
  - all three failure shapes;
  - hilo, water level, matched prediction and currents normalization.
- `src/data/tidesProxy.test.mjs`:
  - list caching;
  - stale and cold failure;
  - tide report join and caching;
  - Great Lakes;
  - partial versus failed;
  - current bin defaults and validation;
  - cache age prune and cap;
  - 429/405/404;
  - Vite registration.
- `src/layers/tides/model.test.mjs`: formatting, payload validation, links, and every card line in both units.
- `src/layers/tides/points.test.mjs`: collection, pick resolution, selection restyle and destroy, against a real `PointPrimitiveCollection`.
- `src/layers/tides/index.test.mjs`:
  - identity and default instances;
  - enable;
  - refresh cadence;
  - every status row through `DataLayerManager._buildMetaText`;
  - loading and full cards;
  - the card link;
  - supersession;
  - failure card;
  - Escape and empty click;
  - disable and re-enable;
  - storage failure;
  - `requestRender` calls.
- `src/data/layerState.test.mjs`: tokens `h`/`k`, no options, count +2.

CI parity: `npm run format:check`, `npm run check:boundaries`, `npm test`, `npm run build`.

Package wiring:
- `package.json` exports `./server/providers/tides` and `./layers/tides`.
- `scripts/package-boundaries.json` gains `tides-provider` (node) and `tides-layer` (cesium), and
  adds `src/data/tides.js` and `src/layers/tides/*.js` to `application-components`.
- `scripts/format-scope.json` lists the new files.
