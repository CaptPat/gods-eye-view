# Tide and Current Stations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two NOAA CO-OPS point layers in Cyclops View:
- **Tide Stations** (290 water-level stations): a click shows the next four high and low tides and the latest observation against its prediction.
- **Current Stations** (2,553 current-prediction stations): a click shows the next maximum flood and ebb, the next slack and the bin depth.

Both are served through a caching `/api/tides` proxy.

**Architecture:**
- **Proxy:** a Vite provider plugin (`server/providers/tides.js`, pure helpers in `server/providers/tides/normalize.js`) reads the CO-OPS Metadata API for station lists (24 h memory cache) and the Data API for per-station reports (10 min memory cache, age-pruned and capped). It returns SI values and epoch ms.
- **Layers:** a cesium-only package (`src/layers/tides/`) draws one `PointPrimitiveCollection` per layer (the bikeshare pattern) and shows a protected `variant: 'selected'` world-overlay card on click. The card opens the NOAA station page.
- **Wiring:** `src/data/tides.js` injects the overlay host, render governor, credit, storage and `window.open`.

**Tech Stack:** Node ≥ 24 Vite provider plugins, CesiumJS 1.138 (`PointPrimitiveCollection`, `ScreenSpaceEventHandler`), `Intl.DateTimeFormat`, `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-14-tides-currents-design.md`

## Global Constraints

**Repository and commits**
- Fork-only work on `CaptPat/gods-eye-view`. Never open upstream PRs or issues; `gh pr create` defaults to the parent repository, so do not use it.
- Every commit message ends with exactly `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`, whatever model implements.

**Upstream endpoints**
- Metadata API: `https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=waterlevels` (tide layer) and `?type=currentpredictions` (current layer).
- Data API: `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter`. Every request carries `units=metric&time_zone=gmt&format=json&application=CyclopsView`.
  - Tide predictions: `product=predictions&interval=hilo&datum=MLLW&begin_date=<yyyyMMdd HH:00 UTC>&range=72`.
  - Observation: `product=water_level&date=latest&datum=MLLW` (Great Lakes: `datum=IGLD`).
  - Matching prediction: `product=predictions&date=latest&datum=MLLW`.
  - Currents: `product=currents_predictions&interval=MAX_SLACK&bin=<n>&begin_date=<yyyyMMdd HH:00 UTC>&range=72`.
  - Never use `date=today` with `range`: `date=today` ignores `range` (measured).
- Upstream `User-Agent`: `CyclopsView/0.1 (+https://github.com/CaptPat/gods-eye-view)`. Timeout 15 s. Response cap 8 MB for lists, 256 KB for data.
- CO-OPS failure shapes, all measured:
  - HTTP 400 with `{ error: { message } }`;
  - **HTTP 200** with `{ error: { message } }` (currents not available, no data);
  - API Gateway `{ message: 'Forbidden' }` after bursts.
  - Always inspect the body; never trust the status alone.

**Station filtering and time zones**
- Tide layer: stations with `tidal: true` or `greatlakes: true`; the 12 non-tidal stations are dropped. Current layer: one station per `id`, bins sorted ascending; entries with `type: 'W'` or `currbin < 1` are dropped. The default bin is the lowest.
- Zones:

  | Metadata `timezone` | Zone |
  |---|---|
  | EST | `America/New_York` |
  | CST | `America/Chicago` |
  | PST | `America/Los_Angeles` |
  | AKST | `America/Anchorage` |
  | HAST, state AK | `America/Adak` |
  | HAST, other states | `Pacific/Honolulu` |
  | SST | `Pacific/Pago_Pago` |
  | ChST | `Pacific/Guam` |
  | NZST | `Pacific/Kwajalein` |
  | AST, state Bermuda | `Atlantic/Bermuda` |
  | AST, other states | `America/Puerto_Rico` |

  Never read `observedst` (wrong at Pearl Harbor). A current station takes the nearest tide station's zone. An unknown zone formats as UTC.

**Proxy routes and caching**
- Routes under `/api/tides`:
  - `GET /stations?kind=tide|current` → `{ kind, stations, generatedAt, stale }`;
  - `GET /tide?id=` → tide report;
  - `GET /current?id=&bin=` → current report.

  Unknown station 404 `{ error: 'unknown station' }`. Bad bin 400. Bad kind 400.
- Status codes:
  - 502 `{ error: 'NOAA CO-OPS unavailable' }` when no source is `ok`;
  - 429 `{ error: 'rate limited' }` with `Retry-After: 10`;
  - 405 for non-GET;
  - 404 `{ error: 'not found' }` for an unknown path.
- Caches:
  - Station lists: memory, 24 h. A failed refresh serves the last list with `stale: true` and retries after 10 min; a cold failure is 502.
  - Reports: memory, 10 min, only when complete. On every insert, prune by age and cap at 500 (oldest first).
- Rate limit: `makeRateLimiter({ windowMs: 60_000, max: 60, globalMax: 150 })`.

**Layer identity, sharing and units**
- Layer ids and names: `tide-stations` / `Tide Stations` / `🌊` / `#38bdf8`; `current-stations` / `Current Stations` / `🧭` / `#f59e0b`. Source `NOAA CO-OPS`. Share tokens: `h` (tide), `k` (current), `enabled-only`, no options.
- Units follow the weather report's preference key `gev.weatherReport.units` (`imperial` default; storage errors fall back to imperial). Imperial: `x.x ft`, `x.x kn`, depth `n ft`. Metric: `x.xx m`, `x.xx m/s`, depth `x.x m`.

**Card copy (exact)**

Titles are `<name, 30 chars max with …> · <id>`.
- Loading card: `Loading NOAA CO-OPS…`. Failure card: `NOAA CO-OPS unavailable`.
- Tide card lines:
  - up to four `High 4.4 ft · Mon 23:19 EDT` / `Low 0.3 ft · Tue 04:18 EDT` (or `No upcoming tides in range` / `Tide predictions unavailable` / `Great Lakes: no tide predictions`);
  - `Obs 4.8 ft vs pred 4.7 ft · Mon 12:06 EDT` (or `Latest observation unavailable`);
  - `Datum MLLW · click card for NOAA page`.
- Current card lines:
  - `Bin 1 · depth 15 ft · 3 bins`;
  - `Flood 2.0 kn NE (37°) · Mon 21:45 EDT`;
  - `Ebb 1.8 kn SW (226°) · Mon 15:12 EDT`;
  - `Slack · Mon 12:27 EDT` (each `… —` when absent; `Current predictions unavailable` on failure);
  - `Click card for NOAA predictions`.
- NOAA links: `https://tidesandcurrents.noaa.gov/stationhome.html?id=<id>` and `https://tidesandcurrents.noaa.gov/noaacurrents/predictions?id=<id>_<bin>`.

**Status rows (exact, via `layerPanel._buildMetaText`)**
- `NOAA CO-OPS · 5m ago`
- `NOAA CO-OPS · Loading stations`
- `STALE · NOAA CO-OPS · 5m ago`
- `STALE · NOAA CO-OPS · Station list refresh failed`
- `UNAVAILABLE · NOAA CO-OPS · Station list unavailable`

**Credit**
- HTML exactly `Tides and currents: <a href="https://tidesandcurrents.noaa.gov/" target="_blank" rel="noopener">NOAA CO-OPS</a>`, key `noaa-coops`, registered with `registerDynamicCredit` on enable.

**Lessons from the radar build (traps unit fakes cannot see)**
- **Render governor.** Cyclops View idles in Cesium `requestRenderMode`. Every scene mutation not driven by a `DataLayerManager` call must call the injected `requestRender('<layer id>')`: point set replacement after an async list fetch, selection restyle, enable, disable, clear. `src/data/tides.js` injects `governorRequestRender`, so `src/layers/tides/*` stays cesium-only for package boundaries. Tests spy on `requestRender`. World-overlay host calls invalidate the overlay themselves.
- **Status strings.** Exact row text is checked through `DataLayerManager._buildMetaText`, not only `getStats()`. `loading: true` without `loadingLabel` would append `loading...`. An `error` prefixes STALE or UNAVAILABLE, and `lastUpdate` appends the age.
- **Every proxy cache needs an age prune from day one.** Here both caches are in memory: lists are replaced wholesale, reports are age-pruned and capped on every insert.
- **Rate limits.** There are no tile routes here, so one JSON limiter serves every route. Keep the global cap: CO-OPS blocked this machine with `{"message":"Forbidden"}` for several minutes after about 620 requests in a minute.
- **Manager contract.** `update() === false` means a failed enable or refresh, so return `false` only for a manager abort. Refresh failures are read from `stats.error`.
- **Global keys.** The flight, military, satellite and bikeshare tracking layers clear on Escape through bubbling `document` listeners. This layer's Escape listener is also a `document` listener and must not `stopPropagation()`. Any focused UI that handles Escape, Enter or Space must.
- **Right-rail panels and required attribution.** Not applicable: these layers add no rail panel. The card is a world-overlay card, and the NOAA credit lives in the credit popover.
- **Phone width.** The world-overlay card renderer lays out the card; every detail line is 42 characters or fewer, which fits a 400 px viewport.

**Shared files (plans 3 → 4 → 5 run in order)**
- Edit them only as insertions against the named anchors, which exist on main at `6462f0a`.
- The registry count in `src/data/layerState.test.mjs`: raise both assertions **by 2 from their current value**. The value is 18 at `6462f0a`, which makes it 20; if an earlier plan already merged, add 2 to whatever is there.
- `keySetupEndpoint()` stays last in `localProviderPlugins()`.

**Tests and CI parity**
- Tests: colocated `*.test.mjs`, `node:test` + `node:assert/strict`, no live network. Real `cesium` constructors with a hand-built fake viewer.
- Fixtures: recorded live on 2026-09-14 and already committed with this plan in `src/data/fixtures/tides-currents/`. Do not re-record them.
- CI parity before the final commit: `npm run format:check`, `npm run check:boundaries`, `npm test`, `npm run build`.

## Fixtures (already committed)

| File | Content |
|---|---|
| `mdapi-waterlevels.json` | 14 trimmed water-level stations: Providence 8454000 (EST RI), Buffalo 9063020 (Great Lakes), Carrollton 8761955 and Salinas 9755968 (non-tidal), Pearl Harbor 1612401, Adak 9461380, Bermuda 2695535, Christiansted 9751364, Apra Harbor 1630000, San Diego 9410170, Ketchikan 9450460, Panama City 8729108, Midway 1619910, Kwajalein 1820000 |
| `mdapi-currentpredictions.json` | 9 entries: ACT0311 bins 1–2 (S), ACT1616 bin 1 (H), ACT5971 (W), HAI1103 bins 23/12/1 (H, unsorted), PCT0016 (S, Mexico), sn0101 bin 0 (W) |
| `datagetter-hilo-8454000.json` | 12 high/low predictions from 2026-09-14 02:34 GMT (H 1.445 m) to 2026-09-16 21:37 (L 0.266 m) |
| `datagetter-water-level-8454000.json` | latest observation 2026-09-14 16:06 GMT, 1.474 m |
| `datagetter-predictions-latest-8454000.json` | six 6-minute predictions 15:42–16:12 GMT; 16:06 → 1.429 m |
| `datagetter-hilo-greatlakes-9063020.json` | HTTP 400 body: Great Lakes stations have no predictions |
| `datagetter-water-level-igld-9063020.json` | 2026-09-14 16:06 GMT, 174.372 m IGLD |
| `datagetter-water-level-nodata-8551910.json` | HTTP 200 `No data was found…` |
| `datagetter-currents-ACT1616-bin1.json` | 24 MAX_SLACK events, 2026-09-14 01:03 (flood 107.8 cm/s) to 09-16 23:47 (slack), depth 4.6 m, flood 37°, ebb 226° |
| `datagetter-currents-unavailable-ACT5971.json` | HTTP 200 `Currents predictions are not available…` |
| `datagetter-forbidden.json` | API Gateway `{ "message": "Forbidden" }` |

## File Structure

| File | Responsibility |
|---|---|
| `server/providers/tides/normalize.js` | Pure: list URLs, zone mapping, station normalization, datagetter URLs, failure detection, report normalization |
| `server/providers/tides.js` | Handler: routes, list and report caches, stale lists, partial reports, limiter, plugin |
| `server/providers/local.js` | Register and re-export the plugin |
| `src/data/layerState.js` | Registry entries `current-stations` (k) and `tide-stations` (h) |
| `src/layers/tides/model.js` | Pure: layer identities, units, formatting, payload validation, NOAA links, card copy |
| `src/layers/tides/points.js` | Cesium point collection per layer: stations, selection style, pick resolution |
| `src/layers/tides/index.js` | Layer lifecycle, list refresh, click selection, card publication, stats |
| `src/data/tides.js` | Application services and the two default layer instances |
| `src/data/dataCredits.js` | `NOAA_COOPS_CREDIT` |
| `src/app/data.js` | Register both layers |
| `package.json`, `scripts/package-boundaries.json`, `scripts/format-scope.json`, `DATA_SOURCES.md`, `CHANGELOG.md` | Exports, boundaries, formatting scope, docs |

---

### Task 1: Proxy normalization helpers

**Files:**
- Create: `server/providers/tides/normalize.js`
- Test: `src/data/tidesNormalize.test.mjs`

**Interfaces:**
- Consumes: the committed fixtures in `src/data/fixtures/tides-currents/`.
- Produces:
  - Constants:
    - `MDAPI_STATIONS_URL`, `DATAGETTER_URL`, `APPLICATION_NAME = 'CyclopsView'`, `PREDICTION_WINDOW_HOURS = 72`;
    - `STATION_TYPES = { tide: 'waterlevels', current: 'currentpredictions' }`;
    - `STATION_ID_PATTERN = /^[A-Za-z0-9]{1,16}$/`.
  - Station lists:
    - `stationListUrl(kind) → string`
    - `tideStationTimeZone(timezone, state) → string | null`
    - `normalizeTideStations(json) → [{ id, name, lat, lon, state, timeZone, greatLakes }] | null` (sorted by id)
    - `nearestTimeZone({ lat, lon }, tideStations) → string | null`
    - `normalizeCurrentStations(json, tideStations) → [{ id, name, lat, lon, bins, timeZone }] | null`
  - Datagetter URLs:
    - `beginHour(nowMs) → 'yyyyMMdd HH:00'`
    - `hiloUrl(id, nowMs)`, `waterLevelUrl(id, datum)`, `latestPredictionUrl(id)`, `currentsUrl(id, bin, nowMs)`
  - Responses:
    - `upstreamError(json) → string | null`
    - `parseGmtTime('yyyy-MM-dd HH:mm') → ms | null`
    - `normalizeHilo(json) → [{ time, type: 'high'|'low', heightM }] | null`
    - `normalizeWaterLevel(json) → { time, heightM } | null`
    - `predictionAt(json, time) → number | null`
    - `normalizeCurrents(json) → { depthM, floodDirDeg, ebbDirDeg, events: [{ time, type, speedMs }] } | null`

- [ ] **Step 1: Write the failing test**

```js
// src/data/tidesNormalize.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  APPLICATION_NAME,
  DATAGETTER_URL,
  beginHour,
  currentsUrl,
  hiloUrl,
  latestPredictionUrl,
  nearestTimeZone,
  normalizeCurrentStations,
  normalizeCurrents,
  normalizeHilo,
  normalizeTideStations,
  normalizeWaterLevel,
  parseGmtTime,
  predictionAt,
  stationListUrl,
  tideStationTimeZone,
  upstreamError,
  waterLevelUrl,
} from '../../server/providers/tides/normalize.js';

const fixture = (name) =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/tides-currents/${name}`, import.meta.url), 'utf8'),
  );
const NOW = Date.UTC(2026, 8, 14, 16, 10);

/** UTC offset in hours that Intl reports for a zone at an instant. */
function offsetHours(timeZone, ms) {
  const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(ms)
    .find((entry) => entry.type === 'timeZoneName').value;
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(part);
  if (!match) return 0;
  const hours = Number(match[2]) + Number(match[3]) / 60;
  return match[1] === '-' ? -hours : hours;
}

test('station list URLs ask the Metadata API for water-level or current-prediction stations', () => {
  assert.equal(
    stationListUrl('tide'),
    'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=waterlevels',
  );
  assert.equal(
    stationListUrl('current'),
    'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=currentpredictions',
  );
});

test('tide stations keep tidal and Great Lakes stations with an IANA zone, and drop non-tidal ones', () => {
  const stations = normalizeTideStations(fixture('mdapi-waterlevels.json'));
  assert.equal(stations.length, 12);
  assert.equal(stations.some((station) => station.id === '8761955'), false, 'non-tidal Carrollton');
  assert.equal(stations.some((station) => station.id === '9755968'), false, 'non-tidal Salinas');
  assert.deepEqual(
    stations.find((station) => station.id === '8454000'),
    { id: '8454000', name: 'Providence', lat: 41.80717, lon: -71.40067, state: 'RI', timeZone: 'America/New_York', greatLakes: false },
  );
  assert.equal(stations.find((station) => station.id === '9063020').greatLakes, true);
  assert.deepEqual(
    stations.map((station) => station.id),
    [...stations.map((station) => station.id)].sort(),
  );
  assert.equal(normalizeTideStations({}), null);
});

test('station zones reproduce the lst_ldt offsets measured from CO-OPS on 2026-09-14', () => {
  // lst_ldt minus gmt for each station's latest water level, measured live.
  const measured = {
    8454000: -4, 9063020: -4, 8729108: -5, 9410170: -7, 9450460: -8, 9461380: -9,
    1612401: -10, 1619910: -11, 1630000: 10, 1820000: 12, 2695535: -3, 9751364: -4,
  };
  const stations = normalizeTideStations(fixture('mdapi-waterlevels.json'));
  for (const station of stations) {
    assert.equal(offsetHours(station.timeZone, NOW), measured[station.id], `${station.id} ${station.timeZone}`);
  }
  assert.equal(tideStationTimeZone('HAST', 'HI'), 'Pacific/Honolulu');
  assert.equal(tideStationTimeZone('HAST', 'AK'), 'America/Adak');
  assert.equal(tideStationTimeZone('AST', 'Bermuda'), 'Atlantic/Bermuda');
  assert.equal(tideStationTimeZone('AST', 'PR'), 'America/Puerto_Rico');
  assert.equal(tideStationTimeZone('MST', 'AZ'), null);
});

test('current stations group bins per id, drop weak-and-variable and bin 0, and borrow the nearest zone', () => {
  const tides = normalizeTideStations(fixture('mdapi-waterlevels.json'));
  const stations = normalizeCurrentStations(fixture('mdapi-currentpredictions.json'), tides);
  assert.deepEqual(
    stations.map(({ id, bins, timeZone }) => ({ id, bins, timeZone })),
    [
      { id: 'ACT0311', bins: [1, 2], timeZone: 'America/New_York' },
      { id: 'ACT1616', bins: [1], timeZone: 'America/New_York' },
      { id: 'HAI1103', bins: [1, 12, 23], timeZone: 'Pacific/Honolulu' },
      { id: 'PCT0016', bins: [1], timeZone: 'America/Los_Angeles' },
    ],
  );
  const pollockRip = stations.find((station) => station.id === 'ACT1616');
  assert.equal(pollockRip.name, 'Pollock Rip Channel (Butler Hole)');
  assert.equal(pollockRip.lat, 41.55);
  assert.equal(pollockRip.lon, -69.9833);
  assert.equal(nearestTimeZone({ lat: 0, lon: 0 }, []), null);
  assert.equal(normalizeCurrentStations(null, tides), null);
});

test('datagetter URLs request metric GMT JSON over a 72-hour window starting this UTC hour', () => {
  assert.equal(beginHour(NOW), '20260914 16:00');
  const hilo = new URL(hiloUrl('8454000', NOW));
  assert.equal(hilo.origin + hilo.pathname, DATAGETTER_URL);
  assert.deepEqual(Object.fromEntries(hilo.searchParams), {
    product: 'predictions', station: '8454000', begin_date: '20260914 16:00', range: '72',
    datum: 'MLLW', interval: 'hilo', units: 'metric', time_zone: 'gmt', format: 'json',
    application: APPLICATION_NAME,
  });
  assert.deepEqual(Object.fromEntries(new URL(waterLevelUrl('9063020', 'IGLD')).searchParams), {
    product: 'water_level', station: '9063020', date: 'latest', datum: 'IGLD',
    units: 'metric', time_zone: 'gmt', format: 'json', application: APPLICATION_NAME,
  });
  assert.equal(new URL(latestPredictionUrl('8454000')).searchParams.get('date'), 'latest');
  assert.deepEqual(Object.fromEntries(new URL(currentsUrl('ACT1616', 1, NOW)).searchParams), {
    product: 'currents_predictions', station: 'ACT1616', bin: '1', begin_date: '20260914 16:00',
    range: '72', interval: 'MAX_SLACK', units: 'metric', time_zone: 'gmt', format: 'json',
    application: APPLICATION_NAME,
  });
});

test('upstream failures are recognised in all three measured shapes', () => {
  assert.equal(upstreamError(fixture('datagetter-hilo-greatlakes-9063020.json')), "Great Lakes stations don't have Predictions data.");
  assert.match(upstreamError(fixture('datagetter-water-level-nodata-8551910.json')), /^No data was found/);
  assert.equal(upstreamError(fixture('datagetter-currents-unavailable-ACT5971.json')), 'Currents predictions are not available from the requested station.');
  assert.equal(upstreamError(fixture('datagetter-forbidden.json')), 'Forbidden');
  assert.equal(upstreamError(fixture('datagetter-hilo-8454000.json')), null);
  assert.equal(upstreamError(null), 'malformed response');
});

test('high and low predictions, the latest observation and its matching prediction normalize to SI and epoch ms', () => {
  assert.equal(parseGmtTime('2026-09-14 16:06'), Date.UTC(2026, 8, 14, 16, 6));
  assert.equal(parseGmtTime('2026-09-14T16:06'), null);
  const hilo = normalizeHilo(fixture('datagetter-hilo-8454000.json'));
  assert.equal(hilo.length, 12);
  assert.deepEqual(hilo[0], { time: Date.UTC(2026, 8, 14, 2, 34), type: 'high', heightM: 1.445 });
  assert.deepEqual(hilo.at(-1), { time: Date.UTC(2026, 8, 16, 21, 37), type: 'low', heightM: 0.266 });
  const observed = normalizeWaterLevel(fixture('datagetter-water-level-8454000.json'));
  assert.deepEqual(observed, { time: Date.UTC(2026, 8, 14, 16, 6), heightM: 1.474 });
  assert.equal(predictionAt(fixture('datagetter-predictions-latest-8454000.json'), observed.time), 1.429);
  assert.equal(predictionAt(fixture('datagetter-predictions-latest-8454000.json'), NOW), null);
  assert.deepEqual(normalizeWaterLevel(fixture('datagetter-water-level-igld-9063020.json')), {
    time: Date.UTC(2026, 8, 14, 16, 6), heightM: 174.372,
  });
  assert.equal(normalizeWaterLevel(fixture('datagetter-water-level-nodata-8551910.json')), null);
  assert.equal(normalizeHilo({}), null);
});

test('current predictions keep flood, ebb and slack with speeds in m/s and the bin depth', () => {
  const currents = normalizeCurrents(fixture('datagetter-currents-ACT1616-bin1.json'));
  assert.equal(currents.depthM, 4.6);
  assert.equal(currents.floodDirDeg, 37);
  assert.equal(currents.ebbDirDeg, 226);
  assert.equal(currents.events.length, 24);
  assert.deepEqual(currents.events[0], { time: Date.UTC(2026, 8, 14, 1, 3), type: 'flood', speedMs: 1.078 });
  assert.deepEqual(currents.events.at(-1), { time: Date.UTC(2026, 8, 16, 23, 47), type: 'slack', speedMs: 0 });
  assert.equal(normalizeCurrents({ current_predictions: { units: 'feet, knots', cp: [] } }), null);
  assert.equal(normalizeCurrents(fixture('datagetter-currents-unavailable-ACT5971.json')), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/data/tidesNormalize.test.mjs`
Expected: FAIL with `Cannot find module` for `server/providers/tides/normalize.js`.

- [ ] **Step 3: Write the implementation**

```js
// server/providers/tides/normalize.js
export const MDAPI_STATIONS_URL =
  'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json';
export const DATAGETTER_URL =
  'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';
export const APPLICATION_NAME = 'CyclopsView';
export const PREDICTION_WINDOW_HOURS = 72;
/** Layer kind → CO-OPS Metadata API station `type`. */
export const STATION_TYPES = Object.freeze({
  tide: 'waterlevels',
  current: 'currentpredictions',
});
export const STATION_ID_PATTERN = /^[A-Za-z0-9]{1,16}$/;
const HOUR_MS = 3_600_000;
const EARTH_RADIUS_KM = 6371;

/** Metadata `timezone` abbreviation → IANA zone (HAST and AST are split by `state`). */
const ZONES = Object.freeze({
  EST: 'America/New_York',
  CST: 'America/Chicago',
  PST: 'America/Los_Angeles',
  AKST: 'America/Anchorage',
  ChST: 'Pacific/Guam',
  SST: 'Pacific/Pago_Pago',
  NZST: 'Pacific/Kwajalein',
});

const finite = (value) => {
  const number =
    typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : null;
};
const text = (value) => (typeof value === 'string' ? value.trim() : '');
const rounded = (value, digits) => Number(value.toFixed(digits));

export function stationListUrl(kind) {
  return `${MDAPI_STATIONS_URL}?type=${STATION_TYPES[kind]}`;
}

/**
 * The metadata's `observedst` flag is unreliable (Pearl Harbor says true and
 * stays at UTC−10), so zones come from the abbreviation and the state.
 */
export function tideStationTimeZone(timezone, state) {
  if (timezone === 'HAST')
    return state === 'AK' ? 'America/Adak' : 'Pacific/Honolulu';
  if (timezone === 'AST')
    return state === 'Bermuda' ? 'Atlantic/Bermuda' : 'America/Puerto_Rico';
  return ZONES[timezone] ?? null;
}

function coordinates(entry) {
  const lat = finite(entry?.lat);
  const lon = finite(entry?.lng);
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180)
    return null;
  return { lat: rounded(lat, 5), lon: rounded(lon, 5) };
}

/** Tidal and Great Lakes water-level stations; non-tidal stations are dropped. */
export function normalizeTideStations(json) {
  if (!Array.isArray(json?.stations)) return null;
  const byId = new Map();
  for (const entry of json.stations) {
    const id = text(entry?.id);
    if (!STATION_ID_PATTERN.test(id) || byId.has(id)) continue;
    const greatLakes = entry.greatlakes === true;
    if (entry.tidal !== true && !greatLakes) continue;
    const point = coordinates(entry);
    if (!point) continue;
    byId.set(id, {
      id,
      name: text(entry.name) || id,
      ...point,
      state: text(entry.state),
      timeZone: tideStationTimeZone(entry.timezone, entry.state),
      greatLakes,
    });
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function distanceKm(a, b) {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Current stations carry no usable zone; borrow the nearest water-level station's. */
export function nearestTimeZone(point, tideStations) {
  let best = null;
  let bestKm = Number.POSITIVE_INFINITY;
  for (const station of tideStations) {
    if (!station.timeZone) continue;
    const km = distanceKm(point, station);
    if (km < bestKm) {
      bestKm = km;
      best = station;
    }
  }
  return best?.timeZone ?? null;
}

/** One entry per station id with its prediction bins; weak-and-variable (W) and bin 0 are dropped. */
export function normalizeCurrentStations(json, tideStations = []) {
  if (!Array.isArray(json?.stations)) return null;
  const byId = new Map();
  for (const entry of json.stations) {
    const id = text(entry?.id);
    if (!STATION_ID_PATTERN.test(id) || entry.type === 'W') continue;
    const bin = finite(entry.currbin);
    if (!Number.isInteger(bin) || bin < 1) continue;
    const point = coordinates(entry);
    if (!point) continue;
    let station = byId.get(id);
    if (!station) {
      station = {
        id,
        name: text(entry.name) || id,
        ...point,
        bins: [],
        timeZone: null,
      };
      byId.set(id, station);
    }
    if (!station.bins.includes(bin)) station.bins.push(bin);
  }
  const stations = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  for (const station of stations) {
    station.bins.sort((a, b) => a - b);
    station.timeZone = nearestTimeZone(station, tideStations);
  }
  return stations;
}

/** `yyyyMMdd HH:00` in UTC for the hour containing `nowMs`. */
export function beginHour(nowMs) {
  const iso = new Date(Math.floor(nowMs / HOUR_MS) * HOUR_MS).toISOString();
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)} ${iso.slice(11, 16)}`;
}

function datagetterUrl(params) {
  const query = new URLSearchParams({
    ...params,
    units: 'metric',
    time_zone: 'gmt',
    format: 'json',
    application: APPLICATION_NAME,
  });
  return `${DATAGETTER_URL}?${query}`;
}

export function hiloUrl(id, nowMs) {
  return datagetterUrl({
    product: 'predictions',
    station: id,
    begin_date: beginHour(nowMs),
    range: String(PREDICTION_WINDOW_HOURS),
    datum: 'MLLW',
    interval: 'hilo',
  });
}

export function waterLevelUrl(id, datum) {
  return datagetterUrl({
    product: 'water_level',
    station: id,
    date: 'latest',
    datum,
  });
}

export function latestPredictionUrl(id) {
  return datagetterUrl({
    product: 'predictions',
    station: id,
    date: 'latest',
    datum: 'MLLW',
  });
}

export function currentsUrl(id, bin, nowMs) {
  return datagetterUrl({
    product: 'currents_predictions',
    station: id,
    bin: String(bin),
    begin_date: beginHour(nowMs),
    range: String(PREDICTION_WINDOW_HOURS),
    interval: 'MAX_SLACK',
  });
}

/**
 * CO-OPS reports failures three ways: `{ error: { message } }` with HTTP 400,
 * the same body with HTTP 200, and an API-gateway `{ message: 'Forbidden' }`.
 */
export function upstreamError(json) {
  if (!json || typeof json !== 'object') return 'malformed response';
  const message =
    json.error?.message ??
    (typeof json.message === 'string' ? json.message : null);
  if (message === null || message === undefined) return null;
  return String(message).trim() || 'upstream error';
}

/** `yyyy-MM-dd HH:mm` in GMT → epoch ms. */
export function parseGmtTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value))
    return null;
  const ms = Date.parse(`${value.replace(' ', 'T')}:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

export function normalizeHilo(json) {
  if (!Array.isArray(json?.predictions)) return null;
  return json.predictions
    .map((row) => ({
      time: parseGmtTime(row?.t),
      type: row?.type === 'H' ? 'high' : row?.type === 'L' ? 'low' : null,
      heightM: finite(row?.v),
    }))
    .filter((row) => row.time !== null && row.type !== null && row.heightM !== null)
    .sort((a, b) => a.time - b.time);
}

export function normalizeWaterLevel(json) {
  const row = Array.isArray(json?.data) ? json.data.at(-1) : null;
  const time = parseGmtTime(row?.t);
  const heightM = finite(row?.v);
  return time === null || heightM === null ? null : { time, heightM };
}

/** The 6-minute prediction at exactly the observation's timestamp. */
export function predictionAt(json, time) {
  if (!Array.isArray(json?.predictions)) return null;
  return finite(json.predictions.find((row) => parseGmtTime(row?.t) === time)?.v);
}

export function normalizeCurrents(json) {
  const block = json?.current_predictions;
  if (!Array.isArray(block?.cp)) return null;
  if (typeof block.units === 'string' && !block.units.includes('cm/s')) return null;
  const events = block.cp
    .map((row) => ({
      time: parseGmtTime(row?.Time),
      type: ['flood', 'ebb', 'slack'].includes(row?.Type) ? row.Type : null,
      velocity: finite(row?.Velocity_Major),
    }))
    .filter((row) => row.time !== null && row.type !== null && row.velocity !== null)
    .map(({ time, type, velocity }) => ({
      time,
      type,
      speedMs: rounded(Math.abs(velocity) / 100, 3),
    }))
    .sort((a, b) => a.time - b.time);
  const first = block.cp[0] ?? {};
  return {
    depthM: finite(first.Depth),
    floodDirDeg: finite(first.meanFloodDir),
    ebbDirDeg: finite(first.meanEbbDir),
    events,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/data/tidesNormalize.test.mjs`
Expected: PASS, 8 tests. The zone test checks every zone against the offsets measured live, through `Intl`. A failure there means the Node ICU data is incomplete, not that the table is wrong.

- [ ] **Step 5: Commit**

```bash
git add server/providers/tides/normalize.js src/data/tidesNormalize.test.mjs
git commit -m "feat(tides): CO-OPS station and report normalization" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Tides proxy routes, caches and plugin

**Files:**
- Create: `server/providers/tides.js`
- Modify: `server/providers/local.js` (import, plugin entry, re-export)
- Test: `src/data/tidesProxy.test.mjs`

**Interfaces:**
- Consumes:
  - every export of `server/providers/tides/normalize.js` (Task 1);
  - `makeRateLimiter({ windowMs, max, globalMax })` and `clientKey(req)` from `./common/rate-limit.js`;
  - `coalesceProxyRequest(inFlight, key, create) → { promise, shared }` and `readResponseJsonCapped(response, maxBytes)` from `./common/http.js`.
- Produces:
  - `createTidesHandler({ fetchImpl, now, limiter, log, reportCacheLimit }) → handle(req, res)`, mounted at `/api/tides` (so `req.url` is `/stations?…`, `/tide?…` or `/current?…`). `handle.cacheSizes() → { lists, reports }`.
  - `tidesProxy(options) → { name: 'tides-proxy', configureServer, configurePreviewServer }`.
  - Constants: `STATIONS_TTL_MS = 86_400_000`, `STATIONS_RETRY_MS = 600_000`, `REPORT_TTL_MS = 600_000`, `REPORT_CACHE_LIMIT = 500`, `UPSTREAM_TIMEOUT_MS = 15_000`.
  - Response bodies are exactly the spec's shapes: the stations list, the tide report `{ id, kind, datum, generatedAt, sources, predictions, observed }`, and the current report `{ id, kind, bin, generatedAt, sources, depthM, floodDirDeg, ebbDirDeg, events }`.

- [ ] **Step 1: Write the failing test**

```js
// src/data/tidesProxy.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import createViteConfig from '../../vite.config.js';
import {
  REPORT_TTL_MS,
  STATIONS_RETRY_MS,
  STATIONS_TTL_MS,
  createTidesHandler,
} from '../../server/providers/tides.js';

const fixture = (name) =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/tides-currents/${name}`, import.meta.url), 'utf8'),
  );
const T0 = Date.UTC(2026, 8, 14, 16, 10);
const USER_AGENT = 'CyclopsView/0.1 (+https://github.com/CaptPat/gods-eye-view)';

function invoke(handler, url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = { method, url, headers: {}, socket: { remoteAddress: '127.0.0.1' } };
    const res = {
      writeHead(status, headers) {
        this.status = status;
        this.headers = headers || {};
      },
      end(body) {
        const text = String(body || '');
        resolve({ status: this.status, headers: this.headers, json: () => JSON.parse(text) });
      },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

/** Name each upstream request by what it asks CO-OPS for. */
function requestName(href) {
  const url = new URL(href);
  const type = url.searchParams.get('type');
  if (type) return `stations:${type}`;
  const p = Object.fromEntries(url.searchParams);
  if (p.product === 'predictions') return `${p.interval === 'hilo' ? 'hilo' : 'latest'}:${p.station}`;
  if (p.product === 'water_level') return `level:${p.station}:${p.datum}`;
  if (p.product === 'currents_predictions') return `currents:${p.station}:${p.bin}`;
  return `unknown:${href}`;
}

const answers = {
  'stations:waterlevels': () => fixture('mdapi-waterlevels.json'),
  'stations:currentpredictions': () => fixture('mdapi-currentpredictions.json'),
  'hilo:8454000': () => fixture('datagetter-hilo-8454000.json'),
  'level:8454000:MLLW': () => fixture('datagetter-water-level-8454000.json'),
  'latest:8454000': () => fixture('datagetter-predictions-latest-8454000.json'),
  'level:9063020:IGLD': () => fixture('datagetter-water-level-igld-9063020.json'),
  'currents:ACT1616:1': () => fixture('datagetter-currents-ACT1616-bin1.json'),
  'currents:HAI1103:1': () => fixture('datagetter-currents-ACT1616-bin1.json'),
};

function harness(overrides = {}, answerOverrides = {}) {
  const calls = [];
  const table = { ...answers, ...answerOverrides };
  const clock = { now: T0 };
  const fetchImpl = async (url, options = {}) => {
    const name = requestName(String(url));
    calls.push({ name, url: String(url), options });
    const answer = table[name];
    if (!answer) throw new Error(`unexpected upstream ${name}`);
    const value = await answer();
    return value instanceof Response ? value : Response.json(value);
  };
  const handler = createTidesHandler({
    fetchImpl,
    now: () => clock.now,
    limiter: () => true,
    log: () => {},
    ...overrides,
  });
  const count = (name) => calls.filter((call) => call.name === name).length;
  return { handler, calls, count, clock };
}

const forbidden = () => Response.json(fixture('datagetter-forbidden.json'), { status: 403 });

test('tide stations are served from one Metadata API fetch cached for 24 hours', async () => {
  const h = harness();
  const first = await invoke(h.handler, '/stations?kind=tide');
  assert.equal(first.status, 200);
  const body = first.json();
  assert.equal(body.kind, 'tide');
  assert.equal(body.stale, false);
  assert.equal(body.generatedAt, T0);
  assert.equal(body.stations.length, 12);
  assert.equal(h.calls[0].options.headers['User-Agent'], USER_AGENT);
  await invoke(h.handler, '/stations?kind=tide');
  assert.equal(h.count('stations:waterlevels'), 1);
  h.clock.now += STATIONS_TTL_MS;
  await invoke(h.handler, '/stations?kind=tide');
  assert.equal(h.count('stations:waterlevels'), 2);
});

test('current stations are grouped by id with zones taken from the tide list', async () => {
  const h = harness();
  const body = (await invoke(h.handler, '/stations?kind=current')).json();
  assert.equal(body.kind, 'current');
  assert.deepEqual(body.stations.map((station) => station.id), ['ACT0311', 'ACT1616', 'HAI1103', 'PCT0016']);
  assert.deepEqual(body.stations.find((station) => station.id === 'HAI1103').bins, [1, 12, 23]);
  assert.equal(h.count('stations:waterlevels'), 1);
  assert.equal(h.count('stations:currentpredictions'), 1);
  assert.equal((await invoke(h.handler, '/stations?kind=moon')).status, 400);
});

test('a failed list refresh serves the last list as stale and retries after ten minutes; with no list it is 502', async () => {
  const state = { down: false };
  const h = harness({}, {
    'stations:waterlevels': () => (state.down ? forbidden() : fixture('mdapi-waterlevels.json')),
  });
  await invoke(h.handler, '/stations?kind=tide');
  state.down = true;
  h.clock.now = T0 + STATIONS_TTL_MS;
  const stale = (await invoke(h.handler, '/stations?kind=tide')).json();
  assert.equal(stale.stale, true);
  assert.equal(stale.generatedAt, T0);
  assert.equal(stale.stations.length, 12);
  await invoke(h.handler, '/stations?kind=tide');
  assert.equal(h.count('stations:waterlevels'), 2, 'no retry inside the ten-minute window');
  state.down = false;
  h.clock.now += STATIONS_RETRY_MS;
  assert.equal((await invoke(h.handler, '/stations?kind=tide')).json().stale, false);

  const cold = harness({}, { 'stations:waterlevels': forbidden });
  const failed = await invoke(cold.handler, '/stations?kind=tide');
  assert.equal(failed.status, 502);
  assert.deepEqual(failed.json(), { error: 'NOAA CO-OPS unavailable' });
});

test('a tide report joins high/low predictions with the latest observation and its prediction, cached ten minutes', async () => {
  const h = harness();
  const response = await invoke(h.handler, '/tide?id=8454000');
  assert.equal(response.status, 200);
  const body = response.json();
  assert.equal(body.id, '8454000');
  assert.equal(body.kind, 'tide');
  assert.equal(body.datum, 'MLLW');
  assert.equal(body.generatedAt, T0);
  assert.deepEqual(body.sources, { predictions: 'ok', observed: 'ok' });
  assert.equal(body.predictions.length, 12);
  assert.deepEqual(body.observed, { time: Date.UTC(2026, 8, 14, 16, 6), heightM: 1.474, predictedM: 1.429 });
  const hilo = new URL(h.calls.find((call) => call.name === 'hilo:8454000').url);
  assert.equal(hilo.searchParams.get('begin_date'), '20260914 16:00');
  await invoke(h.handler, '/tide?id=8454000');
  assert.equal(h.count('hilo:8454000'), 1);
  h.clock.now += REPORT_TTL_MS;
  await invoke(h.handler, '/tide?id=8454000');
  assert.equal(h.count('hilo:8454000'), 2);
});

test('Great Lakes stations report an IGLD observation and never ask for predictions', async () => {
  const h = harness();
  const body = (await invoke(h.handler, '/tide?id=9063020')).json();
  assert.equal(body.datum, 'IGLD');
  assert.deepEqual(body.sources, { predictions: 'none', observed: 'ok' });
  assert.equal(body.predictions, null);
  assert.deepEqual(body.observed, { time: Date.UTC(2026, 8, 14, 16, 6), heightM: 174.372, predictedM: null });
  assert.equal(h.calls.some((call) => call.name.startsWith('hilo:')), false);
});

test('a partial tide report is served but not cached; a report with nothing is 502', async () => {
  const h = harness({}, {
    'level:8454000:MLLW': () => fixture('datagetter-water-level-nodata-8551910.json'),
  });
  const body = (await invoke(h.handler, '/tide?id=8454000')).json();
  assert.deepEqual(body.sources, { predictions: 'ok', observed: 'unavailable' });
  assert.equal(body.observed, null);
  await invoke(h.handler, '/tide?id=8454000');
  assert.equal(h.count('hilo:8454000'), 2, 'partial reports are refetched');

  const down = harness({}, {
    'hilo:8454000': forbidden,
    'level:8454000:MLLW': forbidden,
    'latest:8454000': forbidden,
  });
  const failed = await invoke(down.handler, '/tide?id=8454000');
  assert.equal(failed.status, 502);
  assert.deepEqual(failed.json(), { error: 'NOAA CO-OPS unavailable' });
});

test('current reports use the lowest bin by default and validate station and bin', async () => {
  const h = harness();
  const body = (await invoke(h.handler, '/current?id=HAI1103')).json();
  assert.equal(body.bin, 1);
  assert.equal(h.count('currents:HAI1103:1'), 1);
  const pollockRip = (await invoke(h.handler, '/current?id=ACT1616&bin=1')).json();
  assert.deepEqual(pollockRip.sources, { predictions: 'ok' });
  assert.equal(pollockRip.depthM, 4.6);
  assert.equal(pollockRip.floodDirDeg, 37);
  assert.equal(pollockRip.ebbDirDeg, 226);
  assert.equal(pollockRip.events.length, 24);
  assert.equal((await invoke(h.handler, '/current?id=ACT1616&bin=2')).status, 400);
  assert.equal((await invoke(h.handler, '/current?id=ACT1616&bin=x')).status, 400);
  assert.equal((await invoke(h.handler, '/current?id=ACT5971')).status, 404, 'weak-and-variable stations are not listed');
  assert.equal((await invoke(h.handler, '/tide?id=8761955')).status, 404, 'non-tidal stations are not listed');
  assert.equal((await invoke(h.handler, '/tide?id=../etc')).status, 404);

  const unavailable = harness({}, {
    'currents:ACT1616:1': () => fixture('datagetter-currents-unavailable-ACT5971.json'),
  });
  assert.equal((await invoke(unavailable.handler, '/current?id=ACT1616')).status, 502);
});

test('the report cache is pruned by age and capped by size', async () => {
  const h = harness({ reportCacheLimit: 2 });
  await invoke(h.handler, '/tide?id=8454000');
  await invoke(h.handler, '/tide?id=9063020');
  await invoke(h.handler, '/current?id=ACT1616');
  assert.equal(h.handler.cacheSizes().reports, 2, 'oldest report evicted at the cap');
  await invoke(h.handler, '/tide?id=8454000');
  assert.equal(h.count('hilo:8454000'), 2, 'the evicted report is refetched');
  h.clock.now += REPORT_TTL_MS;
  await invoke(h.handler, '/current?id=HAI1103');
  assert.equal(h.handler.cacheSizes().reports, 1, 'expired reports pruned on insert');
});

test('rate limits, methods and unknown routes', async () => {
  const limited = harness({ limiter: () => false });
  const refused = await invoke(limited.handler, '/stations?kind=tide');
  assert.equal(refused.status, 429);
  assert.equal(refused.headers['Retry-After'], '10');
  const h = harness();
  assert.equal((await invoke(h.handler, '/stations?kind=tide', 'POST')).status, 405);
  assert.equal((await invoke(h.handler, '/nope')).status, 404);
});

test('the plugin is registered in the Vite config at /api/tides', () => {
  const plugin = createViteConfig({ mode: 'test' }).plugins.find((p) => p.name === 'tides-proxy');
  assert.ok(plugin, 'tides-proxy must be registered');
  const routes = new Map();
  plugin.configureServer({ middlewares: { use: (route, handler) => routes.set(route, handler) } });
  assert.equal(typeof routes.get('/api/tides'), 'function');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/data/tidesProxy.test.mjs`
Expected: FAIL with `Cannot find module` for `server/providers/tides.js`.

- [ ] **Step 3: Write the implementation**

```js
// server/providers/tides.js
import { clientKey, makeRateLimiter } from './common/rate-limit.js';
import { coalesceProxyRequest, readResponseJsonCapped } from './common/http.js';
import {
  STATION_TYPES,
  currentsUrl,
  hiloUrl,
  latestPredictionUrl,
  normalizeCurrentStations,
  normalizeCurrents,
  normalizeHilo,
  normalizeTideStations,
  normalizeWaterLevel,
  predictionAt,
  stationListUrl,
  upstreamError,
  waterLevelUrl,
} from './tides/normalize.js';

export const STATIONS_TTL_MS = 24 * 60 * 60_000;
export const STATIONS_RETRY_MS = 10 * 60_000;
export const REPORT_TTL_MS = 10 * 60_000;
export const REPORT_CACHE_LIMIT = 500;
export const UPSTREAM_TIMEOUT_MS = 15_000;
const MAX_STATION_LIST_BYTES = 8 * 1024 * 1024;
const MAX_DATA_BYTES = 256 * 1024;
const USER_AGENT = 'CyclopsView/0.1 (+https://github.com/CaptPat/gods-eye-view)';
const UNAVAILABLE = 'NOAA CO-OPS unavailable';

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

export function createTidesHandler({
  fetchImpl = (...args) => fetch(...args),
  now = Date.now,
  limiter = makeRateLimiter({ windowMs: 60_000, max: 60, globalMax: 240 }),
  log = (message) => console.warn(message),
  reportCacheLimit = REPORT_CACHE_LIMIT,
} = {}) {
  const inFlight = new Map();
  /** kind → { stations, byId, fetchedAt, checkedAt, stale } */
  const lists = new Map();
  /** cache key → { body, storedAt } */
  const reports = new Map();

  async function getJson(url, maxBytes) {
    const response = await fetchImpl(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    let json = null;
    try {
      json = await readResponseJsonCapped(response, maxBytes);
    } catch (error) {
      if (response.ok) throw error;
    }
    const message = upstreamError(json);
    if (!response.ok || message) {
      throw new Error(message || `HTTP ${response.status}`);
    }
    return json;
  }

  async function loadList(kind) {
    const cached = lists.get(kind);
    const maxAge = cached?.stale ? STATIONS_RETRY_MS : STATIONS_TTL_MS;
    if (cached && now() - cached.checkedAt < maxAge) return cached;
    try {
      const { promise } = coalesceProxyRequest(inFlight, `list:${kind}`, async () => {
        const json = await getJson(stationListUrl(kind), MAX_STATION_LIST_BYTES);
        const stations =
          kind === 'tide'
            ? normalizeTideStations(json)
            : normalizeCurrentStations(json, (await loadList('tide')).stations);
        if (!stations?.length) throw new Error(`empty ${kind} station list`);
        return stations;
      });
      const stations = await promise;
      const entry = {
        stations,
        byId: new Map(stations.map((station) => [station.id, station])),
        fetchedAt: now(),
        checkedAt: now(),
        stale: false,
      };
      lists.set(kind, entry);
      return entry;
    } catch (error) {
      if (!cached) throw error;
      log(`[tides] ${kind} station list refresh failed: ${error.message}`);
      const stale = { ...cached, checkedAt: now(), stale: true };
      lists.set(kind, stale);
      return stale;
    }
  }

  function readReport(key) {
    const hit = reports.get(key);
    if (!hit) return null;
    if (now() - hit.storedAt >= REPORT_TTL_MS) {
      reports.delete(key);
      return null;
    }
    return hit.body;
  }

  function storeReport(key, body) {
    reports.delete(key);
    reports.set(key, { body, storedAt: now() });
    const cutoff = now() - REPORT_TTL_MS;
    for (const [entryKey, entry] of reports) {
      if (entry.storedAt <= cutoff) reports.delete(entryKey);
    }
    while (reports.size > reportCacheLimit) {
      reports.delete(reports.keys().next().value);
    }
  }

  async function attempt(label, task) {
    try {
      return { ok: true, value: await task() };
    } catch (error) {
      log(`[tides] ${label}: ${error?.message ?? error}`);
      return { ok: false, value: null };
    }
  }

  async function tideReport(station) {
    const generatedAt = now();
    const observe = (datum) =>
      attempt(`${station.id} water level`, async () => {
        const level = normalizeWaterLevel(
          await getJson(waterLevelUrl(station.id, datum), MAX_DATA_BYTES),
        );
        if (!level) throw new Error('malformed water level');
        return level;
      });
    if (station.greatLakes) {
      const level = await observe('IGLD');
      return {
        id: station.id,
        kind: 'tide',
        datum: 'IGLD',
        generatedAt,
        sources: { predictions: 'none', observed: level.ok ? 'ok' : 'unavailable' },
        predictions: null,
        observed: level.ok ? { ...level.value, predictedM: null } : null,
      };
    }
    const [hilo, level, latest] = await Promise.all([
      attempt(`${station.id} predictions`, async () => {
        const list = normalizeHilo(
          await getJson(hiloUrl(station.id, generatedAt), MAX_DATA_BYTES),
        );
        if (!list) throw new Error('malformed predictions');
        return list;
      }),
      observe('MLLW'),
      attempt(`${station.id} latest prediction`, () =>
        getJson(latestPredictionUrl(station.id), MAX_DATA_BYTES),
      ),
    ]);
    return {
      id: station.id,
      kind: 'tide',
      datum: 'MLLW',
      generatedAt,
      sources: {
        predictions: hilo.ok ? 'ok' : 'unavailable',
        observed: level.ok ? 'ok' : 'unavailable',
      },
      predictions: hilo.ok ? hilo.value : null,
      observed: level.ok
        ? {
            ...level.value,
            predictedM: latest.ok ? predictionAt(latest.value, level.value.time) : null,
          }
        : null,
    };
  }

  async function currentReport(station, bin) {
    const generatedAt = now();
    const result = await attempt(`${station.id} bin ${bin} currents`, async () => {
      const parsed = normalizeCurrents(
        await getJson(currentsUrl(station.id, bin, generatedAt), MAX_DATA_BYTES),
      );
      if (!parsed) throw new Error('malformed currents');
      return parsed;
    });
    return {
      id: station.id,
      kind: 'current',
      bin,
      generatedAt,
      sources: { predictions: result.ok ? 'ok' : 'unavailable' },
      depthM: result.value?.depthM ?? null,
      floodDirDeg: result.value?.floodDirDeg ?? null,
      ebbDirDeg: result.value?.ebbDirDeg ?? null,
      events: result.value?.events ?? null,
    };
  }

  async function serveReport(res, key, build) {
    const cached = readReport(key);
    if (cached) return sendJson(res, 200, cached);
    const { promise } = coalesceProxyRequest(inFlight, key, build);
    const body = await promise;
    const states = Object.values(body.sources);
    if (!states.includes('ok')) return sendJson(res, 502, { error: UNAVAILABLE });
    // Partial reports are served but never cached, so a transient failure is retried next click.
    if (!states.includes('unavailable')) storeReport(key, body);
    return sendJson(res, 200, body);
  }

  async function route(url, res) {
    const path = url.pathname.replace(/\/+$/, '');
    if (path === '/stations') {
      const kind = url.searchParams.get('kind');
      if (!Object.hasOwn(STATION_TYPES, kind)) {
        return sendJson(res, 400, { error: 'kind must be tide or current' });
      }
      const list = await loadList(kind);
      return sendJson(res, 200, {
        kind,
        stations: list.stations,
        generatedAt: list.fetchedAt,
        stale: list.stale,
      });
    }
    if (path !== '/tide' && path !== '/current') {
      return sendJson(res, 404, { error: 'not found' });
    }
    const kind = path.slice(1);
    const list = await loadList(kind);
    const station = list.byId.get(String(url.searchParams.get('id') ?? ''));
    if (!station) return sendJson(res, 404, { error: 'unknown station' });
    if (kind === 'tide') {
      return serveReport(res, `tide:${station.id}`, () => tideReport(station));
    }
    const binText = url.searchParams.get('bin');
    const bin =
      binText === null ? station.bins[0] : /^\d{1,3}$/.test(binText) ? Number(binText) : Number.NaN;
    if (!station.bins.includes(bin)) {
      return sendJson(res, 400, { error: 'bin is not offered by this station' });
    }
    return serveReport(res, `current:${station.id}:${bin}`, () => currentReport(station, bin));
  }

  async function handle(req, res) {
    try {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
      if (!limiter(clientKey(req))) {
        return sendJson(res, 429, { error: 'rate limited' }, { 'Retry-After': '10' });
      }
      return await route(new URL(req.url || '/', 'http://tides.local'), res);
    } catch (error) {
      log(`[tides] ${error?.message ?? error}`);
      return sendJson(res, 502, { error: UNAVAILABLE });
    }
  }

  handle.cacheSizes = () => ({ lists: lists.size, reports: reports.size });
  return handle;
}

export function tidesProxy(options = {}) {
  const handler = createTidesHandler(options);
  const install = (server) => {
    server.middlewares.use('/api/tides', handler);
  };
  return {
    name: 'tides-proxy',
    configureServer: install,
    configurePreviewServer: install,
  };
}
```

- [ ] **Step 4: Register the plugin in `server/providers/local.js`**

Directly below `import { weatherReportProxy } from './weather-report.js';` add:

```js
import { tidesProxy } from './tides.js';
```

In `localProviderPlugins()`, directly after `    weatherReportProxy(),` add:

```js
    tidesProxy(),
```

`keySetupEndpoint()` must remain the last entry.

Directly after the existing block

```js
export {
  createWeatherReportHandler,
  weatherReportProxy,
} from './weather-report.js';
```

add:

```js

export { createTidesHandler, tidesProxy } from './tides.js';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test src/data/tidesProxy.test.mjs src/data/tidesNormalize.test.mjs`
Expected: PASS, 18 tests (10 + 8).

Then run `node --test src/tooling/viteBuild.test.mjs src/tooling/previewServing.test.mjs`.
Expected: PASS. These check that `gev-key-setup` stays last and that every plugin serves both hooks.

- [ ] **Step 6: Commit**

```bash
git add server/providers/tides.js server/providers/local.js src/data/tidesProxy.test.mjs
git commit -m "feat(tides): caching NOAA CO-OPS proxy at /api/tides" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Layer-state tokens

**Files:**
- Modify: `src/data/layerState.js` (two `LAYER_STATE_REGISTRY` entries)
- Modify: `src/data/layerState.test.mjs` (count +2; one new test)

**Interfaces:**
- Consumes: `LAYER_STATE_REGISTRY`, `encodeLayerStateParams`, `decodeLayerStateParams`, `createDefaultLayerState` (existing).
- Produces: registry ids `current-stations` (token `k`) and `tide-stations` (token `h`), both `enabled-only`. `finalizeRegistrations` in Task 7 requires both ids to be registered layers.

- [ ] **Step 1: Write the failing test**

In `src/data/layerState.test.mjs`, find the test `'production registry is exact, canonical, and rejects incomplete contracts'`. Raise both count assertions by 2 from their current value. At `6462f0a` they read:

```js
  assert.equal(REGISTERED_LAYER_IDS.length, 18);
  assert.equal(new Set(REGISTERED_LAYER_IDS).size, 18);
```

and become:

```js
  assert.equal(REGISTERED_LAYER_IDS.length, 20);
  assert.equal(new Set(REGISTERED_LAYER_IDS).size, 20);
```

If an earlier weather-suite plan has already changed them, add 2 to the value you find instead.

Directly above that test (above the line `test('production registry is exact, canonical, and rejects incomplete contracts', async () => {`), insert:

```js
test('tide and current stations share only their enabled state, as tokens h and k', () => {
  const state = createDefaultLayerState();
  assert.equal(Object.hasOwn(state.options, 'tide-stations'), false);
  assert.equal(Object.hasOwn(state.options, 'current-stations'), false);
  state.enabledLayerIds = ['tide-stations', 'current-stations'];
  const params = encodeLayerStateParams(new URLSearchParams('v=2'), state);
  assert.equal(params.get('l'), 'k.h');
  const options = String(params.get('lo') || '').split('_');
  assert.equal(options.some((entry) => entry.startsWith('h.') || entry.startsWith('k.')), false);
  assert.deepEqual(
    decodeLayerStateParams(new URLSearchParams('v=2&l=h.k')).enabledLayerIds,
    ['current-stations', 'tide-stations'],
  );
});

```

(`lo` is never empty: the flights `models3d` option is always written as `f.e.1`, so the test checks that no `h.`/`k.` option appears.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/data/layerState.test.mjs`
Expected: FAIL. The registry has 18 ids, and `decodeLayerStateParams` rejects the unknown tokens `h`/`k`, so `.enabledLayerIds` reads from `null`.

- [ ] **Step 3: Implement**

In `LAYER_STATE_REGISTRY` in `src/data/layerState.js`, directly after the `cctv` entry, add:

```js
  Object.freeze({ id: 'current-stations', token: 'k', disposition: 'enabled-only' }),
```

and directly after the `telegeography-submarine-cables` entry, add:

```js
  Object.freeze({ id: 'tide-stations', token: 'h', disposition: 'enabled-only' }),
```

Ids stay sorted: the existing test `assert.deepEqual(REGISTERED_LAYER_IDS, [...REGISTERED_LAYER_IDS].sort())` enforces it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test src/data/layerState.test.mjs`
Expected: PASS (the full file, including the new test).

- [ ] **Step 5: Commit**

```bash
git add src/data/layerState.js src/data/layerState.test.mjs
git commit -m "feat(tides): layer-state tokens h and k" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Card model

**Files:**
- Create: `src/layers/tides/model.js`
- Test: `src/layers/tides/model.test.mjs`

**Interfaces:**
- Consumes: report shapes from Task 2. The test builds them with Task 1's normalizers, from fixtures.
- Produces:
  - Constants:
    - `UNITS_STORAGE_KEY = 'gev.weatherReport.units'`, `NOAA_SOURCE = 'NOAA CO-OPS'`;
    - `CARD_LOADING = 'Loading NOAA CO-OPS…'`, `CARD_FAILED = 'NOAA CO-OPS unavailable'`;
    - `STATION_LAYERS = { tide: { kind, id, name, icon, color, selectedSourceId }, current: {…} }`.
  - Helpers:
    - `normalizeUnits(value) → 'imperial' | 'metric'`
    - `cardinal(deg) → 'N'…'NNW' | ''`
    - `parseStationsPayload(payload, kind) → { stations, stale } | null`
  - Formatting:
    - `formatStationTime(ms, timeZone) → 'Mon 16:11 EDT'`
    - `formatHeight(m, units)`, `formatSpeed(ms, units)`, `formatDepth(m, units)`
    - `noaaStationUrl(kind, id, bin)`, `stationTitle(station)`
  - Cards:
    - `buildPendingCard(station, message) → { title, details }`
    - `buildTideCard(station, report, { units, now }) → { title, details }`
    - `buildCurrentCard(station, report, { units, now }) → { title, details }`

- [ ] **Step 1: Write the failing test**

```js
// src/layers/tides/model.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CARD_LOADING,
  STATION_LAYERS,
  UNITS_STORAGE_KEY,
  buildCurrentCard,
  buildPendingCard,
  buildTideCard,
  cardinal,
  formatDepth,
  formatHeight,
  formatSpeed,
  formatStationTime,
  noaaStationUrl,
  normalizeUnits,
  parseStationsPayload,
  stationTitle,
} from './model.js';
import {
  normalizeCurrents,
  normalizeHilo,
  normalizeWaterLevel,
  predictionAt,
} from '../../../server/providers/tides/normalize.js';

const fixture = (name) =>
  JSON.parse(
    readFileSync(new URL(`../../data/fixtures/tides-currents/${name}`, import.meta.url), 'utf8'),
  );
const T0 = Date.UTC(2026, 8, 14, 16, 10);
const PROVIDENCE = { id: '8454000', name: 'Providence', lat: 41.80717, lon: -71.40067, timeZone: 'America/New_York', greatLakes: false };
const BUFFALO = { id: '9063020', name: 'Buffalo', lat: 42.87739, lon: -78.89037, timeZone: 'America/New_York', greatLakes: true };
const POLLOCK_RIP = { id: 'ACT1616', name: 'Pollock Rip Channel (Butler Hole)', lat: 41.55, lon: -69.9833, timeZone: 'America/New_York', bins: [1] };

function tideReport() {
  const observed = normalizeWaterLevel(fixture('datagetter-water-level-8454000.json'));
  return {
    id: '8454000', kind: 'tide', datum: 'MLLW', generatedAt: T0,
    sources: { predictions: 'ok', observed: 'ok' },
    predictions: normalizeHilo(fixture('datagetter-hilo-8454000.json')),
    observed: { ...observed, predictedM: predictionAt(fixture('datagetter-predictions-latest-8454000.json'), observed.time) },
  };
}

function currentReport() {
  return { id: 'ACT1616', kind: 'current', bin: 1, generatedAt: T0, sources: { predictions: 'ok' }, ...normalizeCurrents(fixture('datagetter-currents-ACT1616-bin1.json')) };
}

test('layer identities, units preference and formatting helpers', () => {
  assert.deepEqual(
    Object.values(STATION_LAYERS).map(({ id, name, selectedSourceId }) => [id, name, selectedSourceId]),
    [['tide-stations', 'Tide Stations', 'tide-stations-selected'], ['current-stations', 'Current Stations', 'current-stations-selected']],
  );
  assert.equal(UNITS_STORAGE_KEY, 'gev.weatherReport.units');
  assert.equal(normalizeUnits('metric'), 'metric');
  assert.equal(normalizeUnits(null), 'imperial');
  assert.equal(cardinal(37), 'NE');
  assert.equal(cardinal(226), 'SW');
  assert.equal(cardinal(null), '');
  assert.equal(formatHeight(1.474, 'imperial'), '4.8 ft');
  assert.equal(formatHeight(1.474, 'metric'), '1.47 m');
  assert.equal(formatSpeed(1.042, 'imperial'), '2.0 kn');
  assert.equal(formatSpeed(1.042, 'metric'), '1.04 m/s');
  assert.equal(formatDepth(4.6, 'imperial'), '15 ft');
  assert.equal(formatDepth(4.6, 'metric'), '4.6 m');
  assert.equal(formatHeight(null, 'metric'), '—');
});

test('station times read in the station zone, falling back to UTC', () => {
  assert.equal(formatStationTime(Date.UTC(2026, 8, 14, 20, 11), 'America/New_York'), 'Mon 16:11 EDT');
  assert.equal(formatStationTime(Date.UTC(2026, 8, 14, 20, 11), 'Pacific/Honolulu'), 'Mon 10:11 HST');
  assert.equal(formatStationTime(Date.UTC(2026, 8, 14, 20, 11), null), 'Mon 20:11 UTC');
  assert.equal(formatStationTime(Date.UTC(2026, 8, 14, 20, 11), 'Not/AZone'), 'Mon 20:11 UTC');
});

test('station list payloads are validated per kind', () => {
  const parsed = parseStationsPayload({
    kind: 'current', stale: true,
    stations: [
      { id: 'ACT1616', name: 'Pollock Rip Channel (Butler Hole)', lat: 41.55, lon: -69.9833, bins: [1], timeZone: 'America/New_York' },
      { id: 'NOBINS', name: 'x', lat: 1, lon: 1, bins: [] },
      { id: '', lat: 1, lon: 1, bins: [1] },
      { id: 'BAD', lat: 'x', lon: 1, bins: [1] },
    ],
  }, 'current');
  assert.deepEqual(parsed, { stale: true, stations: [POLLOCK_RIP] });
  assert.equal(parseStationsPayload({ kind: 'tide', stations: [] }, 'current'), null);
  assert.deepEqual(parseStationsPayload({ kind: 'tide', stations: [{ ...PROVIDENCE, greatLakes: 'yes' }] }, 'tide').stations[0].greatLakes, false);
});

test('NOAA links and card titles', () => {
  assert.equal(noaaStationUrl('tide', '8454000'), 'https://tidesandcurrents.noaa.gov/stationhome.html?id=8454000');
  assert.equal(noaaStationUrl('current', 'ACT1616', 1), 'https://tidesandcurrents.noaa.gov/noaacurrents/predictions?id=ACT1616_1');
  assert.equal(stationTitle(PROVIDENCE), 'Providence · 8454000');
  assert.equal(stationTitle(POLLOCK_RIP), 'Pollock Rip Channel (Butler H… · ACT1616');
  assert.deepEqual(buildPendingCard(PROVIDENCE, CARD_LOADING), { title: 'Providence · 8454000', details: ['Loading NOAA CO-OPS…'] });
});

test('a tide card lists the next four highs and lows and the observation against its prediction', () => {
  assert.deepEqual(buildTideCard(PROVIDENCE, tideReport(), { units: 'imperial', now: T0 }), {
    title: 'Providence · 8454000',
    details: [
      'Low 0.4 ft · Mon 16:11 EDT',
      'High 4.4 ft · Mon 23:19 EDT',
      'Low 0.3 ft · Tue 04:18 EDT',
      'High 4.8 ft · Tue 11:45 EDT',
      'Obs 4.8 ft vs pred 4.7 ft · Mon 12:06 EDT',
      'Datum MLLW · click card for NOAA page',
    ],
  });
  const metric = buildTideCard(PROVIDENCE, tideReport(), { units: 'metric', now: T0 }).details;
  assert.equal(metric[0], 'Low 0.12 m · Mon 16:11 EDT');
  assert.equal(metric[4], 'Obs 1.47 m vs pred 1.43 m · Mon 12:06 EDT');
});

test('tide cards report Great Lakes, missing predictions and missing observations honestly', () => {
  const greatLakes = {
    id: '9063020', kind: 'tide', datum: 'IGLD', generatedAt: T0,
    sources: { predictions: 'none', observed: 'ok' }, predictions: null,
    observed: { time: Date.UTC(2026, 8, 14, 16, 6), heightM: 174.372, predictedM: null },
  };
  assert.deepEqual(buildTideCard(BUFFALO, greatLakes, { units: 'metric', now: T0 }).details, [
    'Great Lakes: no tide predictions',
    'Obs 174.37 m · Mon 12:06 EDT',
    'Datum IGLD · click card for NOAA page',
  ]);
  const partial = { ...tideReport(), sources: { predictions: 'unavailable', observed: 'unavailable' }, predictions: null, observed: null };
  assert.deepEqual(buildTideCard(PROVIDENCE, partial, { units: 'imperial', now: T0 }).details, [
    'Tide predictions unavailable',
    'Latest observation unavailable',
    'Datum MLLW · click card for NOAA page',
  ]);
  const late = buildTideCard(PROVIDENCE, tideReport(), { units: 'imperial', now: Date.UTC(2026, 8, 20) }).details;
  assert.equal(late[0], 'No upcoming tides in range');
});

test('a current card shows the next flood and ebb with direction, the next slack and the bin depth', () => {
  assert.deepEqual(buildCurrentCard(POLLOCK_RIP, currentReport(), { units: 'imperial', now: T0 }), {
    title: 'Pollock Rip Channel (Butler H… · ACT1616',
    details: [
      'Bin 1 · depth 15 ft',
      'Flood 2.0 kn NE (37°) · Mon 21:45 EDT',
      'Ebb 1.8 kn SW (226°) · Mon 15:12 EDT',
      'Slack · Mon 12:27 EDT',
      'Click card for NOAA predictions',
    ],
  });
  const metric = buildCurrentCard({ ...POLLOCK_RIP, bins: [1, 12, 23] }, currentReport(), { units: 'metric', now: T0 }).details;
  assert.equal(metric[0], 'Bin 1 · depth 4.6 m · 3 bins');
  assert.equal(metric[1], 'Flood 1.04 m/s NE (37°) · Mon 21:45 EDT');
  const failed = { id: 'ACT1616', kind: 'current', bin: 1, generatedAt: T0, sources: { predictions: 'unavailable' }, depthM: null, floodDirDeg: null, ebbDirDeg: null, events: null };
  assert.deepEqual(buildCurrentCard(POLLOCK_RIP, failed, { units: 'imperial', now: T0 }).details, [
    'Bin 1',
    'Current predictions unavailable',
    'Click card for NOAA predictions',
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/layers/tides/model.test.mjs`
Expected: FAIL with `Cannot find module` for `./model.js`.

- [ ] **Step 3: Write the implementation**

```js
// src/layers/tides/model.js
/** The weather report's units switch; station cards follow the same preference. */
export const UNITS_STORAGE_KEY = 'gev.weatherReport.units';
export const NOAA_SOURCE = 'NOAA CO-OPS';
export const CARD_LOADING = 'Loading NOAA CO-OPS…';
export const CARD_FAILED = 'NOAA CO-OPS unavailable';

export const STATION_LAYERS = Object.freeze({
  tide: Object.freeze({
    kind: 'tide',
    id: 'tide-stations',
    name: 'Tide Stations',
    icon: '🌊',
    color: '#38bdf8',
    selectedSourceId: 'tide-stations-selected',
  }),
  current: Object.freeze({
    kind: 'current',
    id: 'current-stations',
    name: 'Current Stations',
    icon: '🧭',
    color: '#f59e0b',
    selectedSourceId: 'current-stations-selected',
  }),
});

const DASH = '—';
const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const TITLE_NAME_CHARS = 30;
const isNum = (value) => typeof value === 'number' && Number.isFinite(value);

export function normalizeUnits(value) {
  return value === 'metric' ? 'metric' : 'imperial';
}

export function cardinal(deg) {
  if (!isNum(deg)) return '';
  const normalized = ((deg % 360) + 360) % 360;
  return POINTS[Math.round(normalized / 22.5) % 16];
}

/** Validate `/api/tides/stations` for one layer kind. */
export function parseStationsPayload(payload, kind) {
  if (!payload || payload.kind !== kind || !Array.isArray(payload.stations)) return null;
  const stations = [];
  for (const entry of payload.stations) {
    const lat = Number(entry?.lat);
    const lon = Number(entry?.lon);
    if (typeof entry?.id !== 'string' || !entry.id || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const station = {
      id: entry.id,
      name: typeof entry.name === 'string' && entry.name ? entry.name : entry.id,
      lat,
      lon,
      timeZone: typeof entry.timeZone === 'string' && entry.timeZone ? entry.timeZone : null,
    };
    if (kind === 'tide') {
      station.greatLakes = entry.greatLakes === true;
    } else {
      station.bins = Array.isArray(entry.bins) ? entry.bins.filter((bin) => Number.isInteger(bin) && bin > 0) : [];
      if (!station.bins.length) continue;
    }
    stations.push(station);
  }
  return { stations, stale: payload.stale === true };
}

/** `Mon 16:11 EDT` in the station's zone, or UTC when the zone is unknown. */
export function formatStationTime(ms, timeZone) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || 'UTC',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'short',
    }).formatToParts(ms);
  } catch {
    return timeZone ? formatStationTime(ms, null) : DASH;
  }
  const part = (type) => parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('weekday')} ${part('hour')}:${part('minute')} ${part('timeZoneName')}`;
}

export function formatHeight(meters, units) {
  if (!isNum(meters)) return DASH;
  return units === 'metric' ? `${meters.toFixed(2)} m` : `${(meters * 3.28084).toFixed(1)} ft`;
}

export function formatSpeed(metersPerSecond, units) {
  if (!isNum(metersPerSecond)) return DASH;
  return units === 'metric'
    ? `${metersPerSecond.toFixed(2)} m/s`
    : `${(metersPerSecond * 1.943844).toFixed(1)} kn`;
}

export function formatDepth(meters, units) {
  if (!isNum(meters)) return DASH;
  return units === 'metric' ? `${meters.toFixed(1)} m` : `${Math.round(meters * 3.28084)} ft`;
}

export function noaaStationUrl(kind, id, bin) {
  const station = encodeURIComponent(id);
  return kind === 'current'
    ? `https://tidesandcurrents.noaa.gov/noaacurrents/predictions?id=${station}_${bin}`
    : `https://tidesandcurrents.noaa.gov/stationhome.html?id=${station}`;
}

export function stationTitle(station) {
  const name =
    station.name.length > TITLE_NAME_CHARS ? `${station.name.slice(0, TITLE_NAME_CHARS - 1)}…` : station.name;
  return `${name} · ${station.id}`;
}

export function buildPendingCard(station, message) {
  return { title: stationTitle(station), details: [message] };
}

/** The next four highs and lows, the latest observation against its prediction, and the datum. */
export function buildTideCard(station, report, { units, now }) {
  const system = normalizeUnits(units);
  const zone = station.timeZone;
  const details = [];
  if (station.greatLakes) {
    details.push('Great Lakes: no tide predictions');
  } else if (report.sources?.predictions === 'ok') {
    const next = (report.predictions ?? []).filter((entry) => entry.time > now).slice(0, 4);
    if (!next.length) details.push('No upcoming tides in range');
    for (const entry of next) {
      const label = entry.type === 'high' ? 'High' : 'Low';
      details.push(`${label} ${formatHeight(entry.heightM, system)} · ${formatStationTime(entry.time, zone)}`);
    }
  } else {
    details.push('Tide predictions unavailable');
  }
  if (report.observed) {
    const predicted = isNum(report.observed.predictedM)
      ? ` vs pred ${formatHeight(report.observed.predictedM, system)}`
      : '';
    details.push(
      `Obs ${formatHeight(report.observed.heightM, system)}${predicted} · ${formatStationTime(report.observed.time, zone)}`,
    );
  } else {
    details.push('Latest observation unavailable');
  }
  details.push(`Datum ${report.datum} · click card for NOAA page`);
  return { title: stationTitle(station), details };
}

/** The next maximum flood and ebb with direction, the next slack, and the bin depth. */
export function buildCurrentCard(station, report, { units, now }) {
  const system = normalizeUnits(units);
  const zone = station.timeZone;
  const bin = [`Bin ${report.bin}`];
  if (isNum(report.depthM)) bin.push(`depth ${formatDepth(report.depthM, system)}`);
  if (station.bins.length > 1) bin.push(`${station.bins.length} bins`);
  const details = [bin.join(' · ')];
  if (report.sources?.predictions !== 'ok') {
    details.push('Current predictions unavailable');
  } else {
    const upcoming = (report.events ?? []).filter((event) => event.time > now);
    const next = (type) => upcoming.find((event) => event.type === type);
    const flow = (label, event, deg) =>
      event
        ? `${label} ${formatSpeed(event.speedMs, system)} ${cardinal(deg)} (${Math.round(deg)}°) · ${formatStationTime(event.time, zone)}`
        : `${label} ${DASH}`;
    details.push(flow('Flood', next('flood'), report.floodDirDeg));
    details.push(flow('Ebb', next('ebb'), report.ebbDirDeg));
    const slack = next('slack');
    details.push(slack ? `Slack · ${formatStationTime(slack.time, zone)}` : `Slack ${DASH}`);
  }
  details.push('Click card for NOAA predictions');
  return { title: stationTitle(station), details };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/layers/tides/model.test.mjs`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/layers/tides/model.js src/layers/tides/model.test.mjs
git commit -m "feat(tides): station card model in station-local time" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Station points

**Files:**
- Create: `src/layers/tides/points.js`
- Test: `src/layers/tides/points.test.mjs`

**Interfaces:**
- Consumes: Cesium `PointPrimitiveCollection`, `Cartesian3`, `Color`, `NearFarScalar`, `BlendOption`; `viewer.scene.primitives.add/remove`.
- Produces:
  - Constants: `POINT_PIXEL_SIZE = 7`, `SELECTED_PIXEL_SIZE = 13`, `POINT_HEIGHT_M = 5`, `DEPTH_TEST_DISTANCE_M = 50_000`.
  - `stationPickId(layerId, stationId) → '<layerId>:<stationId>'`
  - `createStationPoints(viewer, { layerId, color, createCollection? })` returns:
    - `setStations(stations) → count`
    - `setSelected(id | null)`, `selectedId()`, `positionOf(id) → Cartesian3 | null`
    - `stationIdFromPick(picked) → id | null`
    - `setShow(boolean)`, `count()`, `destroy()`

- [ ] **Step 1: Write the failing test**

```js
// src/layers/tides/points.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  DEPTH_TEST_DISTANCE_M,
  POINT_PIXEL_SIZE,
  SELECTED_PIXEL_SIZE,
  createStationPoints,
  stationPickId,
} from './points.js';

const STATIONS = [
  { id: '8454000', name: 'Providence', lat: 41.80717, lon: -71.40067 },
  { id: '9063020', name: 'Buffalo', lat: 42.87739, lon: -78.89037 },
];

function fakeViewer() {
  const primitives = [];
  return {
    primitives,
    scene: {
      primitives: {
        add(primitive) { primitives.push(primitive); return primitive; },
        remove(primitive) { const index = primitives.indexOf(primitive); if (index >= 0) primitives.splice(index, 1); return index >= 0; },
      },
    },
  };
}

test('stations become hidden, pickable points in one collection added to the scene', () => {
  const viewer = fakeViewer();
  const points = createStationPoints(viewer, { layerId: 'tide-stations', color: '#38bdf8' });
  assert.equal(viewer.primitives.length, 1);
  const [collection] = viewer.primitives;
  assert.ok(collection instanceof Cesium.PointPrimitiveCollection);
  assert.equal(collection.show, false);
  assert.equal(points.setStations(STATIONS), 2);
  assert.equal(collection.length, 2);
  const first = collection.get(0);
  assert.equal(first.id, 'tide-stations:8454000');
  assert.equal(first.pixelSize, POINT_PIXEL_SIZE);
  assert.equal(first.disableDepthTestDistance, DEPTH_TEST_DISTANCE_M);
  assert.equal(first.color.toCssHexString(), '#38bdf8');
  const carto = Cesium.Cartographic.fromCartesian(points.positionOf('8454000'));
  assert.ok(Math.abs(Cesium.Math.toDegrees(carto.latitude) - 41.80717) < 1e-6);
  points.setShow(true);
  assert.equal(collection.show, true);
  assert.equal(stationPickId('current-stations', 'ACT1616'), 'current-stations:ACT1616');
});

test('picks resolve only this layer’s stations, from either pick path', () => {
  const points = createStationPoints(fakeViewer(), { layerId: 'tide-stations', color: '#38bdf8' });
  points.setStations(STATIONS);
  assert.equal(points.stationIdFromPick({ primitive: { id: 'tide-stations:9063020' } }), '9063020');
  assert.equal(points.stationIdFromPick({ id: 'tide-stations:8454000' }), '8454000');
  assert.equal(points.stationIdFromPick({ primitive: { id: 'current-stations:8454000' } }), null);
  assert.equal(points.stationIdFromPick({ primitive: { id: 'tide-stations:0000000' } }), null);
  assert.equal(points.stationIdFromPick(undefined), null);
});

test('selection enlarges one point, survives a station refresh, and clears when its station disappears', () => {
  const viewer = fakeViewer();
  const points = createStationPoints(viewer, { layerId: 'tide-stations', color: '#38bdf8' });
  points.setStations(STATIONS);
  points.setSelected('9063020');
  const collection = viewer.primitives[0];
  assert.equal(collection.get(1).pixelSize, SELECTED_PIXEL_SIZE);
  points.setSelected('8454000');
  assert.equal(collection.get(1).pixelSize, POINT_PIXEL_SIZE);
  assert.equal(collection.get(0).pixelSize, SELECTED_PIXEL_SIZE);
  points.setStations(STATIONS);
  assert.equal(points.selectedId(), '8454000');
  assert.equal(collection.get(0).pixelSize, SELECTED_PIXEL_SIZE);
  points.setStations(STATIONS.slice(1));
  assert.equal(points.selectedId(), null);
  points.setSelected('nope');
  assert.equal(points.selectedId(), null);
  points.destroy();
  assert.equal(viewer.primitives.length, 0);
  assert.equal(points.count(), 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/layers/tides/points.test.mjs`
Expected: FAIL with `Cannot find module` for `./points.js`.

- [ ] **Step 3: Write the implementation**

```js
// src/layers/tides/points.js
import * as Cesium from 'cesium';

export const POINT_PIXEL_SIZE = 7;
export const SELECTED_PIXEL_SIZE = 13;
export const POINT_HEIGHT_M = 5;
/** Inside this camera distance a station draws through terrain and 3D tiles. */
export const DEPTH_TEST_DISTANCE_M = 50_000;
const SCALE_BY_DISTANCE = new Cesium.NearFarScalar(50_000, 1.2, 12_000_000, 0.55);
const OUTLINE = Cesium.Color.BLACK.withAlpha(0.6);

export function stationPickId(layerId, stationId) {
  return `${layerId}:${stationId}`;
}

/**
 * One PointPrimitiveCollection per layer, the bikeshare pattern: a few thousand
 * points cost one draw call, are frustum-culled by Cesium, and hide behind the
 * globe through the depth test.
 */
export function createStationPoints(
  viewer,
  {
    layerId,
    color,
    createCollection = () =>
      new Cesium.PointPrimitiveCollection({ blendOption: Cesium.BlendOption.TRANSLUCENT }),
  },
) {
  const collection = createCollection();
  collection.show = false;
  viewer.scene.primitives.add(collection);
  const base = Cesium.Color.fromCssColorString(color);
  const points = new Map();
  let selectedId = null;

  function applyStyle(point, selected) {
    point.pixelSize = selected ? SELECTED_PIXEL_SIZE : POINT_PIXEL_SIZE;
    point.outlineColor = selected ? Cesium.Color.WHITE : OUTLINE;
    point.outlineWidth = selected ? 2 : 1;
  }

  return {
    setStations(stations) {
      collection.removeAll();
      points.clear();
      for (const station of stations) {
        const point = collection.add({
          id: stationPickId(layerId, station.id),
          position: Cesium.Cartesian3.fromDegrees(station.lon, station.lat, POINT_HEIGHT_M),
          color: base,
          scaleByDistance: SCALE_BY_DISTANCE,
          disableDepthTestDistance: DEPTH_TEST_DISTANCE_M,
        });
        applyStyle(point, false);
        points.set(station.id, point);
      }
      if (selectedId !== null && points.has(selectedId)) applyStyle(points.get(selectedId), true);
      else selectedId = null;
      return points.size;
    },
    setSelected(stationId) {
      if (selectedId !== null && points.has(selectedId)) applyStyle(points.get(selectedId), false);
      selectedId = stationId !== null && points.has(stationId) ? stationId : null;
      if (selectedId !== null) applyStyle(points.get(selectedId), true);
    },
    selectedId: () => selectedId,
    positionOf(stationId) {
      return points.get(stationId)?.position ?? null;
    },
    /** A scene.pick result → this layer's station id, or null. */
    stationIdFromPick(picked) {
      const raw =
        typeof picked?.primitive?.id === 'string'
          ? picked.primitive.id
          : typeof picked?.id === 'string'
            ? picked.id
            : null;
      const prefix = `${layerId}:`;
      if (!raw?.startsWith(prefix)) return null;
      const stationId = raw.slice(prefix.length);
      return points.has(stationId) ? stationId : null;
    },
    setShow(show) {
      collection.show = Boolean(show);
    },
    count: () => points.size,
    destroy() {
      points.clear();
      selectedId = null;
      viewer.scene.primitives.remove(collection);
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/layers/tides/points.test.mjs`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/layers/tides/points.js src/layers/tides/points.test.mjs
git commit -m "feat(tides): station point collection with selection and picking" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Station layers, application services and credit

**Files:**
- Create: `src/layers/tides/index.js`, `src/data/tides.js`
- Modify: `src/data/dataCredits.js` (add `NOAA_COOPS_CREDIT` directly after `IEM_NEXRAD_CREDIT`)
- Test: `src/layers/tides/index.test.mjs`

**Interfaces:**
- Consumes:
  - Task 4: everything in `model.js`.
  - Task 5: `createStationPoints`.
  - The overlay host contract from `src/overlays/worldOverlay.js`: `setEntries(sourceId, entries, options)`, `setVisible(sourceId, visible)`, `clearSource(sourceId)`, and `hitTest(x, y, { sourceId }) → { sourceId, entryId, entry, rect } | null`. `hitTest` only sees entries with `interactive: true`.
  - `registerDynamicCredit(viewer, credit)` and `governorRequestRender(reason)`.
  - The manager contract:
    - `init(viewer)`, `enable(viewer)`, `disable(viewer)`, `update(viewer, { signal })` (on enable and every `refreshInterval`), `destroy(viewer)`;
    - `getStats()`.
- Produces:
  - Layer factories:
    - `createNoaaStationsLayer({ kind, overlayHost, fetchImpl, createPoints, createClickHandler, requestRender, registerCredit, credit, storage, openUrl, documentTarget, now }) → layer`
    - `createTideStationsLayer(options)`, `createCurrentStationsLayer(options)`
  - Layer fields: `id`, `name`, `icon`, `source: 'NOAA CO-OPS'`, `updateInterval: 0`, `refreshInterval: 3_600_000`. Methods: `init`, `enable`, `disable`, `update`, `destroy`, `getStats`.
  - Constants: `STATION_LIST_MAX_AGE_MS = 21_600_000`, `STATION_REFRESH_CHECK_MS = 3_600_000`, `SELECTED_SOURCE_OPTIONS = { cohortLimit: 1, collisionCapacity: 0, moving: false }`.
  - `src/data/tides.js`:
    - `createTideStationsLayer(options)` and `createCurrentStationsLayer(options)`, with application services;
    - `tideStationsLayer`, `currentStationsLayer`;
    - default export `[tideStationsLayer, currentStationsLayer]`;
    - `export *` of the layer module.
  - `NOAA_COOPS_CREDIT` in `src/data/dataCredits.js`.

- [ ] **Step 1: Write the failing test**

```js
// src/layers/tides/index.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CARD_FAILED,
  CARD_LOADING,
  SELECTED_SOURCE_OPTIONS,
  STATION_LIST_MAX_AGE_MS,
  STATION_REFRESH_CHECK_MS,
  createCurrentStationsLayer,
  createTideStationsLayer,
} from './index.js';
import { SELECTED_PIXEL_SIZE } from './points.js';
import { DataLayerManager } from '../../data/manager.js';
import defaultLayers, { currentStationsLayer, tideStationsLayer } from '../../data/tides.js';
import { NOAA_COOPS_CREDIT } from '../../data/dataCredits.js';
import {
  normalizeCurrentStations,
  normalizeCurrents,
  normalizeHilo,
  normalizeTideStations,
  normalizeWaterLevel,
  predictionAt,
} from '../../../server/providers/tides/normalize.js';

const fixture = (name) =>
  JSON.parse(
    readFileSync(new URL(`../../data/fixtures/tides-currents/${name}`, import.meta.url), 'utf8'),
  );
const T0 = Date.UTC(2026, 8, 14, 16, 10);
const TIDES = normalizeTideStations(fixture('mdapi-waterlevels.json'));
const CURRENTS = normalizeCurrentStations(fixture('mdapi-currentpredictions.json'), TIDES);

function tideReport() {
  const observed = normalizeWaterLevel(fixture('datagetter-water-level-8454000.json'));
  return {
    id: '8454000', kind: 'tide', datum: 'MLLW', generatedAt: T0,
    sources: { predictions: 'ok', observed: 'ok' },
    predictions: normalizeHilo(fixture('datagetter-hilo-8454000.json')),
    observed: { ...observed, predictedM: predictionAt(fixture('datagetter-predictions-latest-8454000.json'), observed.time) },
  };
}

function currentReport(id = 'ACT1616') {
  return { id, kind: 'current', bin: 1, generatedAt: T0, sources: { predictions: 'ok' }, ...normalizeCurrents(fixture('datagetter-currents-ACT1616-bin1.json')) };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function fakeOverlay() {
  const state = { entries: new Map(), options: new Map(), visible: new Map(), hit: null };
  return {
    state,
    setEntries(sourceId, entries, options) { state.entries.set(sourceId, entries); state.options.set(sourceId, options); },
    clearSource(sourceId) { state.entries.delete(sourceId); },
    setVisible(sourceId, visible) { state.visible.set(sourceId, visible); },
    hitTest: () => state.hit,
  };
}

function harness(kind, { answers = {} } = {}) {
  const overlay = fakeOverlay();
  const requests = [];
  const renders = [];
  const opened = [];
  const credited = [];
  const clock = { now: T0 };
  const storage = { value: null, getItem: (key) => (key === 'gev.weatherReport.units' ? storage.value : null) };
  const documentTarget = new EventTarget();
  const primitives = [];
  const pick = { result: null };
  const viewer = {
    scene: {
      primitives: {
        add: (primitive) => { primitives.push(primitive); return primitive; },
        remove: (primitive) => { primitives.splice(primitives.indexOf(primitive), 1); return true; },
      },
      pick: () => pick.result,
    },
  };
  const click = { handler: null, destroyed: 0 };
  const table = {
    '/api/tides/stations?kind=tide': () => ({ kind: 'tide', stations: TIDES, generatedAt: T0, stale: false }),
    '/api/tides/stations?kind=current': () => ({ kind: 'current', stations: CURRENTS, generatedAt: T0, stale: false }),
    '/api/tides/tide?id=8454000': () => tideReport(),
    '/api/tides/current?id=ACT1616&bin=1': () => currentReport(),
    ...answers,
  };
  const options = {
    overlayHost: overlay,
    fetchImpl: async (url) => {
      requests.push(url);
      const answer = table[url];
      if (!answer) throw new Error(`unexpected ${url}`);
      const value = await answer();
      return value instanceof Response ? value : Response.json(value);
    },
    createClickHandler: (_viewer, onClick) => {
      click.handler = onClick;
      return { destroy: () => { click.destroyed += 1; } };
    },
    requestRender: (reason) => renders.push(reason),
    registerCredit: (_viewer, credit) => credited.push(credit?.key),
    credit: { key: 'noaa-coops', html: 'NOAA' },
    storage,
    openUrl: (url) => opened.push(url),
    documentTarget,
    now: () => clock.now,
  };
  const layer = kind === 'tide' ? createTideStationsLayer(options) : createCurrentStationsLayer(options);
  const setPick = (id) => { pick.result = id ? { primitive: { id } } : null; };
  const pointFor = (id) => {
    const collection = primitives[0];
    for (let i = 0; i < collection.length; i += 1) if (collection.get(i).id === id) return collection.get(i);
    return null;
  };
  return { layer, overlay, requests, renders, opened, credited, clock, storage, documentTarget, viewer, primitives, click, table, setPick, pointFor };
}

async function enabled(h) {
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  assert.equal(await h.layer.update(h.viewer, {}), true);
}

/** The row text the Layers panel renders for this layer's current stats. */
const rowText = (layer) =>
  new DataLayerManager({})._buildMetaText({ source: layer.source, stats: layer.getStats(), enabled: true, lifecycleState: 'enabled' });

test('both layers identify themselves and refresh hourly; the default instances carry the NOAA credit', () => {
  const tide = harness('tide').layer;
  const current = harness('current').layer;
  assert.deepEqual([tide.id, tide.name, tide.icon, tide.source], ['tide-stations', 'Tide Stations', '🌊', 'NOAA CO-OPS']);
  assert.deepEqual([current.id, current.name, current.icon, current.source], ['current-stations', 'Current Stations', '🧭', 'NOAA CO-OPS']);
  assert.equal(tide.updateInterval, 0);
  assert.equal(tide.refreshInterval, STATION_REFRESH_CHECK_MS);
  assert.equal(STATION_REFRESH_CHECK_MS, 3_600_000);
  assert.equal(STATION_LIST_MAX_AGE_MS, 21_600_000);
  assert.deepEqual(defaultLayers.map((layer) => layer.id), ['tide-stations', 'current-stations']);
  assert.equal(tideStationsLayer, defaultLayers[0]);
  assert.equal(currentStationsLayer, defaultLayers[1]);
  assert.equal(
    NOAA_COOPS_CREDIT.html,
    'Tides and currents: <a href="https://tidesandcurrents.noaa.gov/" target="_blank" rel="noopener">NOAA CO-OPS</a>',
  );
  assert.throws(() => createTideStationsLayer({}), /overlay host/);
});

test('enabling credits NOAA, loads the station list into points and requests a render', async () => {
  const h = harness('tide');
  await enabled(h);
  assert.deepEqual(h.credited, ['noaa-coops']);
  assert.deepEqual(h.requests, ['/api/tides/stations?kind=tide']);
  assert.equal(h.primitives[0].length, 12);
  assert.equal(h.primitives[0].show, true);
  assert.ok(h.renders.includes('tide-stations'));
  assert.equal(h.overlay.state.visible.get('tide-stations-selected'), true);
  assert.deepEqual(h.layer.getStats(), { count: 12, lastUpdate: T0 });
  assert.match(rowText(h.layer), /^NOAA CO-OPS · /);
});

test('the list is refetched only after six hours, and failures report on the row without failing the layer', async () => {
  const h = harness('tide');
  await enabled(h);
  assert.equal(await h.layer.update(h.viewer, {}), true);
  assert.equal(h.requests.length, 1, 'a fresh list costs no request');
  h.clock.now += STATION_LIST_MAX_AGE_MS;
  h.table['/api/tides/stations?kind=tide'] = () => new Response('{}', { status: 502 });
  assert.equal(await h.layer.update(h.viewer, {}), true);
  assert.equal(h.requests.length, 2);
  assert.deepEqual(h.layer.getStats(), { stale: true, count: 12, lastUpdate: T0, error: 'Station list refresh failed' });
  assert.equal(rowText(h.layer), 'STALE · NOAA CO-OPS · Station list refresh failed');
  assert.equal(h.primitives[0].length, 12, 'the last good stations stay on the globe');

  const cold = harness('current', { answers: { '/api/tides/stations?kind=current': () => new Response('{}', { status: 502 }) } });
  await enabled(cold);
  assert.deepEqual(cold.layer.getStats(), { count: 0, lastUpdate: null, error: 'Station list unavailable' });
  assert.equal(rowText(cold.layer), 'UNAVAILABLE · NOAA CO-OPS · Station list unavailable');

  const staleList = harness('tide', { answers: { '/api/tides/stations?kind=tide': () => ({ kind: 'tide', stations: TIDES, generatedAt: T0, stale: true }) } });
  await enabled(staleList);
  assert.deepEqual(staleList.layer.getStats(), { stale: true, count: 12, lastUpdate: T0 });
  assert.match(rowText(staleList.layer), /^STALE · NOAA CO-OPS · /);

  const gate = deferred();
  const slow = harness('tide', { answers: { '/api/tides/stations?kind=tide': () => gate.promise } });
  slow.layer.init(slow.viewer);
  slow.layer.enable(slow.viewer);
  const pending = slow.layer.update(slow.viewer, {});
  assert.equal(rowText(slow.layer), 'NOAA CO-OPS · Loading stations');
  gate.resolve({ kind: 'tide', stations: TIDES, generatedAt: T0, stale: false });
  assert.equal(await pending, true);

  const aborted = new AbortController();
  aborted.abort();
  assert.equal(await slow.layer.update(slow.viewer, { signal: aborted.signal }), false, 'only a manager abort is a failure');
});

test('clicking a tide station shows a loading card, then the NOAA report in the preferred units', async () => {
  const h = harness('tide');
  await enabled(h);
  h.storage.value = 'metric';
  h.setPick('tide-stations:8454000');
  const settled = h.click.handler({ x: 10, y: 20 });
  const [loading] = h.overlay.state.entries.get('tide-stations-selected');
  assert.equal(loading.id, 'tide-stations:8454000');
  assert.equal(loading.title, 'Providence · 8454000');
  assert.deepEqual(loading.details, [CARD_LOADING]);
  assert.equal(loading.variant, 'selected');
  assert.equal(loading.protected, true);
  assert.equal(loading.interactive, true);
  assert.equal(loading.accessibilityLabel, 'Open NOAA page for Providence');
  assert.equal(h.overlay.state.options.get('tide-stations-selected'), SELECTED_SOURCE_OPTIONS);
  assert.equal(h.pointFor('tide-stations:8454000').pixelSize, SELECTED_PIXEL_SIZE);
  const rendersBefore = h.renders.length;
  await settled;
  assert.equal(h.requests.at(-1), '/api/tides/tide?id=8454000');
  const [card] = h.overlay.state.entries.get('tide-stations-selected');
  assert.equal(card.details.length, 6);
  assert.equal(card.details[0], 'Low 0.12 m · Mon 16:11 EDT');
  assert.ok(rendersBefore > 2, 'selection restyling requested a render');
  card.activate();
  assert.deepEqual(h.opened, ['https://tidesandcurrents.noaa.gov/stationhome.html?id=8454000']);
  h.overlay.state.hit = { sourceId: 'tide-stations-selected', entryId: 'tide-stations:8454000' };
  h.click.handler({ x: 10, y: 20 });
  assert.equal(h.opened.length, 2, 'a click on the card opens the station page');
});

test('current cards use the lowest bin, a newer click supersedes an older one, and a failed report says so', async () => {
  const gate = deferred();
  const h = harness('current', {
    answers: {
      '/api/tides/current?id=HAI1103&bin=1': () => gate.promise,
      '/api/tides/current?id=PCT0016&bin=1': () => new Response('{}', { status: 502 }),
    },
  });
  await enabled(h);
  h.setPick('current-stations:HAI1103');
  const first = h.click.handler({ x: 1, y: 1 });
  h.setPick('current-stations:ACT1616');
  await h.click.handler({ x: 2, y: 2 });
  gate.resolve(currentReport('HAI1103'));
  await first;
  assert.ok(h.requests.includes('/api/tides/current?id=HAI1103&bin=1'));
  const [card] = h.overlay.state.entries.get('current-stations-selected');
  assert.equal(card.id, 'current-stations:ACT1616');
  assert.equal(card.details[1], 'Flood 2.0 kn NE (37°) · Mon 21:45 EDT');
  card.activate();
  assert.deepEqual(h.opened, ['https://tidesandcurrents.noaa.gov/noaacurrents/predictions?id=ACT1616_1']);
  h.setPick('current-stations:PCT0016');
  await h.click.handler({ x: 3, y: 3 });
  assert.deepEqual(h.overlay.state.entries.get('current-stations-selected')[0].details, [CARD_FAILED]);
});

test('empty clicks and Escape clear the card; disable hides everything and re-enabling needs no refetch', async () => {
  const h = harness('tide');
  await enabled(h);
  h.setPick('tide-stations:8454000');
  await h.click.handler({ x: 1, y: 1 });
  h.setPick(null);
  h.click.handler({ x: 5, y: 5 });
  assert.equal(h.overlay.state.entries.has('tide-stations-selected'), false);
  assert.equal(h.pointFor('tide-stations:8454000').pixelSize < SELECTED_PIXEL_SIZE, true);
  h.setPick('tide-stations:8454000');
  await h.click.handler({ x: 1, y: 1 });
  h.documentTarget.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
  assert.equal(h.overlay.state.entries.has('tide-stations-selected'), false);

  h.layer.disable(h.viewer);
  assert.equal(h.primitives[0].show, false);
  assert.equal(h.primitives[0].length, 0);
  assert.equal(h.click.destroyed, 1);
  assert.equal(h.overlay.state.visible.get('tide-stations-selected'), false);
  assert.equal(h.click.handler({ x: 1, y: 1 }), undefined, 'a disabled layer ignores clicks');

  h.layer.enable(h.viewer);
  assert.equal(await h.layer.update(h.viewer, {}), true);
  assert.equal(h.requests.filter((url) => url.startsWith('/api/tides/stations')).length, 1);
  assert.equal(h.primitives[0].length, 12);
  h.layer.destroy(h.viewer);
  assert.equal(h.primitives.length, 0);
});

test('a storage failure falls back to imperial units', async () => {
  const h = harness('tide');
  h.storage.getItem = () => { throw new Error('denied'); };
  await enabled(h);
  h.setPick('tide-stations:8454000');
  await h.click.handler({ x: 1, y: 1 });
  assert.equal(h.overlay.state.entries.get('tide-stations-selected')[0].details[0], 'Low 0.4 ft · Mon 16:11 EDT');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/layers/tides/index.test.mjs`
Expected: FAIL with `Cannot find module` for `./index.js`.

- [ ] **Step 3: Add the credit**

In `src/data/dataCredits.js`, directly after the closing `});` of `export const IEM_NEXRAD_CREDIT = Object.freeze({ … });`, add:

```js

export const NOAA_COOPS_CREDIT = Object.freeze({
  key: 'noaa-coops',
  html: 'Tides and currents: <a href="https://tidesandcurrents.noaa.gov/" target="_blank" rel="noopener">NOAA CO-OPS</a>',
});
```

- [ ] **Step 4: Write the layer**

```js
// src/layers/tides/index.js
import * as Cesium from 'cesium';
import {
  CARD_FAILED,
  CARD_LOADING,
  NOAA_SOURCE,
  STATION_LAYERS,
  UNITS_STORAGE_KEY,
  buildCurrentCard,
  buildPendingCard,
  buildTideCard,
  noaaStationUrl,
  normalizeUnits,
  parseStationsPayload,
} from './model.js';
import { createStationPoints } from './points.js';

export * from './model.js';
export { createStationPoints, stationPickId } from './points.js';

/** Station metadata changes rarely: refetch a list at most every six hours. */
export const STATION_LIST_MAX_AGE_MS = 6 * 60 * 60_000;
/** Manager refresh cadence; a tick inside the max age costs no request. */
export const STATION_REFRESH_CHECK_MS = 60 * 60_000;
export const SELECTED_SOURCE_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 0,
  moving: false,
});

function defaultClickHandler(viewer, onClick) {
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction((click) => onClick(click.position), Cesium.ScreenSpaceEventType.LEFT_CLICK);
  return { destroy: () => handler.destroy() };
}

/** One NOAA CO-OPS station layer: `kind` is 'tide' or 'current'. */
export function createNoaaStationsLayer({
  kind,
  overlayHost,
  fetchImpl = (...args) => fetch(...args),
  createPoints = createStationPoints,
  createClickHandler = defaultClickHandler,
  requestRender = () => {},
  registerCredit = () => false,
  credit = null,
  storage = null,
  openUrl = () => {},
  documentTarget = globalThis.document,
  now = Date.now,
} = {}) {
  const meta = STATION_LAYERS[kind];
  if (!meta) throw new TypeError('kind must be tide or current');
  if (!overlayHost) throw new TypeError('NOAA station layers require an overlay host');

  let viewer = null;
  let points = null;
  let clickHandler = null;
  let enabled = false;
  let stations = [];
  let byId = new Map();
  let lastUpdate = null;
  let error = null;
  let stale = false;
  let loading = false;
  let listRequest = null;
  /** { station, bin, report, failed, controller } for the open card. */
  let selected = null;

  const units = () => {
    try {
      return normalizeUnits(storage?.getItem?.(UNITS_STORAGE_KEY));
    } catch {
      return 'imperial';
    }
  };

  function publishCard({ title, details }) {
    const position = selected && points?.positionOf(selected.station.id);
    if (!position) return;
    const { station, bin } = selected;
    const url = noaaStationUrl(kind, station.id, bin);
    overlayHost.setEntries(
      meta.selectedSourceId,
      [
        {
          id: `${meta.id}:${station.id}`,
          position,
          variant: 'selected',
          selected: true,
          protected: true,
          paintLane: 'selected',
          collisionGroup: 'ambient-card',
          priority: Number.MAX_SAFE_INTEGER,
          title,
          details,
          accent: meta.color,
          interactive: true,
          accessibilityLabel: `Open NOAA page for ${station.name}`,
          activate: () => {
            openUrl(url);
            return true;
          },
          anchorRadiusPx: 9,
          minAnchorGapPx: 11,
          verticalOnly: true,
          placement: 'above',
          edgeFade: 'keyhole',
          horizonCull: true,
          terrainOcclusion: false,
        },
      ],
      SELECTED_SOURCE_OPTIONS,
    );
  }

  function renderSelected() {
    if (!selected) return;
    const { station, report, failed } = selected;
    if (failed) return publishCard(buildPendingCard(station, CARD_FAILED));
    if (!report) return publishCard(buildPendingCard(station, CARD_LOADING));
    const options = { units: units(), now: now() };
    return publishCard(
      kind === 'tide' ? buildTideCard(station, report, options) : buildCurrentCard(station, report, options),
    );
  }

  function clearSelection() {
    if (!selected) return;
    selected.controller.abort();
    selected = null;
    points?.setSelected(null);
    overlayHost.clearSource(meta.selectedSourceId);
    requestRender(meta.id);
  }

  async function selectStation(stationId) {
    const station = byId.get(stationId);
    if (!station || selected?.station.id === stationId) return;
    clearSelection();
    const controller = new AbortController();
    const bin = kind === 'current' ? station.bins[0] : null;
    selected = { station, bin, report: null, failed: false, controller };
    points.setSelected(stationId);
    // Point restyling is a scene mutation the idle governor does not see.
    requestRender(meta.id);
    renderSelected();
    const query =
      kind === 'tide'
        ? `/api/tides/tide?id=${encodeURIComponent(stationId)}`
        : `/api/tides/current?id=${encodeURIComponent(stationId)}&bin=${bin}`;
    try {
      const response = await fetchImpl(query, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const report = await response.json();
      if (selected?.controller !== controller) return;
      selected.report = report;
    } catch {
      if (controller.signal.aborted || selected?.controller !== controller) return;
      selected.failed = true;
    }
    renderSelected();
  }

  function handleClick(position) {
    if (!enabled || !viewer || !points) return undefined;
    if (selected && overlayHost.hitTest?.(position?.x, position?.y, { sourceId: meta.selectedSourceId })) {
      openUrl(noaaStationUrl(kind, selected.station.id, selected.bin));
      return undefined;
    }
    const stationId = points.stationIdFromPick(viewer.scene.pick(position));
    if (stationId) return selectStation(stationId);
    clearSelection();
    return undefined;
  }

  const onKeyDown = (event) => {
    if (event?.key === 'Escape' && selected) clearSelection();
  };

  const layer = {
    id: meta.id,
    name: meta.name,
    icon: meta.icon,
    source: NOAA_SOURCE,
    updateInterval: 0,
    refreshInterval: STATION_REFRESH_CHECK_MS,

    init(nextViewer) {
      viewer = nextViewer;
      points = createPoints(nextViewer, { layerId: meta.id, color: meta.color });
      overlayHost.setVisible(meta.selectedSourceId, false);
    },

    enable(nextViewer) {
      enabled = true;
      registerCredit(nextViewer, credit);
      points.setStations(stations);
      points.setShow(true);
      overlayHost.setVisible(meta.selectedSourceId, true);
      clickHandler ??= createClickHandler(nextViewer, handleClick);
      documentTarget?.addEventListener?.('keydown', onKeyDown);
      requestRender(meta.id);
    },

    disable() {
      enabled = false;
      listRequest?.abort();
      listRequest = null;
      loading = false;
      clearSelection();
      clickHandler?.destroy();
      clickHandler = null;
      documentTarget?.removeEventListener?.('keydown', onKeyDown);
      if (points) {
        points.setShow(false);
        points.setStations([]);
      }
      overlayHost.setVisible(meta.selectedSourceId, false);
      requestRender(meta.id);
    },

    async update(_viewer, { signal } = {}) {
      if (!enabled || !points || signal?.aborted) return false;
      const fresh = stations.length && !stale && lastUpdate !== null && now() - lastUpdate < STATION_LIST_MAX_AGE_MS;
      if (fresh) return true;
      listRequest?.abort();
      const controller = new AbortController();
      listRequest = controller;
      const onAbort = () => controller.abort();
      signal?.addEventListener?.('abort', onAbort, { once: true });
      loading = true;
      try {
        const response = await fetchImpl(`/api/tides/stations?kind=${kind}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const parsed = parseStationsPayload(await response.json(), kind);
        if (!parsed?.stations.length) throw new Error('malformed station list');
        if (!enabled || listRequest !== controller) return true;
        stations = parsed.stations;
        byId = new Map(stations.map((station) => [station.id, station]));
        stale = parsed.stale;
        error = null;
        lastUpdate = now();
        points.setStations(stations);
        if (selected && !byId.has(selected.station.id)) clearSelection();
        // Async list results mutate primitives outside a manager frame.
        requestRender(meta.id);
        return true;
      } catch {
        if (signal?.aborted) return false;
        if (controller.signal.aborted) return true;
        // Reported through getStats(): an enabled row saying why beats a failed enable.
        error = stations.length ? 'Station list refresh failed' : 'Station list unavailable';
        return true;
      } finally {
        if (listRequest === controller) {
          listRequest = null;
          loading = false;
        }
        signal?.removeEventListener?.('abort', onAbort);
      }
    },

    destroy() {
      layer.disable();
      overlayHost.clearSource(meta.selectedSourceId);
      points?.destroy();
      points = null;
      viewer = null;
      stations = [];
      byId = new Map();
    },

    getStats() {
      const count = stations.length;
      if (loading) return { loading: true, loadingLabel: 'Loading stations', count, lastUpdate };
      if (error && !count) return { count: 0, lastUpdate: null, error };
      if (error) return { stale: true, count, lastUpdate, error };
      if (stale) return { stale: true, count, lastUpdate };
      return { count, lastUpdate };
    },
  };
  return layer;
}

export function createTideStationsLayer(options = {}) {
  return createNoaaStationsLayer({ ...options, kind: 'tide' });
}

export function createCurrentStationsLayer(options = {}) {
  return createNoaaStationsLayer({ ...options, kind: 'current' });
}
```

- [ ] **Step 5: Write the application services**

```js
// src/data/tides.js
import {
  createCurrentStationsLayer as createCurrentLayer,
  createTideStationsLayer as createTideLayer,
} from '../layers/tides/index.js';
import { NOAA_COOPS_CREDIT, registerDynamicCredit } from './dataCredits.js';
import { governorRequestRender } from '../renderGovernor.js';
import {
  clearOverlaySource,
  hitTestWorldOverlay,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';

export * from '../layers/tides/index.js';

/** Read-only view of the weather report's units preference. */
const browserStorage = Object.freeze({
  getItem: (key) => globalThis.localStorage?.getItem(key) ?? null,
});

/** The application's overlay host, render governor, credit display and browser services. */
function applicationServices() {
  return {
    overlayHost: {
      setEntries: setOverlayEntries,
      setVisible: setOverlaySourceVisible,
      clearSource: clearOverlaySource,
      hitTest: hitTestWorldOverlay,
    },
    requestRender: governorRequestRender,
    registerCredit: registerDynamicCredit,
    credit: NOAA_COOPS_CREDIT,
    storage: browserStorage,
    openUrl: (url) => globalThis.open?.(url, '_blank', 'noopener,noreferrer'),
  };
}

export function createTideStationsLayer(options = {}) {
  return createTideLayer({ ...applicationServices(), ...options });
}

export function createCurrentStationsLayer(options = {}) {
  return createCurrentLayer({ ...applicationServices(), ...options });
}

export const tideStationsLayer = createTideStationsLayer();
export const currentStationsLayer = createCurrentStationsLayer();

export default [tideStationsLayer, currentStationsLayer];
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test src/layers/tides/index.test.mjs src/layers/tides/model.test.mjs src/layers/tides/points.test.mjs`
Expected: PASS, 17 tests (7 + 7 + 3).

- [ ] **Step 7: Commit**

```bash
git add src/layers/tides/index.js src/layers/tides/index.test.mjs src/data/tides.js src/data/dataCredits.js
git commit -m "feat(tides): tide and current station layers with NOAA cards" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Registration, package wiring, docs and CI parity

**Files:**
- Modify: `src/app/data.js`, `package.json` (`exports`), `scripts/package-boundaries.json`, `scripts/format-scope.json`, `DATA_SOURCES.md`, `CHANGELOG.md`

**Interfaces:**
- Consumes:
  - Task 6: the default export of `src/data/tides.js` (two layers).
  - Task 3: registry entries `tide-stations` and `current-stations`, which `finalizeRegistrations(LAYER_STATE_REGISTRY)` requires to be registered.
  - Task 2: `tidesProxy()`, already registered.
- Produces: both layers in the production catalog, and a green CI-parity run.

Out of scope (not in the spec): the voice/OpenAI tool layer enums in `server/providers/openai/tools.js` and `src/voice/gevActions.js`. No test requires them to list every layer.

- [ ] **Step 1: Register the layers**

In `src/app/data.js`, directly after `import weatherRadarLayer from '../data/weatherRadar.js';` add:

```js
import tideAndCurrentLayers from '../data/tides.js';
```

and directly after `  weatherRadarLayer.attachMapStack(mapStackController);` add:

```js
  for (const layer of tideAndCurrentLayers) dataManager.register(layer);
```

- [ ] **Step 2: Declare the package exports**

In `package.json` `exports`, directly after the block

```json
    "./server/providers/weather-report": {
      "node": "./server/providers/weather-report.js"
    },
```

add:

```json
    "./server/providers/tides": {
      "node": "./server/providers/tides.js"
    },
```

and directly after `    "./layers/weather-radar": "./src/layers/weather-radar/index.js",` add:

```json
    "./layers/tides": "./src/layers/tides/index.js",
```

- [ ] **Step 3: Add the boundary groups and application modules**

In `scripts/package-boundaries.json`, directly after the closing `},` of the `"weather-report-provider"` group (the line before `"firms-provider": {`), add:

```json
  "tides-provider": {
    "runtime": "node",
    "exports": ["./server/providers/tides"],
    "modules": [
      "server/providers/tides.js",
      "server/providers/tides/normalize.js",
      "server/providers/common/rate-limit.js",
      "server/providers/common/http.js"
    ],
    "external": []
  },
```

Directly after the closing `},` of the `"weather-radar-layer"` group (the line before `"weather-report": {`), add:

```json
  "tides-layer": {
    "exports": ["./layers/tides"],
    "modules": [
      "src/layers/tides/index.js",
      "src/layers/tides/model.js",
      "src/layers/tides/points.js"
    ],
    "external": ["cesium"]
  },
```

`src/app/data.js` now imports `src/data/tides.js`, so the `"application-components"` group's `modules` must list it and everything it imports. Inside that group:
- directly after `"src/data/terrainHeights.js",` add `"src/data/tides.js",`;
- directly after `"src/layers/submarineCables/surface.js",` add:

```json
      "src/layers/tides/index.js",
      "src/layers/tides/model.js",
      "src/layers/tides/points.js",
```

The other modules `src/data/tides.js` imports (`src/data/dataCredits.js`, `src/renderGovernor.js`, `src/overlays/worldOverlay.js`) are already listed. The layer group excludes `src/data/tides.js`, as `earthquakes` excludes `src/data/earthquakes.js`.

- [ ] **Step 4: Run the boundary check**

Run: `npm run check:boundaries`
Expected: exit 0, with these lines in the output:
```
Checked tides-provider: 1 exports, 4 owned modules.
Checked tides-layer: 1 exports, 3 owned modules.
```
If it reports `imports an unowned module`, the named file is a real import. Add it to that group's `modules` only if the group owns that helper; never add another layer's path.

- [ ] **Step 5: Bring the new files into formatting scope and format them**

Append these entries to the end of the JSON array in `scripts/format-scope.json`, after `"src/toolProjectRoot.test.mjs"` (add a comma to that line):

```json
  "server/providers/tides.js",
  "server/providers/tides/normalize.js",
  "src/data/tides.js",
  "src/data/tidesNormalize.test.mjs",
  "src/data/tidesProxy.test.mjs",
  "src/layers/tides/index.js",
  "src/layers/tides/index.test.mjs",
  "src/layers/tides/model.js",
  "src/layers/tides/model.test.mjs",
  "src/layers/tides/points.js",
  "src/layers/tides/points.test.mjs"
```

Run: `npm run format`, then `npm run format:check`
Expected: the check exits 0. The plan's code blocks use long lines, so `format` rewrites the new files to Prettier's 80-column style. That is expected, and the rewrite is part of this commit.

- [ ] **Step 6: Document the source and the change**

In `DATA_SOURCES.md`, in the live-sources table, directly after the **Iowa Environmental Mesonet** row add:

```markdown
| **NOAA CO-OPS** (Tides &amp; Currents Metadata API `mdapi` and Data API `datagetter`) | Tide Stations and Current Stations layers: station lists, high/low tide predictions, latest observed water level, maximum flood/ebb and slack current predictions (US and territories) | U.S. Government work (public domain); keyless; proxied through `/api/tides` with station lists cached 24 h and station reports 10 min | "Tides and currents: NOAA CO-OPS" linked to tidesandcurrents.noaa.gov, registered when either layer is first enabled |
```

At the top of `CHANGELOG.md`, directly under `# Changelog` and its blank line, add:

```markdown
## Tide and current stations (fork)

- Add Tide Stations and Current Stations layers from NOAA CO-OPS (US and territories), served
  through a caching `/api/tides` proxy.
- Click a station for a card with the next high and low tides and the latest observation against
  its prediction, or the next maximum flood, ebb and slack with direction and bin depth, in
  station-local time. Click the card to open the NOAA station page.
- Units follow the weather report's °F/°C switch. Share links carry only whether each layer is on
  (tokens `h` and `k`).

```

- [ ] **Step 7: Run the full CI-parity sequence**

Run each in order, stopping at the first failure:

```bash
npm run format:check
npm run check:boundaries
npm test
npm run build
```

Expected: all four exit 0.
- `npm test` discovers every `src/**/*.test.mjs`, including the five new files and `src/data/layerState.test.mjs` with the raised count.
- On a Node other than 24 the runner skips its two allocation microbenchmarks with a warning, which is still exit 0.

- [ ] **Step 8: Smoke-check the proxy once against CO-OPS**

Keep this to four requests. CO-OPS blocks bursts.
1. Start the dev server in the background on a free port: `npx vite --port 5199 --strictPort`. Do not open the app, so no AISStream connection is spent.
2. Run:

   ```bash
   curl -s "http://localhost:5199/api/tides/stations?kind=tide" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j.kind,j.stations.length,j.stale)})"
   curl -s "http://localhost:5199/api/tides/stations?kind=current" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j.kind,j.stations.length,j.stale)})"
   curl -s "http://localhost:5199/api/tides/tide?id=8454000"
   curl -s "http://localhost:5199/api/tides/current?id=ACT1616"
   ```

   Expected:
   - `tide 290 false`, then `current 2553 false`. Counts may drift by a few as NOAA edits its metadata.
   - The tide report has `"sources":{"predictions":"ok","observed":"ok"}`.
   - The current report has `"sources":{"predictions":"ok"}` and a non-empty `events` array.
3. Stop the dev server and confirm the port refuses connections.

- [ ] **Step 9: Commit**

```bash
git add src/app/data.js package.json scripts/package-boundaries.json scripts/format-scope.json DATA_SOURCES.md CHANGELOG.md server/providers/tides.js server/providers/tides src/data/tides.js src/data/tidesNormalize.test.mjs src/data/tidesProxy.test.mjs src/layers/tides
git commit -m "feat(tides): register tide and current stations, boundaries and docs" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
