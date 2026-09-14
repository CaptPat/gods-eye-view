# Severe weather layer — design

Status: approved design (2026-09-14), not yet implemented
Fork: CaptPat/gods-eye-view (Cyclops View). Fork-only work; nothing is proposed upstream.

## Purpose

Show where official weather alerts are in force across the US, and where major natural hazards
are unfolding worldwide, as one on/off data layer. Clicking an area or event shows a card with the
essentials and a link to the full report.

## Place in the weather suite

This is sub-project 5 of 5. Each sub-project has its own spec, plan and build:

1. Weather radar (`2026-09-14-weather-radar-design.md`).
2. Right-click weather report (`2026-09-14-weather-report-design.md`).
3. Tide stations and current stations.
4. Gridded weather overlays.
5. **Severe weather** (this document).

## Sources (measured 2026-09-14, about 16:05 UTC)

| Source | What was measured | Consequence |
|---|---|---|
| NWS `GET https://api.weather.gov/alerts/active` (`Accept: application/geo+json`) | HTTP 200, 1,277,996 bytes, 0.15 s. `Cache-Control: public, max-age=2, s-maxage=5`. 291 features: 290 `Actual` and 1 `Test`. Only **3** carry geometry (all `Polygon`). The rest list `affectedZones`: 959 unique zones (926 forecast, of which 701 land and 225 marine; 29 fire; 4 county), up to 55 per alert | The server resolves zone shapes; `Test` messages are dropped |
| NWS `GET /zones?id=A,B,C&include_geometry=true` | HTTP 200, but every feature has `geometry: null` | Zone shapes must be fetched one zone at a time |
| NWS `GET https://api.weather.gov/zones/{forecast\|county\|fire}/{ID}` | All 959 fetched at concurrency 4 with an identifying `User-Agent`: 11.7 s, 65,752,732 bytes, 959 × 200, no 429. Per zone: land averages 24 KB / 227 positions; marine 109 KB / 1,027; fire 349 KB / 3,486; largest `AKZ825` 531 KB. County zones return a `GeometryCollection` of `MultiPolygon`. There is no simplified-geometry option | Server-side simplification and a long-lived disk cache |
| Douglas–Peucker over all 959 zone shapes | Raw 613,743 positions. Tolerance 0.002° → 121,423; 0.005° → 58,293; **0.01° → 32,853**; 0.02° → 18,991 | Simplify at 0.01° (about 1.1 km) |
| api.weather.gov documentation | `User-Agent` required, ideally with contact details. The rate limit is not public; an exceeded limit returns an error that "may be retried after the limit clears (typically within 5 seconds)". Open data, free for any use (U.S. Government public domain) | Conservative concurrency; a 429 or 503 ends the round |
| NWS alert timing fields | Offsets are the issuing office's local time. In 4 of 6 kept fixture alerts, `expires` (message expiry) is earlier than `ends` (hazard end); for example, a Flood Watch has `expires` 2026-09-14 16:00 and `ends` 2026-09-19 16:00 (−08:00). `onset` was null in 1 of 291 alerts | Show onset (else effective) to ends (else expires) |
| NWS alert links | `web` is always `http://www.weather.gov`. `https://api.weather.gov/alerts/{id}` returns `application/geo+json`, which is not a page. `alerts.weather.gov` did not resolve from this network. `https://forecast.weather.gov/MapClick.php?lat=..&lon=..` returns 200 `text/html`, the point forecast page that lists active hazards | The card links to that page for the clicked spot |
| GDACS `GET https://www.gdacs.org/gdacsapi/api/events/geteventlist/EVENTS4APP` | HTTP 200, 141,083 bytes, 0.6–1.0 s (6.7 s in an earlier measurement). 100 events, all `Point` centroids. Types: FL 6, TC 2, DR 13, EQ 17, WF 62. Alert levels: Green 95, Orange 5. `iscurrent` true for 88. Dates carry no offset (UTC). No BOM | The event list |
| GDACS `geteventlist/SEARCH` | 98 events, Orange and Red only, all `iscurrent` false (historic) | Not used |
| GDACS `geteventlist/MAP` | Without `eventtype`, 400 "Eventtype is required"; a comma list is also 400. `?eventtype=TC` returns 200, 973,609 bytes, 2.4 s, with 213 features for 3 cyclones: `Point_Centroid` 3; `Point_Polygon_Point` 102 wind circles (13,158 positions); `Poly_Green`/`Orange`/`Red` buffers (2,647 positions); `Line_Line` 99 two-point track segments; `Poly_Cones` 3 (723 positions). The segments are listed out of order (cyclone 1001321 has 2 gaps in index order that close when joined by endpoints). `?eventtype=VO` returns 404 when there are none; FL and DR carry only points; WF carries burnt-area polygons (4,278 positions) | The track and cone are taken from the TC map only |
| GDACS terms (`https://www.gdacs.org/About/termofuse.aspx`) | A cooperation of the UN (OCHA, UNOSAT) and the European Commission (JRC, ECHO). Information is "as is", indicative, and not a substitute for official alerts. No licence text beyond the disclaimer; `report.aspx` links return 200 | Credit states it is indicative, not official |
| Google Weather API `publicAlerts:lookup` | Point lookup; works with the key (measured during sub-project 2) | **Not used** here. A possible later addition to the right-click weather report |
| This design's proxy, run live at about 16:40 UTC with the zone cache warm from the 16:05 fetch | HTTP 200 in 2.9 s, 897,908-byte body. NWS: 294 alerts, 1,022 zones (67 new since 16:05), 34,232 simplified positions, 0 unmapped. GDACS: 82 events (FL 6, TC 2, DR 13, WF 61; EQ excluded), both cyclones with tracks | The body size and render budget hold on real data |

## Rulings

- **One on/off layer.** Id `severe-weather`, name `Severe Weather`, icon `⚠️`, share-link token
  `v`, disposition `enabled-only` (the Dams and FIRMS pattern). No options and no row chips.
- **NWS.**
  - Keep only `status === 'Actual'` alerts.
  - An alert with its own polygon uses it; otherwise its zones are drawn.
  - A zone shared by several alerts is drawn **once**, coloured by its highest-ranked alert. The
    card says `+N more: …` for the others, which keeps geometry bounded and the colours readable.
  - No polygon union, so internal zone borders stay visible. Reason: no geometry dependency, and
    zones are the NWS unit.
- **Rank and colour.** The category comes from the event name, the conventional
  warning/watch/advisory palette:

  | Category | Match | Colour |
  |---|---|---|
  | Emergency | `Emergency` | `#ff2d95` |
  | Warning | `Warning` | `#ff3b30` |
  | Watch | `Watch` | `#ff9500` |
  | Advisory | `Advisory` | `#ffcc00` |
  | Statement | anything else | `#5ac8fa` |

  Rank = category (5, 4, 3, 2, 1) × 10 + severity (Extreme 4, Severe 3, Moderate 2, Minor 1,
  Unknown 0).
- **Simplification.** Douglas–Peucker at 0.01°, coordinates rounded to 4 decimals. Rings that fall
  below 4 positions are dropped. This applies to zone shapes, alert polygons and GDACS cones.
- **Render budget.** At most 150,000 NWS positions, about 4.5× the measured quiet-day total. Beyond
  that, the lowest-ranked areas are hidden and the row counts them.
- **GDACS.**
  - EVENTS4APP is the event list; SEARCH returns only historic events.
  - Earthquakes (EQ) are excluded, because the app has a USGS Earthquakes layer.
  - Events with an unknown alert level are skipped.
  - Every event is a point coloured by alert level: Green `#34c759`, Orange `#ff9500`,
    Red `#ff3b30`.
  - Tropical cyclones add their joined track and forecast cone from `MAP?eventtype=TC`, fetched
    only when the list holds a TC.
  - Wind circles and wind buffers are not drawn (15,805 positions of clutter). Wildfire burnt
    areas are not drawn; the FIRMS layer covers fires.
- **Cadence.**
  - The client refreshes every 5 minutes and skips while the tab is hidden.
  - The server keeps NWS for 5 minutes and GDACS for 15.
  - A source whose refresh fails is served stale for up to 60 minutes after its last success,
    then reported unavailable. This is checked at response-build time against the source's own
    age, not only when a refresh happens to run, so it cannot outlive 60 minutes just because the
    next refresh isn't due yet.
  - A source that already has servable data (fresh, or stale within the 60-minute window) answers
    immediately; a refresh that's due for it starts in the background and is never awaited. A
    source with nothing servable is awaited, capped by a response budget
    (`RESPONSE_BUDGET_MS = 25_000`, injectable) so one slow or unreachable source never delays a
    response from the other. Only one refresh per source is ever in flight; a request that arrives
    while one is already running joins it rather than starting a second.
- **Zone cache.**
  - Simplified shapes are stored on disk at `.gev-cache/severe-weather/zones/<type>_<ID>.json`
    and kept for 7 days (file mtime).
  - At most once an hour, a refresh deletes files older than 7 days.
  - A 404 is remembered in memory for 1 hour.
  - A 429 or 503 stops the rest of the round (60 s back-off, shorter than the 5-minute refresh).
  - Resolution stops after 30 s; the cold fetch was measured at 11.7 s. At the deadline, zone
    fetches still in flight are aborted (a combined `AbortSignal.any([timeout, deadline])`), not
    just left to finish late — an aborted zone is not remembered as a 404 and not cached. Unresolved
    zones wait for the next refresh and are counted as unmapped alerts.
- **Politeness and limits.**
  - `User-Agent: CyclopsView/0.1 (+https://github.com/CaptPat/gods-eye-view)`.
  - Zone concurrency 4.
  - 20 s upstream timeout; GDACS took up to 6.7 s.
  - Response caps: 8 MB for alerts, 4 MB per zone, 6 MB for GDACS.
  - Proxy rate limit: 30 requests per minute per client and 120 overall. The client polls once
    every 5 minutes.
- **Times on the card.** NWS times are shown in the offset NWS wrote, which is the alert area's
  local time, with a `UTC−8`-style label using U+2212 as the weather report does. GDACS dates are
  shown as UTC dates.
- **Card link.**
  - NWS: `https://forecast.weather.gov/MapClick.php?lat=<lat>&lon=<lon>` at the clicked spot
    (4 decimals), because the alert's own URL is JSON (measured above).
  - GDACS: the event's `report.aspx` link, accepted only when it matches
    `https://www.gdacs.org/report.aspx?eventid=…&episodeid=…&eventtype=XX`.
- **Partial failure.** One source down is **degraded**, not a failed refresh: the row names it and
  the manager records no refresh error. Only a failed request to the proxy is a refresh failure.

## Scope

In scope:
- the `/api/severe-weather` proxy;
- the data layer: rendering, the selection card and context-store publication;
- credits, docs and package wiring.

Out of scope:
- alert push notifications or sounds;
- alert history or replay;
- Google `publicAlerts:lookup`;
- per-event filters;
- voice-tool layer enums (as for the radar);
- drawing GDACS wind buffers, wind circles or burnt areas.

## Architecture

### Server: `server/providers/severe-weather.js`

A Vite plugin, `severeWeatherProxy()`, registered in `localProviderPlugins()`
(`server/providers/local.js`) before `cctvProxy(...)`, so `keySetupEndpoint()` stays last. Pure
helpers live in `server/providers/severe-weather/`:

- **`geometry.js`**:
  - `SIMPLIFY_TOLERANCE_DEG = 0.01`;
  - `cleanPositions`;
  - `simplifyRing` (Douglas–Peucker, closed ring or null);
  - `simplifyGeometry`, which turns `Polygon`, `MultiPolygon` or `GeometryCollection` into
    `[[outer, ...holes], ...]`;
  - `countPositions`.
- **`nws.js`**:
  - `NWS_ALERTS_URL`;
  - `zoneKeyFromUrl` (accepts only `https://api.weather.gov/zones/(forecast|county|fire)/[A-Z]{2}[CZ]\d{3}`);
  - `zoneUrl`, `isZoneKey`;
  - `normalizeNwsAlerts(json)`, which returns `{ updatedAt, alerts }`.

  Each alert is
  `{ id, event, headline, severity, urgency, certainty, onset, ends, expires, areaDesc, senderName, zones, polygons }`,
  with the times kept as the NWS ISO strings.
- **`gdacs.js`**:
  - `GDACS_EVENTS_URL`, `GDACS_CYCLONES_URL`, `GDACS_EVENT_TYPES` (TC, FL, DR, VO, WF);
  - `parseGdacsDate` (UTC);
  - `normalizeGdacsEvents(json)`;
  - `joinTrackSegments`;
  - `normalizeGdacsCycloneShapes(json)`, a `Map` from event id to `{ track, cone }`;
  - `attachCycloneShapes`.

`GET /api/severe-weather` returns 200:

```json
{
  "generatedAt": 1789402200000,
  "nws": {
    "status": "ok|stale|unavailable",
    "updatedAt": 1789401929000,
    "alerts": [{ "id": "urn:oid:…", "event": "Flood Watch", "headline": "…", "severity": "Severe",
                 "urgency": "Future", "certainty": "Possible", "onset": "2026-09-15T12:00:00-08:00",
                 "ends": "2026-09-19T16:00:00-08:00", "expires": "2026-09-14T16:00:00-08:00",
                 "areaDesc": "Two Rivers; Fairbanks Metro Area", "senderName": "NWS Fairbanks AK",
                 "zones": ["forecast/AKZ843", "forecast/AKZ844"], "polygons": null }],
    "zones": { "forecast/AKZ844": [[[[-147.9, 64.6], "…"]]] },
    "unmappedAlerts": 0
  },
  "gdacs": {
    "status": "ok|stale|unavailable",
    "updatedAt": 1789402200000,
    "events": [{ "id": "TC-1001321", "type": "TC", "typeName": "Tropical cyclone", "eventId": 1001321,
                 "name": "Tropical Cyclone FIFTEEN-E-26", "alertLevel": "Green", "country": null,
                 "fromDate": 1789333200000, "toDate": 1789398000000, "lon": -119.7, "lat": 16.3,
                 "reportUrl": "https://www.gdacs.org/report.aspx?eventid=1001321&episodeid=4&eventtype=TC",
                 "track": [[[-117.2, 17.2], "…"]], "cone": [[[[-120.1, 15.0], "…"]]] }]
  }
}
```

- Status 502 `{ error: 'Severe weather sources unavailable' }` when both sources are unavailable;
  429 `{ error: 'rate limited' }` with `Retry-After: 10`; 405 for anything but GET; 404 for any
  other path.
- Every response is `Cache-Control: no-store`.
- Concurrent builds per source are coalesced.
- `zones` holds only resolved zones referenced by kept alerts. `unmappedAlerts` counts alerts with
  neither a polygon nor a resolved zone.

### Client: `src/layers/severe-weather/`

- **`model.js`** (pure):
  - `parseSevereWeatherPayload`;
  - `nwsCategory`, `nwsAlertRank`;
  - `buildNwsAreas` (per-zone dedupe);
  - `countAreaPositions`, `capAreasToBudget`;
  - `formatAlertTime`, `formatAlertWindow`, `formatGdacsDates`;
  - `clampLine`, `forecastPageUrl`;
  - `buildNwsCard`, `buildGdacsCard`, `buildStats`;
  - the palettes and constants.
- **`rendering.js`**: `createSevereWeatherRendering(viewer, { requestRender, timers })` owns one
  `CustomDataSource('severe-weather')`.
  - NWS polygon: a fill entity with no height, so Cesium clamps it to the ground, with
    `classificationType: BOTH` (it drapes over terrain and Google 3D tiles), alpha 0.22. Plus a
    ground-clamped outline polyline, width 2.
  - GDACS: a ground-clamped point (11 px, black outline, `disableDepthTestDistance: ∞`); the
    track as a ground polyline, width 3; the cone as a fill at alpha 0.14 with a 1.5 px outline.
  - Entity ids start `severe-weather:`, which is how the pick owner recognises them.
  - `render()` rebuilds only when the drawn set changes (keys, colours, position counts).
  - `setSelected(key)` turns the chosen lines white and 2 px wider (points 15 px, white outline).
    It touches only the previous and the newly selected entities, not every drawn outline: with
    real Cesium, writing a graphics property — even to the same value — raises `definitionChanged`
    and marks that ground-polyline batch dirty. The full highlight walk happens only inside
    `render()`, once, for freshly built entities.
  - Render governor: every mutation calls `requestRender(reason)`. After a rebuild or a highlight
    change, a **ready pump** requests a frame every 250 ms, at most 40 times, while
    `viewer.dataSourceDisplay.getBoundingSphere` reports `PENDING` for the first or last entity.
    Reason: in idle `requestRenderMode`, primitives only build during rendered frames, and
    `DataSourceDisplay` requests a render only the first time it becomes ready (measured in
    `@cesium/engine/Source/DataSources/DataSourceDisplay.js`).
- **`selection.js`**: `createSevereWeatherSelection(...)` follows the FIRMS selected-card pattern,
  with its own overlay source `severe-weather` publishing one selected card.
  - A `LEFT_CLICK` handler reads the pick:
    - if the card is hit (`overlayHost.hitTest(x, y, { sourceId })`), it opens the link;
    - on one of this layer's entities, it selects it. The NWS anchor comes from the injected
      `pickGround(viewer, position)` (`src/weatherReport/groundPick.js`); the GDACS anchor is the
      event point;
    - on a pick another layer owns (`pickRegistry.isOwnedByOtherLayer`), it does nothing;
    - on empty space, it clears.
  - Card entry fields:
    - `variant: 'card'`, `selected: true`, priority `MAX_SAFE_INTEGER`;
    - `interactive` when a link exists, with `activate` opening it, so keyboard and assistive
      users reach it through the overlay's mirror;
    - `collisionGroup: 'ambient-card'`, `placement: 'above'`, `horizonCull`.
  - Context store: `registerEntityContext` with a carrier
    `{ show: true, __localBaseCartesian }` and
    `{ id: 'severe-weather:<kind>:<key>', layerId, layerName: 'Severe Weather', source: 'NWS'|'GDACS', label, latitude, longitude, properties }`,
    then `selectEntityContext` on a new selection only. On a refresh the card updates without
    re-announcing, and clears when its area or event is gone.
  - `registerPickOwner('severe-weather', isSevereWeatherPickId)` on install.
- **`index.js`**: `createSevereWeatherLayer({ fetchImpl, overlayHost, context, picking, pickGround, openLink, requestRender, registerCredit, credits, isVisible, now, timers, createRendering, screenSpaceEventHandlerFactory })`.
  - Fields: `id`, `name`, `icon`, `source: 'NWS · GDACS'`, `updateInterval: 300000`.
  - Methods: `init`, `enable` (credits, show, install the click handler), `disable`, `update`,
    `destroy`, `getStats`.
  - `disable` releases every entity, the card, the pick owner and the data. Lesson from the Dams
    layer (2026-09-13): a hidden data source still costs a visualizer walk every frame.
  - `update` resolves `false` only when the manager's own signal aborted. A failed proxy request
    resolves `true` and surfaces through `getStats().error`, which the manager reads as the
    refresh failure.
- **`src/data/severeWeather.js`**: injects the application services (world overlay with
  `hitTestWorldOverlay`, context store, pick registry, `pickGround`, `governorRequestRender`,
  `registerDynamicCredit` with both credits) and exports the default instance. It is registered in
  `src/app/data.js` directly after the earthquakes layer.

## Selection card copy

NWS, title `Flood Watch`; lines of at most 44 characters (`…` when clamped):
1. `Severe · Future · Possible` (severity · urgency · certainty)
2. `Sep 15 12:00 – Sep 19 16:00 UTC−8` (with different offsets:
   `Sep 14 10:33 UTC−5 – Sep 14 12:00 UTC−4`; only a start: `From …`; only an end: `Until …`)
3. area description
4. headline
5. `+1 more: Dense Fog Advisory` (only when other alerts share the area)
6. `Open weather.gov forecast`

GDACS, title `Drought in Madagascar`:
1. `Orange alert · Drought`
2. `Nov 21, 2025 – Sep 14, 2026 UTC` (same day: `Sep 14, 2026 UTC`)
3. country (omitted when empty)
4. `Open GDACS report` (only with a report link)

Phone width: 44-character lines keep the canvas card inside a 400 px viewport. The layer adds no
DOM panel and no keyboard handler, so the right-rail checklist and the Escape trap do not apply.

## Layer row status

`getStats()` builds these, rendered by `layerPanel._buildMetaText` (exact text, verified in the
model test):

| State | Stats | Row |
|---|---|---|
| Normal | `{ status: 'ok', source: 'NWS 214 · GDACS 83', count: 297, lastUpdate }` | `NWS 214 · GDACS 83 · 2m ago` |
| One source unavailable | adds `degraded: true`; source `NWS 214 · GDACS unavailable` | `NWS 214 · GDACS unavailable · 2m ago` (chip DEGRADED; no refresh error) |
| A source served stale | adds `stale: true`; source `NWS 214 (stale) · GDACS 83` | `STALE · NWS 214 (stale) · GDACS 83 · 2m ago` |
| Unmapped or hidden areas | source `NWS 214 (2 unmapped, 1 hidden) · GDACS 83` | `NWS 214 (2 unmapped, 1 hidden) · GDACS 83 · 2m ago` |
| Proxy request failed, data still drawn | adds `stale: true, error: 'Severe weather refresh failed'` | `STALE · NWS 214 · GDACS 83 · Severe weather refresh failed` |
| Proxy request failed, nothing drawn | `{ status: 'unavailable', source: 'NWS · GDACS', error: 'Severe weather sources unavailable' }` | `UNAVAILABLE · NWS · GDACS · Severe weather sources unavailable` |
| Before the first data | `{ status: 'ok', source: 'NWS · GDACS', count: 0, lastUpdate: null }` | `NWS · GDACS · never` |

## State and sharing

`LAYER_STATE_REGISTRY` gains
`{ id: 'severe-weather', token: 'v', disposition: 'enabled-only' }`, directly after `satellites`
(ids stay sorted). There is no option group. The registry's exact-count test rises by one.

## Credits

Dynamic credits in `src/data/dataCredits.js`, registered on first enable:
- `NWS_ALERTS_CREDIT` (`nws-alerts`):
  `US weather alerts: <a href="https://www.weather.gov/" target="_blank" rel="noopener">National Weather Service</a> (NOAA, public domain)`
- `GDACS_CREDIT` (`gdacs`):
  `Global disaster alerts: <a href="https://www.gdacs.org/" target="_blank" rel="noopener">GDACS</a>, European Commission JRC and UN OCHA (indicative, not official warnings)`

`DATA_SOURCES.md` gains an NWS row and a GDACS row, and `CHANGELOG.md` gains an entry.

## Testing

Colocated `*.test.mjs`, `node:test`, no live network. The recorded fixtures are in
`src/data/fixtures/severe-weather/` (see its README):
- `src/data/severeWeatherNws.test.mjs`: zone-key validation; ring simplification (tolerance,
  closure, collapse, rounding); real zone shapes; alert normalization including the `Test` drop.
- `src/data/severeWeatherGdacs.test.mjs`: the EQ exclusion, UTC dates, report-link validation,
  track joining across out-of-order segments, cone simplification.
- `src/data/severeWeatherProxy.test.mjs`:
  - the merged body and the `User-Agent`;
  - per-source cadence;
  - zone cache in memory, on disk, with the 7-day expiry and prune;
  - 429 back-off and the deadline;
  - stale for one hour, then unavailable, and 502;
  - cyclone-map failure;
  - 405, 404, 429 and plugin registration.
- `src/layers/severe-weather/model.test.mjs`: palette and ranks, the parser, per-zone dedupe on
  the fixtures, the budget, time windows, both cards, and every row string through the real
  `LayerPanel._buildMetaText`.
- `src/layers/severe-weather/rendering.test.mjs`: entity shapes (ground fill, outline, point,
  track, cone), the rebuild signature, highlight, the bounded ready pump, visibility, clear and
  destroy.
- `src/layers/severe-weather/selection.test.mjs`: the NWS card at the ground pick, the card click
  and `activate` opening the link, the GDACS card, sibling-owned picks, empty clicks, refresh and
  uninstall.
- `src/layers/severe-weather/index.test.mjs`: identity and credits; enable and draw; hidden-tab
  skip; failed refresh versus no data; manager abort; selection refresh on new data; disable and
  destroy.
- `src/data/layerState.test.mjs`: the count and token `v` round-trip.

Package wiring:
- `package.json` exports `./server/providers/severe-weather` (node) and `./layers/severe-weather`.
- `scripts/package-boundaries.json` gains `severe-weather-provider` (`runtime: node`) and
  `severe-weather-layer` (external `cesium`). `application-components` lists
  `src/data/severeWeather.js` and the four layer modules.
- `scripts/format-scope.json` lists the new files.
- The CI-parity sequence must pass: format check, boundaries, `npm test`, build.
