# Handoff: weather suite (2026-09-14)

Fork: `CaptPat/gods-eye-view`, branded Cyclops View in Pinokio. This work is fork-only: never open upstream PRs or issues, and remember that `gh pr create` defaults to the parent repo.

## State at handoff

- `main` is at `7a841cc`, pushed; `origin/main` matches.
- `main` holds all of `bilawalsidhu/gods-eye-view` main through PR #583 (`1ad565c`), from three syncs: `6462f0a` for #433–#456, `3eab0cc` for #501–#570 and `77a9966` for #571–#583. Every fork layer since then is merged on top.
- The weather suite was built before the second sync. That merge ported the fork's layers into upstream's new catalog (`src/app/layers/`) and moved the radar token to `z`.
- CI parity passes on `main`:
  - `npm run format:check`;
  - `npm run check:boundaries`, which now also runs `check-import-directions.mjs`;
  - `npm test`: 4,147 pass, 0 fail, 9 skips;
  - `npm run build`.
- **Not browser-tested since the syncs:**
  - the right-click weather report alongside upstream's draw tool and directions, which both claim pointer input;
  - the fork's layer rows alongside #583's camera controls and reorganized layer panel;
  - every layer added on 2026-09-15 (see the next two sections).
- No open branches or worktrees. No dev servers running.

## Energy, infrastructure, heritage and ice layers (2026-09-15)

Eleven fork layers were added after the celestial wave. The share-link registry now holds 43 of its 62 layers.

| Merge | Layers (share token) | Panel group | Source | Data |
|---|---|---|---|---|
| `d004694` | Nuclear Power Plants (`6`), Nuclear Waste Sites (`7`), Nuclear Accidents (`8`) | Energy | Wikidata (CC0) | bundled |
| `96c02d1` | Power Plants (`9`), Airports (`0`) | Energy, Infrastructure | WRI GPPD (CC BY 4.0); OurAirports (public domain) | bundled |
| `f7bf72e` | World Heritage Sites (`H`), Forts & Castles (`K`), National Parks & Monuments (`P`) | Heritage | Wikidata (CC0) | bundled |
| `41fdf9c` | Transmission Lines (`L`), Oil & Gas (`G`) | Energy | OpenStreetMap through `/api/overpass` (ODbL) | live, per view |
| `6e8b426` | Offshore Platforms (`O`) | Energy | BSEE Data Center (public domain) | bundled |
| `3746eba` | US Pipelines (`U`) | Energy | EIA U.S. Energy Atlas; BOEM/BSEE offshore segments (public domain) | bundled |
| `7a841cc` | Sea Ice (`I`) | Events | NASA GIBS GHRSST MUR sea ice concentration | live tiles |

- **Rebuild scripts:**
  - `scripts/build-wikidata-layers.mjs`;
  - `scripts/build-csv-layers.mjs`;
  - `scripts/build-bsee-platforms.mjs`;
  - `scripts/build-us-pipelines.mjs`.

  The last two share `scripts/zip-entry.mjs`. Every bundled folder under `src/data/local_data/` has a README with counts and filters.
- **Shared packages added:**
  - `src/layers/osm-infrastructure`: viewport-bounded Overpass layers with pluggable classifiers and cards.
  - `src/layers/catalog-lines`: a single `GroundPolylinePrimitive` batch that implements the catalog-points interface.
- **Not browser-tested:**
  - Transmission Lines and Oil & Gas:
    - the zoom thresholds (views up to 1.5° and 1° across);
    - ground-clamped line weight;
    - card anchoring on long lines.
  - US Pipelines:
    - the time to build the 20,999-instance ground batch;
    - selection highlighting, which applies only after the batch is ready.
  - The point catalogues: density at globe scale, especially Forts & Castles (30,154 points).
  - Sea Ice: the palette over dark and satellite base maps. The imagery is hidden on the photoreal stack by design.
- **Follow-ups:**
  - GEM oil and gas field and reserve data needs a manual form download (CC BY 4.0), so it was not built.
  - About 30% of OSM pipelines have no `substance` tag, so Oil & Gas shows them as "unknown".
  - If the full US Pipelines batch proves slow, it could draw only interstate and trunk lines when the camera is far out.

## Third sync: upstream #571–#583 (2026-09-15)

**Geocoder overlap resolved as pure upstream.** Keyless place search is upstream's #573/#582 chain: coordinates and bundled presets, then Google, then Photon, then Nominatim through `/api/geocode` (upstream's bounded, cached queue in `server/providers/regional/place.js`, shared with the regional briefing's reverse lookups). Removed from the fork:

- the `/api/geocode/search` route (`server/providers/geocode.js`);
- `src/geocodeOsm.js`, with its minimum-span framing and extent-based typing of administrative boundaries;
- the fork's exclusion of Photon, which from an Austin view placed Dubai in Kenya and the Eiffel Tower in Alberta;
- their tests and the `nominatim-search.json` fixture.

Known consequence: without a Google key, Photon misplacements and rooftop-height framing of single-node Nominatim hits can return. That was accepted as upstream behavior.

**Boundary fixes.** Upstream moved response readers into `src/sources/httpBody.js` (imported by `server/providers/common/http.js`), so all five fork `*-provider` groups own it now; `weather-report-provider` also owns `src/nominatimGeocode.js` through `regional/place.js`.

No new layer tokens upstream.

## Celestial layers (2026-09-15)

Seven fork layers, all in a new "Sky" group in the Layers panel, built in three merges:

| Merge | Layers (share token) | Source |
|---|---|---|
| `96552cb` | UFO Incidents (`j`), Fireballs (`l`) | Wikidata snapshot (CC0); NASA/JPL CNEOS via `/api/fireballs` |
| `d5d7e65` | Aurora Forecast (`1`), Day & Night (`2`), Meteor Showers (`3`) | NOAA SWPC OVATION via `/api/aurora`; computed sun and moon positions; bundled IMO shower list |
| night sky merge | Night Sky (`4`), Planets & Deep Sky (`5`) | d3-celestial (BSD-3) bundled; astronomy-engine (MIT) loaded on demand |

Specs are `docs/superpowers/specs/2026-09-15-sky-events-design.md` and `…-night-sky-design.md`.

- **Share-link budget.** Raised from 32 to 62 layers (`feat/layer-capacity`). Tokens may now be `[a-zA-Z0-9]` and are case-sensitive; the enabled list is capped at 128 characters. When diffing tokens on an upstream sync, remember that `a` and `A` are different layers.
- **Not browser-tested:**
  - the sky sphere's alignment with Cesium's star skybox, which depends on ICRF data loading;
  - label legibility over the atmosphere in daylight;
  - night bands and aurora bands on the photoreal stack;
  - Meteor Showers card placement.
- **UFO data.** NUFORC is deliberately unused, because its terms forbid redistribution.

## What the weather suite added

| # | Feature | Merge | Share token | Sources |
|---|---|---|---|---|
| 1 | Weather Radar layer | `c91acea` | `z` (was `p`, then `n`, before upstream syncs) | RainViewer worldwide, IEM NEXRAD US detail |
| 2 | Right-click weather report | `6c17f1d` | — | Google Weather API, Open-Meteo marine/solar |
| 3 | Tide Stations and Current Stations layers | `9ec8930` | `h`, `k` | NOAA CO-OPS |
| 4 | Weather Overlays layer (clouds, temperature, air quality, pollen) | `3c71064` | `o` | NOAA nowCOAST GMGSI, NOAA GFS via PacIOOS ERDDAP, Google Air Quality and Pollen heatmap tiles |
| 5 | Severe Weather layer | `02c84f7`, then `7124efd` | `v` | NWS active alerts plus zone shapes; GDACS events, cyclone tracks and cones |

Each feature has a design spec in `docs/superpowers/specs/2026-09-14-*-design.md` and a plan in `docs/superpowers/plans/2026-09-14-*.md`. `CHANGELOG.md` and `DATA_SOURCES.md` describe user-visible behaviour and data terms.

## Server routes added (Vite provider plugins, `server/providers/local.js`)

`keySetupEndpoint()` must stay last in `localProviderPlugins()`.

- **`/api/radar`:** radar manifest and tile proxy with a disk cache.
- **`/api/weather-report`:** in-memory 10-minute cache, stale report for up to 60 minutes.
- **`/api/tides`:** station lists cached 24 hours; reports cached 10 minutes.
  - Rate limits: 60 per minute per client, 150 per minute globally. NOAA's gateway blocks bursts of about 620 requests a minute.
- **`/api/weather-overlays`:**
  - Separate manifest and tile rate limiters.
  - NOAA tiles are cached in memory.
  - **Google tiles are never cached** (Pollen policy; `Cache-Control: no-store`). A daily Google tile budget applies instead, set by `GEV_GOOGLE_OVERLAY_TILES_PER_DAY` (default 25000).
- **`/api/severe-weather`:**
  - NWS fresh for 5 minutes, GDACS for 15; stale data served for up to 60 minutes.
  - Zone shapes are cached on disk in `.gev-cache/severe-weather/zones/` (git-ignored) for 7 days.
  - A source that already has data is served immediately and refreshed in the background.
  - Cold sources get a 25-second response budget. The server keeps waiting past it until at least one source can answer.

## Operational notes

- **GDACS was down at handoff.** gdacs.org accepted TCP connections but sent no HTTP response, even for its homepage. The Severe Weather row shows `NWS n · GDACS unavailable` until it recovers, and NWS alerts still display.
- **Google billing.** The weather report and the Air Quality and Pollen overlays use the Google Maps key, and every overlay tile is a billed request. Set per-API daily quotas in Google Cloud Console as well as the app budget.
- **Keys.** The app reads `GOOGLE_MAPS_API_KEY` from the Pinokio `ENVIRONMENT` file (`E:\pinokio\api\cyclops-view\pinokio\ENVIRONMENT`). Never print or commit keys.
- **Not browser-verified.** Nobody opened the new layers in a browser. Still unchecked:
  - the cloud clear-sky threshold (0.3);
  - card layout at 400 px;
  - the real-world look of alert polygons.

## Known issues and follow-ups

1. **Clicking a world-overlay card can end flight tracking** (pre-existing). `src/layers/flights/tracking.js` does not check overlay hit rects, so it affects FIRMS, tides, vessels and severe weather cards alike.
2. **Temperature tile render takes about 16 ms per tile.** `temperatureRgb` allocates per pixel. The fix is an in-place `temperatureRgbInto`.
3. **Google daily tile budget can overshoot** by a burst of concurrent requests. It is a soft limit.
4. **Severe Weather row age** (`Nm ago`) shows client fetch time, not data age; the row marks `(stale)`.
5. **Tides cards.** Some lines are 43–48 characters (the plan said 42). A click can open a second card from the other tides layer. Open cards don't re-render on a units change.
6. **Weather overlays and radar** share two small quirks:
   - `update()` returns `false` when disabled;
   - a swap can stall until the next refresh after a hidden tab returns.
7. **Earlier deferred items:**
   - the Nominatim User-Agent names the upstream contact;
   - the WEATHER panel collapse button styling differs from other panels;
   - the keyless weather report pin shows "Weather unavailable";
   - refreshing a report within 10 minutes returns the cached one.

The build ledgers (archived in the session scratchpad, not the repo) list every deferred minor finding. Git history and the specs are the durable record.

## Traps for the next weather or overlay layer

Lessons are kept in Claude memory (`weather-layer-plan-lessons`, `upstream-sync-hazards`). In short:

- **Render governor.** The app idles in `requestRenderMode`. Every async scene change must call `governorRequestRender`, injected from `src/data/*.js`.
- **Manager contract.** `update() === false` only on a manager abort. Failures surface through `getStats().error`, and row text is checked through `layerPanel._buildMetaText`.
- **Clickable layers** must `registerPickOwner` and `unregisterPickOwner`. Otherwise their clicks end aircraft, satellite and vessel tracking.
- **Imagery insert index** must be resolved at add time. The photoreal stack has no base imagery layer.
- **Multi-source proxies** must not make one source wait on another, must abort in-flight fetches at deadlines, and must never 502 while a source is still legitimately resolving.
- **Cesium entity property writes** rebuild static ground-polyline batches, so restyle only what changed.
- **After merges touching `src/app/*`**, check that the `application-components` boundary group lists every transitive import.
- **Upstream syncs.** Diff `LAYER_STATE_REGISTRY` tokens from both sides first; the radar token collided with ALPR.

## Environment gotchas

- Windows with Git Bash and Node 26. A backgrounded `npx vite` job PID is not the port listener; stop it with `netstat -ano | grep :<port>` then `taskkill //PID <pid> //F`.
- Worktrees here use a `node_modules` junction to the main repo. Unlink the junction (`cmd //c rmdir <worktree>\node_modules`) **before** `git worktree remove`. Windows may leave an empty locked folder behind, which is harmless.
