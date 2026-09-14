# Weather report (right-click) — design

Status: approved design (2026-09-14), not yet implemented
Fork: CaptPat/gods-eye-view (Cyclops View). Fork-only work; nothing is proposed upstream.

## Purpose

Right-click any spot on the globe and choose **Weather report here**. A pin marks the spot, and a
panel in the right rail shows:
- current conditions;
- the next 48 hours;
- 10 days;
- marine conditions;
- solar and surface readings for that location.

## Place in the weather suite

Weather-suite sub-project 2 of 5. Each has its own spec, plan and build:

1. Weather radar (`2026-09-14-weather-radar-design.md`);
2. **Weather report** (this document);
3. Tide stations and current stations;
4. Gridded overlays (cloud cover, temperature, Google Air Quality and Pollen heatmaps);
5. Severe weather: an on/off data layer like Dams and Fires.

## Sources (measured 2026-09-14)

| Source | Verified with this fork's key or directly | Used for |
|---|---|---|
| Google Weather API `GET https://weather.googleapis.com/v1/currentConditions:lookup` | HTTP 200. Fields: `weatherCondition`, `temperature`, `feelsLikeTemperature`, `dewPoint`, `heatIndex`, `windChill`, `precipitation`, `airPressure`, `wind`, `visibility`, `relativeHumidity`, `uvIndex`, `thunderstormProbability`, `cloudCover`, `isDaytime`, `timeZone` | Now |
| Google `forecast/hours:lookup` | HTTP 200. At most 24 entries per page, with `nextPageToken` | Next 48 h (two pages) |
| Google `forecast/days:lookup` | HTTP 200. 10 entries in one page. `daytimeForecast`, `nighttimeForecast`, `maxTemperature`, `minTemperature`, `sunEvents`, `moonEvents` | 10 days, sunrise and sunset |
| Open-Meteo Marine `https://marine-api.open-meteo.com/v1/marine` | HTTP 200. `wave_height`, `wave_period`, `wave_direction`, `swell_wave_height`, `sea_surface_temperature`, daily `wave_height_max` | Marine |
| Open-Meteo Forecast `https://api.open-meteo.com/v1/forecast` | HTTP 200. `current=shortwave_radiation,direct_radiation`; `hourly=soil_temperature_0cm` | Solar and surface |
| Google Weather API `publicAlerts:lookup` | HTTP 200 (Heat Advisory, Houston) | Not used here; see sub-project 5 |

Attribution: Google's Weather API policies require "Source: Includes weather data from Google"
on or next to the data, always visible and legible, in a visually distinct container. Open-Meteo
requires "Weather data by Open-Meteo.com" (CC BY 4.0). Google's policy page states no caching
limit for Weather API data. This design still keeps Google data in memory only.

## Scope

In scope:
- a right-click context menu with one item;
- the report pin and pinned card;
- the right-rail report panel;
- imperial and metric units;
- in-panel credits;
- the provider proxy.

Out of scope:
- multiple saved pins;
- severe-weather alerts (sub-project 5);
- voice ("what's the weather here");
- history charts;
- cockpit mode, where the menu is not offered.

## Architecture

### Server: `server/providers/weather-report.js`

A Vite plugin, `weatherReportProxy()`, registered in `localProviderPlugins()` in
`server/providers/local.js`. It follows the provider conventions: `makeRateLimiter`,
`coalesceProxyRequest`, JSON errors, and a `User-Agent` identifying the fork.

`GET /api/weather-report?lat=<deg>&lon=<deg>`

- **Validation:** `lat` must be a finite number in [−90, 90] and `lon` a finite number in
  [−180, 180]; otherwise 400.
- **Cache key and upstream coordinates:** latitude and longitude rounded to 0.05°.
- **Upstream calls, run concurrently:**
  - Google current conditions, hourly forecast page 1 (then page 2 via `pageToken`), and daily
    forecast (`days=10`). The key comes from `googleServerApiKey()` in
    `server/providers/places.js` (`GOOGLE_MAPS_SERVER_API_KEY`, falling back to
    `GOOGLE_MAPS_API_KEY`), and never reaches the browser.
  - Open-Meteo Marine: `current=wave_height,wave_period,wave_direction,swell_wave_height,sea_surface_temperature`,
    `daily=wave_height_max`, `forecast_days=7`, `timezone=GMT`.
  - Open-Meteo Forecast: `current=shortwave_radiation,direct_radiation`,
    `hourly=soil_temperature_0cm`, `forecast_hours=1`, `timezone=GMT`.
  - Place label: `fetchRegionalPlace({ latitude, longitude })` from
    `server/providers/regional/place.js`, which shares the one-request-per-second Nominatim queue.
- **Timeouts:** 10 s per upstream request, 15 s for the whole report. Anything still pending at
  15 s is marked `unavailable`.
- **Response** (all values SI: °C, m/s, mm, m, hPa):
  ```json
  {
    "point": { "lat": 29.3, "lon": -94.8 },
    "place": "Galveston, Texas",
    "timeZone": "America/Chicago",
    "generatedAt": 1789360000000,
    "stale": false,
    "sources": { "google": "ok", "openMeteoMarine": "ok", "openMeteoSolar": "ok", "place": "ok" },
    "now": { "condition": "Partly cloudy", "iconType": "PARTLY_CLOUDY", "isDaytime": true,
             "temperatureC": 22.4, "feelsLikeC": 23.1, "dewPointC": 18.0, "humidityPct": 76,
             "pressureHpa": 1015.3, "windSpeedMs": 5.4, "windGustMs": 8.9, "windFromDeg": 135,
             "cloudCoverPct": 40, "visibilityM": 16000, "uvIndex": 3, "thunderstormPct": 10 },
    "hourly": [ { "time": 1789362000000, "condition": "Cloudy", "iconType": "CLOUDY",
                  "temperatureC": 22.0, "precipChancePct": 20, "windSpeedMs": 5.0, "windFromDeg": 140 } ],
    "daily": [ { "date": "2026-09-14", "dayCondition": "Sunny", "nightCondition": "Clear",
                 "highC": 31.0, "lowC": 24.0, "precipChancePct": 10,
                 "sunrise": 1789386000000, "sunset": 1789431000000 } ],
    "marine": { "waveHeightM": 0.52, "wavePeriodS": 3.65, "waveFromDeg": 165, "swellHeightM": 0.32,
                "seaSurfaceTempC": 31.2, "dailyMaxWaveM": [ { "date": "2026-09-14", "heightM": 0.9 } ] },
    "solar": { "shortwaveWm2": 0, "directWm2": 0, "surfaceTempC": 29.5 }
  }
  ```
  - `place` is the `label` of `fetchRegionalPlace`'s result (locality and region, or the country
    when there is no locality), or `null` when the lookup fails or finds nothing.
  - `sources` values are `ok`, `unavailable`, or `not-configured` (Google with no key).
  - A section whose source is not `ok` is `null`.
  - `marine` is `null` when Open-Meteo returns no marine values for the point (inland).
  - `hourly` holds up to 48 entries, and `daily` up to 10.
- **Status codes:**
  - 200 when at least one of Google, marine or solar is `ok`;
  - 502 `{ error: 'Weather sources unavailable' }` when none is;
  - 429 with `Retry-After` when rate-limited.
- **Rate limits:** 20 requests per minute per client, 60 per minute overall. Concurrent requests
  for the same cache key are coalesced.
- **Cache:** in memory only, capped at 500 keys with the oldest evicted first.
  - Fresh for 10 minutes.
  - If a refresh fails, the previous report is served with `stale: true` for up to 60 minutes
    after it was generated.

### Client: `src/weatherReport/`

Not a data layer: no Layers-panel row, no `LAYER_STATE_REGISTRY` entry, no share-link state.

- **`contextMenu.js`:** `createContextMenu({ viewer, document, isSuppressed, onPick })`.
  - Uses its own `Cesium.ScreenSpaceEventHandler` on the scene canvas.
  - Binds `bindTrackingClickGesture(handler, onRightClick, { eventTypes: { LEFT_DOWN: RIGHT_DOWN,
    MOUSE_MOVE: MOUSE_MOVE, LEFT_UP: RIGHT_UP, LEFT_CLICK: RIGHT_CLICK } })` from
    `src/data/trackingClickGesture.js`. A menu opens only when `isTrackingSelectionGesture`
    holds (travel ≤ 6 px), so right-drag zoom is unaffected.
  - Calls `preventDefault()` on the canvas `contextmenu` event (canvas only).
  - Opens a `role="menu"` element at the pointer with one `role="menuitem"` button,
    **Weather report here**, and a coordinates line such as `30.267, -97.743`.
  - Focus moves to the item. Enter or Space picks it. Escape, a pointerdown outside, a wheel
    event, or `viewer.camera.moveStart` closes it.
  - `isSuppressed()` is true in cockpit mode (`document.body.classList.contains('cockpit-mode')`).
  - `destroy()` removes the handler and all listeners.
- **`groundPick.js`:** `pickGround(viewer, windowPosition)` returns `{ lat, lon }` or `null`. It
  tries `scene.pickPosition`, then `camera.pickEllipsoid`, then
  `scene.globe.pick(camera.getPickRay(...))`, the cascade `getViewTargetCartesian` uses. A
  `null` result (sky) opens no menu.
- **`reportModel.js`:** pure, no DOM or Cesium.
  - `buildReportView(report, { units, now })` returns the panel's view model: header, now grid,
    hourly strip, daily rows, marine (or `null`), solar, credits, and per-section status text.
  - Unit conversions:
    - imperial: °F, mph, in, mi, inHg, ft;
    - metric: °C, km/h, mm, km, hPa, m.
  - Times are formatted in `report.timeZone` via `Intl.DateTimeFormat`, and the header shows the
    UTC offset, e.g. `Updated 01:20 local (UTC−5)`.
- **`reportPin.js`:** `createReportPin({ viewer, overlayHost })` returns `{ show(point, summary),
  update(summary), clear() }`.
  - The marker is a Cesium point entity (8 px, white outline) in its own `CustomDataSource`.
  - The card is a world-overlay entry with `variant: 'card'`, `pinned: true`,
    `interactive: true`, and an `activate` that reopens the panel. It is published with
    `overlayHost.setEntries('weather-report', [entry])` after `overlayHost.setVisible('weather-report', true)`,
    and removed with `overlayHost.clearSource('weather-report')` — the same host calls the
    earthquakes layer uses.
  - Title while loading: `Loading weather`. After loading, `72°F · Partly cloudy`, with details
    `Wind 12 mph SE, gusts 20` and `Includes weather data from Google`.
- **`reportPanel.js`:** `createReportPanel({ document, rail, onClose, onRefresh, onUnitsChange })`.
  - Inserts `#weather-report-panel` into `#right-context-rail` with the existing panel markup:
    `panel-collapsible`, `data-panel-id`, `panel-glow`, `panel-header`, `panel-title` `WEATHER`.
  - Header controls: °F/°C switch, refresh (disabled while loading) and close.
  - Sections, each under an `h3`:
    - **Now:** large temperature, condition and feels-like, plus a grid of humidity, dew point,
      pressure, wind direction/speed/gust, cloud cover, visibility, UV index and thunderstorm
      chance.
    - **Next 48 hours:** a horizontally scrolling strip; each hour shows time, condition,
      temperature, precipitation chance and wind.
    - **10 days:** one row per day with day/night condition, high/low and precipitation chance.
    - **Marine:** omitted when `marine` is `null`.
    - **Sun and surface.**
  - Status lines use `aria-live="polite"`: `Loading weather`,
    `Showing weather from 45 min ago` when stale, and per section
    `Google forecast unavailable` / `Open-Meteo unavailable` /
    `Google weather not configured`.
  - The footer always shows `Source: Includes weather data from Google` and
    `Marine, solar and surface: Weather data by Open-Meteo.com (CC BY 4.0)`.
  - `src/ui/styles/layers.css` adds `#right-context-rail > #weather-report-panel` to the
    right-rail child selector list.
- **`index.js`:** `createWeatherReport({ viewer, overlayHost, document, fetchImpl, storage })`.
  - Right-click pick → `pin.show` → one `fetch('/api/weather-report?...')` with an
    `AbortController`; a new pick aborts the previous request.
  - On success it updates the pin and the panel; on failure it shows the panel status.
  - Closing the panel calls `pin.clear()`.
  - The units preference is read from and written to `storage` under `gev.weatherReport.units`
    (`'imperial'` by default). Storage failures fall back to the default without throwing.
  - `destroy()` tears down the menu, the pin and the panel.
  - Wired from the standalone application composition in `src/standalone/`, where `viewer` and
    the world `overlayHost` are available.

## Credits

- `src/data/dataCredits.js` `DATA_CREDITS` gains
  `{ key: 'google-weather', html: 'Weather report: Source: Includes weather data from Google' }`.
- The existing `open-meteo` entry is reworded to cover cockpit conditions and the weather report's
  marine, solar and surface sections.
- `DATA_SOURCES.md` gains rows for the Google Weather API and the Open-Meteo Marine and solar
  fields.

## Testing

Colocated `*.test.mjs`, `node:test`, no live network. Fake DOM objects are installed on
`globalThis.document` and restored afterwards, as `src/ui/cctvControls.test.mjs` does; no DOM
library is added.

- **`src/data/weatherReportProxy.test.mjs`:** mounts the plugin with recorded fixtures under
  `src/data/fixtures/weather-report/`: Google current, hourly page 1 and page 2, and daily; Open-Meteo
  marine coastal and inland (null values); Open-Meteo solar. Covers:
  - normalization and hourly pagination;
  - one source failing, and all failing (502);
  - validation (400) and rate limiting (429);
  - cache hit;
  - stale serving within 60 minutes;
  - a missing Google key (`not-configured`).
- **`src/weatherReport/reportModel.test.mjs`:** every unit conversion; marine present and absent;
  local-time formatting with a fixed `timeZone`; per-section status text.
- **`src/weatherReport/contextMenu.test.mjs`:**
  - travel > 6 px opens nothing, and a sky pick opens nothing;
  - keyboard activation;
  - closing via Escape, outside pointerdown, wheel and camera move;
  - cockpit suppression;
  - `destroy()` removes listeners.
- **`src/weatherReport/reportPin.test.mjs`:** entry shape (`variant: 'card'`, pinned, interactive,
  `activate`), `update`, and `clear()` removing both the marker and the overlay source.
- **`src/weatherReport/reportPanel.test.mjs`:** every section renders; marine omitted when `null`;
  the unit switch calls back; both credits are always present; stale and error lines appear.
- **`src/weatherReport/index.test.mjs`:** pick → pin plus panel; a second pick aborts the first
  request; close clears the pin; the units preference persists and survives storage errors;
  `destroy()` cleans up.

`scripts/package-boundaries.json` gains a `weather-report` group (`src/weatherReport/*`, external
`cesium`) and a `weather-report-provider` group. `scripts/format-scope.json` includes the new
files. The fork's CI-parity sequence must pass: format check, boundaries, `npm test`, build.
`CHANGELOG.md` gains an entry.
