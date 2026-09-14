# Weather Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Right-click the globe, choose "Weather report here", and get a pin plus a right-rail panel with current conditions, 48 hours, 10 days, marine, and sun/surface readings.

**Architecture:**
- **Proxy:** a Vite provider plugin (`server/providers/weather-report.js`, pure helpers in `server/providers/weather-report/normalize.js`) fans out to Google Weather API, Open-Meteo Marine, Open-Meteo Forecast and the Nominatim place lookup. It returns one normalized SI report, cached in memory.
- **Client:** a non-layer browser module (`src/weatherReport/`). It provides a right-click context menu, a ground pick, a pure view model, a Cesium pin plus world-overlay card, and a DOM panel in `#right-context-rail`. It is wired in `src/standalone/tools.js`.

**Tech Stack:** Node ≥ 24 Vite provider plugins, CesiumJS 1.138 (`ScreenSpaceEventHandler`, `CustomDataSource`), `Intl.DateTimeFormat`, `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-14-weather-report-design.md`

## Global Constraints

- Fork-only work on `CaptPat/gods-eye-view`. Never open upstream PRs or issues; `gh pr create` defaults to the parent repository.
- Route `GET /api/weather-report?lat=<deg>&lon=<deg>`. `lat` must be finite in [−90, 90] and `lon` finite in [−180, 180], else 400 `{ error }`. Cache key and upstream coordinates are both rounded to 0.05° (`Math.round(v / 0.05) * 0.05`, then `Number(x.toFixed(2))`).
- Google Weather API base `https://weather.googleapis.com/v1/`. Every call uses `location.latitude`, `location.longitude`, `unitsSystem=METRIC`, `languageCode=en` and `key`:
  - `currentConditions:lookup`;
  - `forecast/hours:lookup` with `hours=48&pageSize=24` (page 2 via `pageToken`);
  - `forecast/days:lookup` with `days=10&pageSize=10`.
- The key comes only from `googleServerApiKey()` (`server/providers/places/google-key.js`). It never reaches a response body, a log line, a cache key or an error message; log source names only, never upstream URLs. With no key, Google is `not-configured` and no Google request is made.
- Open-Meteo Marine: `https://marine-api.open-meteo.com/v1/marine?latitude=<lat>&longitude=<lon>&current=wave_height,wave_period,wave_direction,swell_wave_height,sea_surface_temperature&daily=wave_height_max&forecast_days=7&timezone=GMT`.
- Open-Meteo Forecast (solar): `https://api.open-meteo.com/v1/forecast?latitude=<lat>&longitude=<lon>&current=shortwave_radiation,direct_radiation&hourly=soil_temperature_0cm&forecast_hours=1&timezone=GMT`.
- Upstream `User-Agent`: `CyclopsView/0.1 (+https://github.com/CaptPat/gods-eye-view)`. Timeouts: 10 s per upstream request, 15 s for the whole report (anything pending is `unavailable`). Response bodies capped at 2 MB.
- Response values are SI (°C, m/s, m, hPa). Google km/h ÷ 3.6 → m/s, rounded to 2 decimals. Google visibility km × 1000 → m. `airPressure.meanSeaLevelMillibars` is hPa.
- `sources` values are `ok`, `unavailable`, `not-configured`; a section whose source is not `ok` is `null`.
- `marine` is `null` when every `current` marine value is `null` (inland), while `sources.openMeteoMarine` stays `ok`.
- `daily[].precipChancePct` is the larger of the daytime and nighttime probabilities.
- `timeZone` is Google's `timeZone.id`, or `null` when Google is not `ok`.
- Status: 200 when at least one of Google, marine or solar is `ok`; otherwise 502 `{ error: 'Weather sources unavailable' }`; 429 `{ error: 'rate limited' }` with `Retry-After: 10`; 405 for non-GET.
- Rate limits: 20 requests/min per client, 60/min global. Concurrent requests for one cache key are coalesced.
- Cache: in memory only, at most 500 keys, oldest evicted first. Fresh for 10 minutes. If a refresh yields no `ok` source, the previous report is served with `stale: true` while it is ≤ 60 minutes old.
- Client storage key `gev.weatherReport.units`, values `imperial` (default) or `metric`. Storage failures fall back to the default without throwing.
- Exact copy:
  - Menu item: `Weather report here`. Coordinates line: `lat.toFixed(3), lon.toFixed(3)` joined by `, `.
  - Pin titles: `Loading weather`, or `72°F · Partly cloudy`, with details `Wind 12 mph SE, gusts 20` and `Includes weather data from Google`.
  - Panel title `WEATHER`; section headings `Now`, `Next 48 hours`, `10 days`, `Marine`, `Sun and surface`.
  - Status lines: `Loading weather`; `Showing weather from 45 min ago`; `Google forecast unavailable`; `Open-Meteo unavailable`; `Google weather not configured`.
  - Footer: `Source: Includes weather data from Google` and `Marine, solar and surface: Weather data by Open-Meteo.com (CC BY 4.0)`.
- The menu is not offered in cockpit mode (`document.body.classList.contains('cockpit-mode')`). A right-drag (travel > 6 px, `isTrackingSelectionGesture`) opens nothing.
- **Render governor** (lesson from the radar build): Cyclops View idles in Cesium `requestRenderMode`. The pin's Cesium entity add/remove must call an injected `requestRender('weather-report')`; `src/standalone/tools.js` passes `governorRequestRender`. World-overlay calls already request a render.
- **Panel status text:** status and section text is set with `textContent`, never `innerHTML`, because the place name comes from Nominatim.
- Tests: colocated `*.test.mjs`, `node:test` + `node:assert/strict`, no live network. Fake DOM from `src/testSupport/fakeDom.mjs` (Task 4). Real `cesium` constructors with hand-built fake viewers.
- Recorded fixtures (already committed with this plan, trimmed to used fields) live in `src/data/fixtures/weather-report/`:
  - `google-current.json`: Galveston 29.3, −94.8. Sunny, 29.8 °C, feels 36.8, dew 26.1, 80 %, 1017.56 hPa, wind 13 km/h from 166°, gust 14, visibility 16 km, UV 0, thunder 0, cloud 9, day, `America/Chicago`.
  - `google-hourly-page1.json`: 24 hours, 2026-09-14T12:00Z to 2026-09-15T11:00Z, `nextPageToken: "fixture-page-2"`.
  - `google-hourly-page2.json`: 24 hours, 2026-09-15T12:00Z to 2026-09-16T11:00Z, `nextPageToken: ""`.
  - `google-daily.json`: 10 days, 2026-09-14 to 2026-09-23. Day 0: Sunny / Clear, 31.4 / 29.4, precip 45 / 15, sunrise `2026-09-14T12:03:33.388209522Z`.
  - `open-meteo-marine-coastal.json`: wave 0.46 m, 4.0 s, from 165°, swell 0.42, SST 31.0, 7 daily maxima starting 0.52.
  - `open-meteo-marine-inland.json`: all nulls.
  - `open-meteo-solar.json`: shortwave 0.0, direct 0.0, soil 28.8.
- CI parity before the final commit: `npm run format:check`, `npm run check:boundaries`, `npm test`, `npm run build`.
- Commit trailer: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
|---|---|
| `server/providers/weather-report/normalize.js` | Pure: query parsing, grid rounding, upstream URLs, Google/Open-Meteo normalization |
| `server/providers/weather-report.js` | Handler: fan-out, timeouts, statuses, cache, stale, limiter, plugin |
| `server/providers/local.js` | Register and re-export the plugin |
| `src/weatherReport/reportModel.js` | Pure view model: units, cardinal, local time, statuses, pin summary |
| `src/testSupport/fakeDom.mjs` | Minimal fake DOM for weather-report tests |
| `src/weatherReport/groundPick.js` | Window position → `{ lat, lon }` via the pick cascade |
| `src/weatherReport/contextMenu.js` | Right-click gesture, menu element, keyboard and close rules |
| `src/weatherReport/reportPin.js` | Cesium point marker plus world-overlay card |
| `src/weatherReport/reportPanel.js` | Right-rail DOM panel |
| `src/weatherReport/index.js` | Orchestration: pick → pin → fetch → panel; units; abort; destroy |
| `src/ui/styles/weather-report.css` | Menu and panel styles |
| `src/ui/styles/layers.css`, `style.css` | Rail child selector; stylesheet import |
| `src/standalone/tools.js` | Wire `createWeatherReport` |
| `src/data/dataCredits.js`, `DATA_SOURCES.md`, `CHANGELOG.md`, `package.json`, `scripts/package-boundaries.json`, `scripts/format-scope.json` | Credits, docs, exports, boundaries, formatting |

---

### Task 1: Proxy normalization helpers

**Files:**
- Create: `server/providers/weather-report/normalize.js`
- Test: `src/data/weatherReportNormalize.test.mjs`

**Interfaces:**
- Consumes: fixtures in `src/data/fixtures/weather-report/` (committed with this plan).
- Produces:
  - Constants and helpers:
    - `GRID_DEG = 0.05`
    - `roundToGrid(value) → number`
    - `parseReportQuery(searchParams) → { lat, lon } | { error }`, with both values rounded
    - `reportCacheKey({ lat, lon }) → 'lat.xx,lon.xx'`
  - URL builders:
    - `googleCurrentUrl(point, key)`
    - `googleHourlyUrl(point, key, pageToken = '')`
    - `googleDailyUrl(point, key)`
    - `marineUrl(point)`
    - `solarUrl(point)`
  - Normalizers:
    - `googleTimeZone(json) → string | null`
    - `normalizeGoogleNow(json) → now | null`
    - `normalizeGoogleHourly(pages) → hourly[]` (≤ 48)
    - `normalizeGoogleDaily(json) → daily[]` (≤ 10)
  - Open-Meteo:
    - `isOpenMeteoPayload(json) → boolean`
    - `normalizeMarine(json) → marine | null`
    - `normalizeSolar(json) → solar`
  - Object shapes are exactly the spec's response sections.

- [ ] **Step 1: Write the failing test**

```js
// src/data/weatherReportNormalize.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  googleCurrentUrl, googleDailyUrl, googleHourlyUrl, googleTimeZone, isOpenMeteoPayload,
  marineUrl, normalizeGoogleDaily, normalizeGoogleHourly, normalizeGoogleNow, normalizeMarine,
  normalizeSolar, parseReportQuery, reportCacheKey, roundToGrid, solarUrl,
} from '../../server/providers/weather-report/normalize.js';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/weather-report/${name}`, import.meta.url), 'utf8'));
const POINT = { lat: 29.3, lon: -94.8 };

test('queries are validated and snapped to the 0.05° grid', () => {
  const q = (lat, lon) => parseReportQuery(new URLSearchParams({ lat, lon }));
  assert.deepEqual(q('29.27', '-94.82'), { lat: 29.25, lon: -94.8 });
  assert.deepEqual(q('90', '180'), { lat: 90, lon: 180 });
  assert.match(parseReportQuery(new URLSearchParams({ lon: '1' })).error, /lat/);
  assert.match(q('91', '0').error, /lat/);
  assert.match(q('abc', '0').error, /lat/);
  assert.match(q('10', '-181').error, /lon/);
  assert.match(q('10', '').error, /lon/);
  assert.equal(roundToGrid(29.28), 29.3);
  assert.equal(roundToGrid(0.01), 0);
  assert.equal(reportCacheKey(POINT), '29.30,-94.80');
});

test('upstream URLs carry the documented parameters', () => {
  const current = new URL(googleCurrentUrl(POINT, 'K'));
  assert.equal(current.origin + current.pathname, 'https://weather.googleapis.com/v1/currentConditions:lookup');
  assert.equal(current.searchParams.get('location.latitude'), '29.30');
  assert.equal(current.searchParams.get('location.longitude'), '-94.80');
  assert.equal(current.searchParams.get('unitsSystem'), 'METRIC');
  assert.equal(current.searchParams.get('languageCode'), 'en');
  assert.equal(current.searchParams.get('key'), 'K');

  const hours = new URL(googleHourlyUrl(POINT, 'K'));
  assert.equal(hours.pathname, '/v1/forecast/hours:lookup');
  assert.equal(hours.searchParams.get('hours'), '48');
  assert.equal(hours.searchParams.get('pageSize'), '24');
  assert.equal(hours.searchParams.has('pageToken'), false);
  assert.equal(new URL(googleHourlyUrl(POINT, 'K', 'fixture-page-2')).searchParams.get('pageToken'), 'fixture-page-2');

  const days = new URL(googleDailyUrl(POINT, 'K'));
  assert.equal(days.pathname, '/v1/forecast/days:lookup');
  assert.equal(days.searchParams.get('days'), '10');
  assert.equal(days.searchParams.get('pageSize'), '10');

  const marine = new URL(marineUrl(POINT));
  assert.equal(marine.origin + marine.pathname, 'https://marine-api.open-meteo.com/v1/marine');
  assert.deepEqual(Object.fromEntries(marine.searchParams), {
    latitude: '29.30', longitude: '-94.80',
    current: 'wave_height,wave_period,wave_direction,swell_wave_height,sea_surface_temperature',
    daily: 'wave_height_max', forecast_days: '7', timezone: 'GMT',
  });
  const solar = new URL(solarUrl(POINT));
  assert.equal(solar.origin + solar.pathname, 'https://api.open-meteo.com/v1/forecast');
  assert.deepEqual(Object.fromEntries(solar.searchParams), {
    latitude: '29.30', longitude: '-94.80', current: 'shortwave_radiation,direct_radiation',
    hourly: 'soil_temperature_0cm', forecast_hours: '1', timezone: 'GMT',
  });
});

test('Google current conditions normalize to SI', () => {
  const json = fixture('google-current.json');
  assert.equal(googleTimeZone(json), 'America/Chicago');
  assert.deepEqual(normalizeGoogleNow(json), {
    condition: 'Sunny', iconType: 'CLEAR', isDaytime: true,
    temperatureC: 29.8, feelsLikeC: 36.8, dewPointC: 26.1, humidityPct: 80, pressureHpa: 1017.56,
    windSpeedMs: 3.61, windGustMs: 3.89, windFromDeg: 166, cloudCoverPct: 9,
    visibilityM: 16000, uvIndex: 0, thunderstormPct: 0,
  });
  assert.equal(normalizeGoogleNow(null), null);
  assert.equal(googleTimeZone({}), null);
  const imperial = normalizeGoogleNow({
    temperature: { unit: 'FAHRENHEIT', degrees: 68 },
    wind: { speed: { unit: 'MILES_PER_HOUR', value: 10 } },
    visibility: { unit: 'MILES', distance: 1 },
  });
  assert.equal(imperial.temperatureC, 20);
  assert.equal(imperial.windSpeedMs, 4.47);
  assert.equal(imperial.visibilityM, 1609);
});

test('hourly pages are joined and capped at 48 entries', () => {
  const pages = [fixture('google-hourly-page1.json'), fixture('google-hourly-page2.json')];
  const hourly = normalizeGoogleHourly(pages);
  assert.equal(hourly.length, 48);
  assert.deepEqual(hourly[0], {
    time: Date.parse('2026-09-14T12:00:00Z'), condition: 'Clear', iconType: 'CLEAR',
    temperatureC: 29.8, precipChancePct: 0, windSpeedMs: 3.61, windFromDeg: 166,
  });
  assert.deepEqual(hourly[47], {
    time: Date.parse('2026-09-16T11:00:00Z'), condition: 'Partly cloudy', iconType: 'PARTLY_CLOUDY',
    temperatureC: 29, precipChancePct: 0, windSpeedMs: 1.67, windFromDeg: 108,
  });
  assert.equal(normalizeGoogleHourly([...pages, pages[0]]).length, 48);
});

test('daily forecast normalizes dates, the larger precip chance and sun events', () => {
  const daily = normalizeGoogleDaily(fixture('google-daily.json'));
  assert.equal(daily.length, 10);
  assert.deepEqual(daily[0], {
    date: '2026-09-14', dayCondition: 'Sunny', nightCondition: 'Clear', highC: 31.4, lowC: 29.4,
    precipChancePct: 45, sunrise: Date.parse('2026-09-14T12:03:33.388Z'),
    sunset: Date.parse('2026-09-15T00:25:23.308Z'),
  });
  assert.equal(daily[9].date, '2026-09-23');
  assert.equal(daily[9].precipChancePct, 65);
});

test('marine is null inland; solar reads current radiation and surface temperature', () => {
  const coastal = normalizeMarine(fixture('open-meteo-marine-coastal.json'));
  assert.deepEqual({ ...coastal, dailyMaxWaveM: coastal.dailyMaxWaveM.slice(0, 1) }, {
    waveHeightM: 0.46, wavePeriodS: 4, waveFromDeg: 165, swellHeightM: 0.42, seaSurfaceTempC: 31,
    dailyMaxWaveM: [{ date: '2026-09-14', heightM: 0.52 }],
  });
  assert.equal(coastal.dailyMaxWaveM.length, 7);
  const inland = fixture('open-meteo-marine-inland.json');
  assert.equal(isOpenMeteoPayload(inland), true);
  assert.equal(normalizeMarine(inland), null);
  assert.equal(isOpenMeteoPayload({ error: true, reason: 'x' }), false);
  assert.deepEqual(normalizeSolar(fixture('open-meteo-solar.json')), {
    shortwaveWm2: 0, directWm2: 0, surfaceTempC: 28.8,
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/data/weatherReportNormalize.test.mjs`
Expected: FAIL with `Cannot find module` for `normalize.js`.

- [ ] **Step 3: Write the implementation**

```js
// server/providers/weather-report/normalize.js
export const GRID_DEG = 0.05;
const GOOGLE_WEATHER_BASE = 'https://weather.googleapis.com/v1/';
const OPEN_METEO_MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine';
const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const MAX_HOURS = 48;
const MAX_DAYS = 10;

const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const text = (value) => (typeof value === 'string' && value ? value : null);
const rounded = (value, digits) => (value === null ? null : Number(value.toFixed(digits)));
const isoToMs = (value) => {
  const ms = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isFinite(ms) ? ms : null;
};

export function roundToGrid(value) {
  return Number((Math.round(value / GRID_DEG) * GRID_DEG).toFixed(2));
}

function coordinate(searchParams, name, limit) {
  const raw = String(searchParams.get(name) ?? '').trim();
  const value = raw === '' ? Number.NaN : Number(raw);
  return Number.isFinite(value) && Math.abs(value) <= limit ? value : null;
}

export function parseReportQuery(searchParams) {
  const lat = coordinate(searchParams, 'lat', 90);
  if (lat === null) return { error: 'lat must be a number from -90 to 90' };
  const lon = coordinate(searchParams, 'lon', 180);
  if (lon === null) return { error: 'lon must be a number from -180 to 180' };
  return { lat: roundToGrid(lat), lon: roundToGrid(lon) };
}

export function reportCacheKey({ lat, lon }) {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}

function googleUrl(method, point, key, extra = {}) {
  const params = new URLSearchParams({
    'location.latitude': point.lat.toFixed(2),
    'location.longitude': point.lon.toFixed(2),
    unitsSystem: 'METRIC',
    languageCode: 'en',
    ...extra,
    key,
  });
  return `${GOOGLE_WEATHER_BASE}${method}?${params}`;
}

export const googleCurrentUrl = (point, key) => googleUrl('currentConditions:lookup', point, key);
export const googleHourlyUrl = (point, key, pageToken = '') =>
  googleUrl('forecast/hours:lookup', point, key, {
    hours: String(MAX_HOURS),
    pageSize: '24',
    ...(pageToken ? { pageToken } : {}),
  });
export const googleDailyUrl = (point, key) =>
  googleUrl('forecast/days:lookup', point, key, { days: String(MAX_DAYS), pageSize: String(MAX_DAYS) });

export function marineUrl(point) {
  const params = new URLSearchParams({
    latitude: point.lat.toFixed(2),
    longitude: point.lon.toFixed(2),
    current: 'wave_height,wave_period,wave_direction,swell_wave_height,sea_surface_temperature',
    daily: 'wave_height_max',
    forecast_days: '7',
    timezone: 'GMT',
  });
  return `${OPEN_METEO_MARINE_URL}?${params}`;
}

export function solarUrl(point) {
  const params = new URLSearchParams({
    latitude: point.lat.toFixed(2),
    longitude: point.lon.toFixed(2),
    current: 'shortwave_radiation,direct_radiation',
    hourly: 'soil_temperature_0cm',
    forecast_hours: '1',
    timezone: 'GMT',
  });
  return `${OPEN_METEO_FORECAST_URL}?${params}`;
}

function degreesC(temperature) {
  const degrees = finite(temperature?.degrees);
  if (degrees === null) return null;
  return temperature.unit === 'FAHRENHEIT' ? rounded(((degrees - 32) * 5) / 9, 1) : degrees;
}

function speedMs(speed) {
  const value = finite(speed?.value);
  if (value === null) return null;
  return rounded(speed.unit === 'MILES_PER_HOUR' ? value * 0.44704 : value / 3.6, 2);
}

function distanceM(visibility) {
  const distance = finite(visibility?.distance);
  if (distance === null) return null;
  return Math.round(distance * (visibility.unit === 'MILES' ? 1609.344 : 1000));
}

export function googleTimeZone(json) {
  return text(json?.timeZone?.id);
}

export function normalizeGoogleNow(json) {
  if (!json || typeof json !== 'object') return null;
  return {
    condition: text(json.weatherCondition?.description?.text),
    iconType: text(json.weatherCondition?.type),
    isDaytime: json.isDaytime === true,
    temperatureC: degreesC(json.temperature),
    feelsLikeC: degreesC(json.feelsLikeTemperature),
    dewPointC: degreesC(json.dewPoint),
    humidityPct: finite(json.relativeHumidity),
    pressureHpa: finite(json.airPressure?.meanSeaLevelMillibars),
    windSpeedMs: speedMs(json.wind?.speed),
    windGustMs: speedMs(json.wind?.gust),
    windFromDeg: finite(json.wind?.direction?.degrees),
    cloudCoverPct: finite(json.cloudCover),
    visibilityM: distanceM(json.visibility),
    uvIndex: finite(json.uvIndex),
    thunderstormPct: finite(json.thunderstormProbability),
  };
}

export function normalizeGoogleHourly(pages) {
  return (Array.isArray(pages) ? pages : [])
    .flatMap((page) => (Array.isArray(page?.forecastHours) ? page.forecastHours : []))
    .map((hour) => ({
      time: isoToMs(hour?.interval?.startTime),
      condition: text(hour?.weatherCondition?.description?.text),
      iconType: text(hour?.weatherCondition?.type),
      temperatureC: degreesC(hour?.temperature),
      precipChancePct: finite(hour?.precipitation?.probability?.percent),
      windSpeedMs: speedMs(hour?.wind?.speed),
      windFromDeg: finite(hour?.wind?.direction?.degrees),
    }))
    .filter((hour) => hour.time !== null)
    .slice(0, MAX_HOURS);
}

function isoDate(displayDate) {
  const { year, month, day } = displayDate || {};
  if (![year, month, day].every((part) => Number.isInteger(part))) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function normalizeGoogleDaily(json) {
  const days = Array.isArray(json?.forecastDays) ? json.forecastDays : [];
  return days
    .map((day) => {
      const chances = [
        finite(day?.daytimeForecast?.precipitation?.probability?.percent),
        finite(day?.nighttimeForecast?.precipitation?.probability?.percent),
      ].filter((value) => value !== null);
      return {
        date: isoDate(day?.displayDate),
        dayCondition: text(day?.daytimeForecast?.weatherCondition?.description?.text),
        nightCondition: text(day?.nighttimeForecast?.weatherCondition?.description?.text),
        highC: degreesC(day?.maxTemperature),
        lowC: degreesC(day?.minTemperature),
        precipChancePct: chances.length ? Math.max(...chances) : null,
        sunrise: isoToMs(day?.sunEvents?.sunriseTime),
        sunset: isoToMs(day?.sunEvents?.sunsetTime),
      };
    })
    .filter((day) => day.date !== null)
    .slice(0, MAX_DAYS);
}

export function isOpenMeteoPayload(json) {
  return Boolean(json && typeof json === 'object' && json.current && typeof json.current === 'object');
}

export function normalizeMarine(json) {
  if (!isOpenMeteoPayload(json)) return null;
  const current = json.current;
  const values = {
    waveHeightM: finite(current.wave_height),
    wavePeriodS: finite(current.wave_period),
    waveFromDeg: finite(current.wave_direction),
    swellHeightM: finite(current.swell_wave_height),
    seaSurfaceTempC: finite(current.sea_surface_temperature),
  };
  if (Object.values(values).every((value) => value === null)) return null;
  const times = Array.isArray(json.daily?.time) ? json.daily.time : [];
  const maxima = Array.isArray(json.daily?.wave_height_max) ? json.daily.wave_height_max : [];
  return {
    ...values,
    dailyMaxWaveM: times
      .map((date, index) => ({ date: String(date), heightM: finite(maxima[index]) }))
      .filter((entry) => entry.heightM !== null),
  };
}

export function normalizeSolar(json) {
  return {
    shortwaveWm2: finite(json?.current?.shortwave_radiation),
    directWm2: finite(json?.current?.direct_radiation),
    surfaceTempC: finite(json?.hourly?.soil_temperature_0cm?.[0]),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/data/weatherReportNormalize.test.mjs`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add server/providers/weather-report/normalize.js src/data/weatherReportNormalize.test.mjs
git commit -m "feat(weather-report): proxy normalization helpers"
```

---

### Task 2: Weather report proxy, cache and plugin

**Files:**
- Create: `server/providers/weather-report.js`
- Modify: `server/providers/local.js`: import directly below `import { weatherRadarProxy } from './weather-radar.js';`; `weatherReportProxy(),` directly after `weatherRadarProxy(),` in `localProviderPlugins()`; re-export next to the weather-radar re-export.
- Test: `src/data/weatherReportProxy.test.mjs`

**Interfaces:**
- Consumes:
  - Task 1: every export of `server/providers/weather-report/normalize.js`.
  - `googleServerApiKey()` from `./places/google-key.js`.
  - `fetchRegionalPlace({ latitude, longitude }) → Promise<{ label, … } | null>` from `./regional/place.js` (throws on HTTP failure).
  - `makeRateLimiter({ windowMs, max, globalMax }) → (key) => boolean` and `clientKey(req)` from `./common/rate-limit.js`.
  - `coalesceProxyRequest(inFlight, key, create) → { promise, shared }` and `readResponseJsonCapped(response, maxBytes)` from `./common/http.js`.
- Produces:
  - `createWeatherReportHandler({ fetchImpl, now, apiKey, fetchPlace, limiter, log, requestTimeoutMs, reportTimeoutMs, cacheLimit }) → async (req, res)`, mounted at `/api/weather-report` (so `req.url` is `/?lat=…&lon=…`).
  - `weatherReportProxy(options) → { name: 'weather-report-proxy', configureServer, configurePreviewServer }`.
  - Constants: `REQUEST_TIMEOUT_MS = 10_000`, `REPORT_TIMEOUT_MS = 15_000`, `FRESH_MS = 600_000`, `STALE_MAX_MS = 3_600_000`, `CACHE_LIMIT = 500`.
  - The response body is the spec's report object.

- [ ] **Step 1: Write the failing test**

```js
// src/data/weatherReportProxy.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import createViteConfig from '../../vite.config.js';
import { FRESH_MS, STALE_MAX_MS, createWeatherReportHandler } from '../../server/providers/weather-report.js';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/weather-report/${name}`, import.meta.url), 'utf8'));
const T0 = Date.UTC(2026, 8, 14, 12, 10);
const MIN = 60_000;
const fail = () => new Response('busy', { status: 503 });

function invoke(handler, url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = { method, url, headers: {}, socket: { remoteAddress: '127.0.0.1' } };
    const res = {
      writeHead(status, headers) { this.status = status; this.headers = headers || {}; },
      end(body) {
        const text = Buffer.isBuffer(body) ? body.toString('utf8') : String(body || '');
        resolve({ status: this.status, headers: this.headers, text, json: () => JSON.parse(text) });
      },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

/** Routes match by URL substring; a function answer receives the URL and may return a Response. */
function harness(overrides = {}, routeOverrides = {}) {
  const calls = [];
  const routes = {
    'currentConditions:lookup': () => fixture('google-current.json'),
    'forecast/hours:lookup': (href) =>
      fixture(href.includes('pageToken=fixture-page-2') ? 'google-hourly-page2.json' : 'google-hourly-page1.json'),
    'forecast/days:lookup': () => fixture('google-daily.json'),
    'marine-api.open-meteo.com': () => fixture('open-meteo-marine-coastal.json'),
    'api.open-meteo.com/v1/forecast': () => fixture('open-meteo-solar.json'),
    ...routeOverrides,
  };
  const fetchImpl = async (url, options = {}) => {
    const href = String(url);
    calls.push({ href, options });
    for (const [match, answer] of Object.entries(routes)) {
      if (!href.includes(match)) continue;
      const value = await answer(href, options);
      return value instanceof Response ? value : Response.json(value);
    }
    throw new Error('unexpected upstream');
  };
  const clock = { now: T0 };
  const handler = createWeatherReportHandler({
    fetchImpl,
    now: () => clock.now,
    apiKey: () => 'TEST-KEY',
    fetchPlace: async () => ({ label: 'Galveston, Texas' }),
    limiter: () => true,
    log: () => {},
    requestTimeoutMs: 1000,
    reportTimeoutMs: 1500,
    ...overrides,
  });
  const count = (match) => calls.filter((call) => call.href.includes(match)).length;
  return { handler, calls, count, clock };
}

const ROUTE = '/?lat=29.27&lon=-94.82';

test('a full report normalizes every source, pages the hourly forecast and hides the key', async () => {
  const h = harness();
  const response = await invoke(h.handler, ROUTE);
  assert.equal(response.status, 200);
  const body = response.json();
  assert.deepEqual(body.point, { lat: 29.25, lon: -94.8 });
  assert.equal(body.place, 'Galveston, Texas');
  assert.equal(body.timeZone, 'America/Chicago');
  assert.equal(body.generatedAt, T0);
  assert.equal(body.stale, false);
  assert.deepEqual(body.sources, { google: 'ok', openMeteoMarine: 'ok', openMeteoSolar: 'ok', place: 'ok' });
  assert.equal(body.now.temperatureC, 29.8);
  assert.equal(body.hourly.length, 48);
  assert.equal(body.daily.length, 10);
  assert.equal(body.marine.waveHeightM, 0.46);
  assert.equal(body.solar.surfaceTempC, 28.8);
  assert.equal(h.count('forecast/hours:lookup'), 2);
  assert.doesNotMatch(response.text, /TEST-KEY/);
  for (const call of h.calls) {
    assert.equal(call.options.headers['User-Agent'], 'CyclopsView/0.1 (+https://github.com/CaptPat/gods-eye-view)');
  }
});

test('reports are cached per grid cell for ten minutes, and the oldest key is evicted', async () => {
  const h = harness({ cacheLimit: 2 });
  await invoke(h.handler, ROUTE);
  await invoke(h.handler, '/?lat=29.26&lon=-94.79');
  assert.equal(h.count('currentConditions:lookup'), 1, 'same 0.05° cell is a cache hit');
  h.clock.now += FRESH_MS + 1;
  await invoke(h.handler, ROUTE);
  assert.equal(h.count('currentConditions:lookup'), 2, 'expired after ten minutes');
  await invoke(h.handler, '/?lat=10&lon=10');
  await invoke(h.handler, '/?lat=20&lon=20');
  await invoke(h.handler, ROUTE);
  assert.equal(h.count('currentConditions:lookup'), 5, 'the oldest key was evicted at the cache limit');
});

test('one failing source leaves the others; inland marine is null but ok; place failure is tolerated', async () => {
  const failing = harness({ fetchPlace: async () => { throw new Error('nominatim down'); } }, { 'marine-api.open-meteo.com': fail });
  const body = (await invoke(failing.handler, ROUTE)).json();
  assert.deepEqual(body.sources, { google: 'ok', openMeteoMarine: 'unavailable', openMeteoSolar: 'ok', place: 'unavailable' });
  assert.equal(body.marine, null);
  assert.equal(body.place, null);

  const inland = harness({}, { 'marine-api.open-meteo.com': () => fixture('open-meteo-marine-inland.json') });
  const inlandBody = (await invoke(inland.handler, ROUTE)).json();
  assert.equal(inlandBody.sources.openMeteoMarine, 'ok');
  assert.equal(inlandBody.marine, null);
});

test('with every weather source failing the route is 502, or serves the last report as stale for an hour', async () => {
  const down = ['currentConditions:lookup', 'marine-api.open-meteo.com', 'api.open-meteo.com/v1/forecast'];
  const cold = harness({}, Object.fromEntries(down.map((key) => [key, fail])));
  const failed = await invoke(cold.handler, ROUTE);
  assert.equal(failed.status, 502);
  assert.deepEqual(failed.json(), { error: 'Weather sources unavailable' });

  const state = { broken: false };
  const guard = (answer) => (href) => (state.broken ? fail() : answer(href));
  const h = harness({}, {
    'currentConditions:lookup': guard(() => fixture('google-current.json')),
    'marine-api.open-meteo.com': guard(() => fixture('open-meteo-marine-coastal.json')),
    'api.open-meteo.com/v1/forecast': guard(() => fixture('open-meteo-solar.json')),
  });
  await invoke(h.handler, ROUTE);
  state.broken = true;
  h.clock.now = T0 + 20 * MIN;
  const stale = await invoke(h.handler, ROUTE);
  assert.equal(stale.status, 200);
  assert.equal(stale.json().stale, true);
  assert.equal(stale.json().generatedAt, T0);
  h.clock.now = T0 + STALE_MAX_MS + 1;
  assert.equal((await invoke(h.handler, ROUTE)).status, 502);
});

test('without a Google key the report is not-configured and makes no Google request', async () => {
  const h = harness({ apiKey: () => '' });
  const response = await invoke(h.handler, ROUTE);
  assert.equal(response.status, 200);
  const body = response.json();
  assert.equal(body.sources.google, 'not-configured');
  assert.equal(body.now, null);
  assert.equal(body.hourly, null);
  assert.equal(body.daily, null);
  assert.equal(body.timeZone, null);
  assert.equal(h.count('googleapis.com'), 0);
});

test('validation, rate limiting and methods', async () => {
  const h = harness();
  const bad = await invoke(h.handler, '/?lat=95&lon=0');
  assert.equal(bad.status, 400);
  assert.match(bad.json().error, /lat/);
  const limited = harness({ limiter: () => false });
  const refused = await invoke(limited.handler, ROUTE);
  assert.equal(refused.status, 429);
  assert.equal(refused.headers['Retry-After'], '10');
  assert.equal((await invoke(h.handler, ROUTE, 'POST')).status, 405);
});

test('a source still pending at the report deadline is unavailable', async () => {
  const h = harness({ reportTimeoutMs: 50 }, { 'api.open-meteo.com/v1/forecast': () => new Promise(() => {}) });
  const started = Date.now();
  const body = (await invoke(h.handler, ROUTE)).json();
  assert.ok(Date.now() - started < 1000);
  assert.equal(body.sources.openMeteoSolar, 'unavailable');
  assert.equal(body.solar, null);
  assert.equal(body.sources.google, 'ok');
});

test('concurrent requests for one grid cell share one upstream fan-out', async () => {
  const h = harness();
  await Promise.all([invoke(h.handler, ROUTE), invoke(h.handler, ROUTE)]);
  assert.equal(h.count('currentConditions:lookup'), 1);
});

test('the plugin is registered in the Vite config at /api/weather-report', () => {
  const plugin = createViteConfig({ mode: 'test' }).plugins.find((p) => p.name === 'weather-report-proxy');
  assert.ok(plugin, 'weather-report-proxy must be registered');
  const routes = new Map();
  plugin.configureServer({ middlewares: { use: (route, handler) => routes.set(route, handler) } });
  assert.equal(typeof routes.get('/api/weather-report'), 'function');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/data/weatherReportProxy.test.mjs`
Expected: FAIL with `Cannot find module` for `server/providers/weather-report.js`.

- [ ] **Step 3: Write the implementation**

```js
// server/providers/weather-report.js
import { googleServerApiKey } from './places/google-key.js';
import { fetchRegionalPlace } from './regional/place.js';
import { clientKey, makeRateLimiter } from './common/rate-limit.js';
import { coalesceProxyRequest, readResponseJsonCapped } from './common/http.js';
import {
  googleCurrentUrl,
  googleDailyUrl,
  googleHourlyUrl,
  googleTimeZone,
  isOpenMeteoPayload,
  marineUrl,
  normalizeGoogleDaily,
  normalizeGoogleHourly,
  normalizeGoogleNow,
  normalizeMarine,
  normalizeSolar,
  parseReportQuery,
  reportCacheKey,
  solarUrl,
} from './weather-report/normalize.js';

export const REQUEST_TIMEOUT_MS = 10_000;
export const REPORT_TIMEOUT_MS = 15_000;
export const FRESH_MS = 10 * 60_000;
export const STALE_MAX_MS = 60 * 60_000;
export const CACHE_LIMIT = 500;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const USER_AGENT = 'CyclopsView/0.1 (+https://github.com/CaptPat/gods-eye-view)';
const TIMED_OUT = Symbol('timed out');

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

const usable = (report) =>
  ['google', 'openMeteoMarine', 'openMeteoSolar'].some((name) => report.sources[name] === 'ok');

export function createWeatherReportHandler({
  fetchImpl = (...args) => fetch(...args),
  now = Date.now,
  apiKey = googleServerApiKey,
  fetchPlace = fetchRegionalPlace,
  limiter = makeRateLimiter({ windowMs: 60_000, max: 20, globalMax: 60 }),
  log = (message) => console.warn(message),
  requestTimeoutMs = REQUEST_TIMEOUT_MS,
  reportTimeoutMs = REPORT_TIMEOUT_MS,
  cacheLimit = CACHE_LIMIT,
} = {}) {
  const cache = new Map();
  const inFlight = new Map();

  async function getJson(url, signal) {
    const response = await fetchImpl(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(requestTimeoutMs)]),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return readResponseJsonCapped(response, MAX_RESPONSE_BYTES);
  }

  async function buildReport(point) {
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(TIMED_OUT);
      }, reportTimeoutMs);
    });
    // Log source names only: upstream URLs carry the Google key.
    const attempt = async (label, task) => {
      const running = task();
      running.catch(() => {});
      try {
        const value = await Promise.race([running, deadline]);
        if (value === TIMED_OUT) throw new Error('report deadline');
        return { ok: true, value };
      } catch (error) {
        log(`[weather-report] ${label} unavailable (${error?.name || 'Error'})`);
        return { ok: false, value: null };
      }
    };

    const key = String(apiKey() || '').trim();
    const signal = controller.signal;
    const [google, marine, solar, place] = await Promise.all([
      key
        ? attempt('google', async () => {
            const [current, firstPage, daily] = await Promise.all([
              getJson(googleCurrentUrl(point, key), signal),
              getJson(googleHourlyUrl(point, key), signal),
              getJson(googleDailyUrl(point, key), signal),
            ]);
            const pages = [firstPage];
            if (firstPage?.nextPageToken) {
              pages.push(await getJson(googleHourlyUrl(point, key, firstPage.nextPageToken), signal));
            }
            const nowSection = normalizeGoogleNow(current);
            if (!nowSection || nowSection.temperatureC === null) throw new Error('malformed');
            return {
              now: nowSection,
              hourly: normalizeGoogleHourly(pages),
              daily: normalizeGoogleDaily(daily),
              timeZone: googleTimeZone(current) ?? googleTimeZone(daily),
            };
          })
        : Promise.resolve(null),
      attempt('open-meteo marine', async () => {
        const json = await getJson(marineUrl(point), signal);
        if (!isOpenMeteoPayload(json)) throw new Error('malformed');
        return normalizeMarine(json);
      }),
      attempt('open-meteo solar', async () => {
        const json = await getJson(solarUrl(point), signal);
        if (!isOpenMeteoPayload(json)) throw new Error('malformed');
        return normalizeSolar(json);
      }),
      attempt('place', async () => {
        const result = await fetchPlace({ latitude: point.lat, longitude: point.lon });
        return result?.label ?? null;
      }),
    ]);
    clearTimeout(timer);
    const status = (result) => (result?.ok ? 'ok' : 'unavailable');
    return {
      point,
      place: place.value,
      timeZone: google?.ok ? google.value.timeZone : null,
      generatedAt: now(),
      stale: false,
      sources: {
        google: key ? status(google) : 'not-configured',
        openMeteoMarine: status(marine),
        openMeteoSolar: status(solar),
        place: status(place),
      },
      now: google?.ok ? google.value.now : null,
      hourly: google?.ok ? google.value.hourly : null,
      daily: google?.ok ? google.value.daily : null,
      marine: marine.ok ? marine.value : null,
      solar: solar.ok ? solar.value : null,
    };
  }

  function remember(cacheKey, report) {
    cache.delete(cacheKey);
    cache.set(cacheKey, report);
    while (cache.size > cacheLimit) cache.delete(cache.keys().next().value);
  }

  async function respond(point, res) {
    const cacheKey = reportCacheKey(point);
    const cached = cache.get(cacheKey);
    if (cached && now() - cached.generatedAt < FRESH_MS) return sendJson(res, 200, cached);
    const { promise } = coalesceProxyRequest(inFlight, cacheKey, () => buildReport(point));
    const report = await promise;
    if (usable(report)) {
      remember(cacheKey, report);
      return sendJson(res, 200, report);
    }
    if (cached && now() - cached.generatedAt <= STALE_MAX_MS) {
      return sendJson(res, 200, { ...cached, stale: true });
    }
    return sendJson(res, 502, { error: 'Weather sources unavailable' });
  }

  return async function handle(req, res) {
    try {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
      if (!limiter(clientKey(req))) {
        return sendJson(res, 429, { error: 'rate limited' }, { 'Retry-After': '10' });
      }
      const url = new URL(req.url || '/', 'http://weather-report.local');
      const point = parseReportQuery(url.searchParams);
      if (point.error) return sendJson(res, 400, { error: point.error });
      return await respond(point, res);
    } catch (error) {
      log(`[weather-report] request failed (${error?.name || 'Error'})`);
      return sendJson(res, 502, { error: 'Weather sources unavailable' });
    }
  };
}

export function weatherReportProxy(options = {}) {
  const handler = createWeatherReportHandler(options);
  const install = (server) => {
    server.middlewares.use('/api/weather-report', handler);
  };
  return {
    name: 'weather-report-proxy',
    configureServer: install,
    configurePreviewServer: install,
  };
}
```

- [ ] **Step 4: Register the plugin**

In `server/providers/local.js`:

```js
import { weatherReportProxy } from './weather-report.js';
```

directly below `import { weatherRadarProxy } from './weather-radar.js';`; `weatherReportProxy(),` directly after `weatherRadarProxy(),`; and next to the existing weather-radar re-export:

```js
export {
  createWeatherReportHandler,
  weatherReportProxy,
} from './weather-report.js';
```

- [ ] **Step 5: Run the tests**

Run: `node --test src/data/weatherReportProxy.test.mjs src/data/weatherReportNormalize.test.mjs`
Expected: PASS, 15 tests (9 + 6).

Then run `npm test` once. Expected: 0 failures. `src/tooling/previewServing.test.mjs` checks both hooks, and `src/tooling/viteBuild.test.mjs` checks that `gev-key-setup` stays last.

- [ ] **Step 6: Commit**

```bash
git add server/providers/weather-report.js server/providers/local.js src/data/weatherReportProxy.test.mjs
git commit -m "feat(weather-report): caching weather report proxy"
```

---

### Task 3: Report view model

**Files:**
- Create: `src/weatherReport/reportModel.js`
- Test: `src/weatherReport/reportModel.test.mjs`

**Interfaces:**
- Consumes: the report object produced by Task 2 (SI values; `sources`, `timeZone`, `generatedAt`, `stale`, sections possibly `null`).
- Produces:
  - Constants: `UNITS_STORAGE_KEY = 'gev.weatherReport.units'`, `CREDITS` (the two footer strings, in order).
  - `normalizeUnits(value) → 'imperial' | 'metric'`
  - `cardinal(deg) → 'N' … 'NNW' | ''`
  - `formatClock(ms, timeZone) → 'HH:MM'`
  - `utcOffsetLabel(ms, timeZone) → 'UTC−5' | 'UTC+5:30' | 'UTC'`
  - `buildReportView(report, { units, now }) → view`, where `view` is:
    - header: `{ title, coordinates, updated, status }`
    - `now`: `null | { temperature, condition, feelsLike, grid: [{ label, value }] }`
    - `hourly: [{ time, condition, temperature, precip, wind }]` and `daily: [{ day, dayCondition, nightCondition, high, low, precip }]`
    - `marine`: `null | { rows: [{ label, value }], dailyMax: [{ day, value }] }`
    - `solar`: `null | { rows: [{ label, value }] }`
    - `sections: { forecast, marine, solar }` (each `null` or a status string)
    - `credits`, and `pin: { title, details }`
  - Missing values render as `—`.

Rules:
- `marine` is `null` whenever the report's `marine` is `null`. `sections.marine` is `'Open-Meteo unavailable'` only when `sources.openMeteoMarine === 'unavailable'`, so inland points show no Marine section at all.
- The solar section combines Open-Meteo radiation and surface temperature (when solar is `ok`) with sunrise and sunset from `daily[0]` (when Google is `ok`). It is `null` only when both are missing.
- The spec lists imperial inches and metric millimetres, but the response carries no precipitation amounts, so no precipitation-amount formatter is built (YAGNI).

- [ ] **Step 1: Write the failing test**

```js
// src/weatherReport/reportModel.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CREDITS, UNITS_STORAGE_KEY, buildReportView, cardinal, formatClock, normalizeUnits, utcOffsetLabel,
} from './reportModel.js';

const T0 = Date.UTC(2026, 8, 14, 12, 10);
const REPORT = Object.freeze({
  point: { lat: 29.25, lon: -94.8 },
  place: 'Galveston, Texas',
  timeZone: 'America/Chicago',
  generatedAt: T0,
  stale: false,
  sources: { google: 'ok', openMeteoMarine: 'ok', openMeteoSolar: 'ok', place: 'ok' },
  now: {
    condition: 'Sunny', iconType: 'CLEAR', isDaytime: true, temperatureC: 29.8, feelsLikeC: 36.8,
    dewPointC: 26.1, humidityPct: 80, pressureHpa: 1017.56, windSpeedMs: 3.61, windGustMs: 3.89,
    windFromDeg: 166, cloudCoverPct: 9, visibilityM: 16000, uvIndex: 0, thunderstormPct: 0,
  },
  hourly: [
    { time: Date.parse('2026-09-14T12:00:00Z'), condition: 'Clear', iconType: 'CLEAR', temperatureC: 29.8, precipChancePct: 0, windSpeedMs: 3.61, windFromDeg: 166 },
  ],
  daily: [
    { date: '2026-09-14', dayCondition: 'Sunny', nightCondition: 'Clear', highC: 31.4, lowC: 29.4, precipChancePct: 45,
      sunrise: Date.parse('2026-09-14T12:03:33.388Z'), sunset: Date.parse('2026-09-15T00:25:23.308Z') },
  ],
  marine: { waveHeightM: 0.46, wavePeriodS: 4, waveFromDeg: 165, swellHeightM: 0.42, seaSurfaceTempC: 31,
    dailyMaxWaveM: [{ date: '2026-09-14', heightM: 0.52 }] },
  solar: { shortwaveWm2: 0, directWm2: 0, surfaceTempC: 28.8 },
});
const view = (patch = {}, options = {}) =>
  buildReportView({ ...REPORT, ...patch }, { units: 'imperial', now: T0, ...options });
const rows = (list) => Object.fromEntries(list.map((row) => [row.label, row.value]));

test('units, cardinals, clocks and offsets', () => {
  assert.equal(UNITS_STORAGE_KEY, 'gev.weatherReport.units');
  assert.equal(normalizeUnits('metric'), 'metric');
  assert.equal(normalizeUnits('kelvin'), 'imperial');
  assert.equal(normalizeUnits(undefined), 'imperial');
  assert.equal(cardinal(0), 'N');
  assert.equal(cardinal(166), 'SSE');
  assert.equal(cardinal(135), 'SE');
  assert.equal(cardinal(359), 'N');
  assert.equal(cardinal(null), '');
  assert.equal(formatClock(T0, 'America/Chicago'), '07:10');
  assert.equal(formatClock(T0, null), '12:10');
  assert.equal(utcOffsetLabel(T0, 'America/Chicago'), 'UTC−5');
  assert.equal(utcOffsetLabel(T0, 'Asia/Kolkata'), 'UTC+5:30');
  assert.equal(utcOffsetLabel(T0, 'UTC'), 'UTC');
});

test('imperial view: header, now grid, hourly, daily, marine, sun and surface, pin', () => {
  const v = view();
  assert.equal(v.title, 'Galveston, Texas');
  assert.equal(v.coordinates, '29.250, -94.800');
  assert.equal(v.updated, 'Updated 07:10 local (UTC−5)');
  assert.equal(v.status, null);
  assert.equal(v.now.temperature, '86°F');
  assert.equal(v.now.condition, 'Sunny');
  assert.equal(v.now.feelsLike, 'Feels like 98°F');
  assert.deepEqual(rows(v.now.grid), {
    Humidity: '80%', 'Dew point': '79°F', Pressure: '30.05 inHg', Wind: 'SSE 8 mph', Gusts: '9 mph',
    'Cloud cover': '9%', Visibility: '9.9 mi', 'UV index': '0', Thunderstorms: '0%',
  });
  assert.deepEqual(v.hourly[0], { time: '07:00', condition: 'Clear', temperature: '86°F', precip: '0%', wind: 'SSE 8 mph' });
  assert.deepEqual(v.daily[0], { day: 'Mon 14', dayCondition: 'Sunny', nightCondition: 'Clear', high: '89°F', low: '85°F', precip: '45%' });
  assert.deepEqual(rows(v.marine.rows), { Waves: '1.5 ft from SSE, 4 s', Swell: '1.4 ft', 'Sea surface': '88°F' });
  assert.deepEqual(v.marine.dailyMax, [{ day: 'Mon 14', value: '1.7 ft' }]);
  assert.deepEqual(rows(v.solar.rows), {
    'Shortwave radiation': '0 W/m²', 'Direct radiation': '0 W/m²', 'Surface temperature': '84°F',
    Sunrise: '07:03', Sunset: '19:25',
  });
  assert.deepEqual(v.sections, { forecast: null, marine: null, solar: null });
  assert.deepEqual(v.credits, CREDITS);
  assert.deepEqual(CREDITS, [
    'Source: Includes weather data from Google',
    'Marine, solar and surface: Weather data by Open-Meteo.com (CC BY 4.0)',
  ]);
  assert.deepEqual(v.pin, { title: '86°F · Sunny', details: ['Wind 8 mph SSE, gusts 9', 'Includes weather data from Google'] });
});

test('metric view converts every unit', () => {
  const v = view({}, { units: 'metric' });
  assert.equal(v.now.temperature, '30°C');
  assert.deepEqual(rows(v.now.grid), {
    Humidity: '80%', 'Dew point': '26°C', Pressure: '1018 hPa', Wind: 'SSE 13 km/h', Gusts: '14 km/h',
    'Cloud cover': '9%', Visibility: '16.0 km', 'UV index': '0', Thunderstorms: '0%',
  });
  assert.equal(rows(v.marine.rows).Waves, '0.5 m from SSE, 4 s');
  assert.equal(rows(v.marine.rows)['Sea surface'], '31°C');
  assert.equal(v.pin.details[0], 'Wind 13 km/h SSE, gusts 14');
});

test('per-section status text, stale line, missing place and missing time zone', () => {
  const googleDown = view({ sources: { ...REPORT.sources, google: 'unavailable' }, now: null, hourly: null, daily: null, timeZone: null });
  assert.equal(googleDown.sections.forecast, 'Google forecast unavailable');
  assert.equal(googleDown.now, null);
  assert.deepEqual(googleDown.hourly, []);
  assert.deepEqual(googleDown.daily, []);
  assert.equal(googleDown.updated, 'Updated 12:10 UTC');
  assert.deepEqual(rows(googleDown.solar.rows), {
    'Shortwave radiation': '0 W/m²', 'Direct radiation': '0 W/m²', 'Surface temperature': '84°F',
  });
  assert.deepEqual(googleDown.pin, { title: 'Weather unavailable', details: [] });

  assert.equal(view({ sources: { ...REPORT.sources, google: 'not-configured' }, now: null, hourly: null, daily: null }).sections.forecast,
    'Google weather not configured');

  const marineDown = view({ sources: { ...REPORT.sources, openMeteoMarine: 'unavailable' }, marine: null });
  assert.equal(marineDown.marine, null);
  assert.equal(marineDown.sections.marine, 'Open-Meteo unavailable');
  const inland = view({ marine: null });
  assert.equal(inland.marine, null);
  assert.equal(inland.sections.marine, null);

  const solarDown = view({ sources: { ...REPORT.sources, openMeteoSolar: 'unavailable' }, solar: null });
  assert.equal(solarDown.sections.solar, 'Open-Meteo unavailable');
  assert.deepEqual(rows(solarDown.solar.rows), { Sunrise: '07:03', Sunset: '19:25' });

  assert.equal(view({ stale: true }, { now: T0 + 45 * 60_000 }).status, 'Showing weather from 45 min ago');
  assert.equal(view({ place: null }).title, '29.250, -94.800');
  assert.equal(view({ now: { ...REPORT.now, humidityPct: null } }).now.grid[0].value, '—');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/weatherReport/reportModel.test.mjs`
Expected: FAIL with `Cannot find module` for `./reportModel.js`.

- [ ] **Step 3: Write the implementation**

```js
// src/weatherReport/reportModel.js
export const UNITS_STORAGE_KEY = 'gev.weatherReport.units';
export const CREDITS = Object.freeze([
  'Source: Includes weather data from Google',
  'Marine, solar and surface: Weather data by Open-Meteo.com (CC BY 4.0)',
]);
const DASH = '—';
const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const isNum = (value) => typeof value === 'number' && Number.isFinite(value);

export function normalizeUnits(value) {
  return value === 'metric' ? 'metric' : 'imperial';
}

export function cardinal(deg) {
  if (!isNum(deg)) return '';
  const normalized = ((deg % 360) + 360) % 360;
  return POINTS[Math.round(normalized / 22.5) % 16];
}

const temperature = (c, units) =>
  isNum(c) ? (units === 'metric' ? `${Math.round(c)}°C` : `${Math.round((c * 9) / 5 + 32)}°F`) : DASH;
const speedNumber = (ms, units) => (units === 'metric' ? Math.round(ms * 3.6) : Math.round(ms * 2.236936));
const speed = (ms, units) => (isNum(ms) ? `${speedNumber(ms, units)} ${units === 'metric' ? 'km/h' : 'mph'}` : DASH);
const distance = (m, units) =>
  isNum(m) ? (units === 'metric' ? `${(m / 1000).toFixed(1)} km` : `${(m / 1609.344).toFixed(1)} mi`) : DASH;
const pressure = (hPa, units) =>
  isNum(hPa) ? (units === 'metric' ? `${Math.round(hPa)} hPa` : `${(hPa * 0.02953).toFixed(2)} inHg`) : DASH;
const height = (m, units) =>
  isNum(m) ? (units === 'metric' ? `${m.toFixed(1)} m` : `${(m * 3.28084).toFixed(1)} ft`) : DASH;
const percent = (value) => (isNum(value) ? `${Math.round(value)}%` : DASH);
const plain = (value) => (isNum(value) ? String(Math.round(value)) : DASH);
const irradiance = (value) => (isNum(value) ? `${Math.round(value)} W/m²` : DASH);
const wind = (ms, deg, units) => (isNum(ms) ? `${cardinal(deg)} ${speed(ms, units)}`.trim() : DASH);
const textOr = (value) => (typeof value === 'string' && value ? value : DASH);

export function formatClock(ms, timeZone) {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: timeZone || 'UTC',
  }).format(ms);
}

export function utcOffsetLabel(ms, timeZone) {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: timeZone || 'UTC', timeZoneName: 'shortOffset' })
    .formatToParts(ms)
    .find((entry) => entry.type === 'timeZoneName');
  // Node formats UTC itself as "GMT" or "GMT+0"; both mean no offset.
  const offset = String(part?.value || 'GMT').replace(/^GMT/, '').replace(/^[+-]0$/, '');
  return offset ? `UTC${offset.replace('-', '−')}` : 'UTC';
}

function dayLabel(isoDate) {
  const ms = Date.parse(`${isoDate}T12:00:00Z`);
  if (!Number.isFinite(ms)) return DASH;
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(ms);
  return `${weekday} ${new Date(ms).getUTCDate()}`;
}

function forecastStatus(state) {
  if (state === 'not-configured') return 'Google weather not configured';
  return state === 'ok' ? null : 'Google forecast unavailable';
}

export function buildReportView(report, { units: rawUnits, now = Date.now() } = {}) {
  const units = normalizeUnits(rawUnits);
  const sources = report.sources || {};
  const coordinates = `${report.point.lat.toFixed(3)}, ${report.point.lon.toFixed(3)}`;
  const clock = formatClock(report.generatedAt, report.timeZone);
  const n = sources.google === 'ok' ? report.now : null;
  const firstDay = sources.google === 'ok' ? report.daily?.[0] : null;

  const solarRows = [];
  if (sources.openMeteoSolar === 'ok' && report.solar) {
    solarRows.push(
      { label: 'Shortwave radiation', value: irradiance(report.solar.shortwaveWm2) },
      { label: 'Direct radiation', value: irradiance(report.solar.directWm2) },
      { label: 'Surface temperature', value: temperature(report.solar.surfaceTempC, units) },
    );
  }
  if (firstDay && isNum(firstDay.sunrise) && isNum(firstDay.sunset)) {
    solarRows.push(
      { label: 'Sunrise', value: formatClock(firstDay.sunrise, report.timeZone) },
      { label: 'Sunset', value: formatClock(firstDay.sunset, report.timeZone) },
    );
  }

  const marine = sources.openMeteoMarine === 'ok' ? report.marine : null;
  return {
    title: report.place || coordinates,
    coordinates,
    updated: report.timeZone
      ? `Updated ${clock} local (${utcOffsetLabel(report.generatedAt, report.timeZone)})`
      : `Updated ${clock} UTC`,
    status: report.stale
      ? `Showing weather from ${Math.max(0, Math.round((now - report.generatedAt) / 60_000))} min ago`
      : null,
    now: n
      ? {
          temperature: temperature(n.temperatureC, units),
          condition: textOr(n.condition),
          feelsLike: `Feels like ${temperature(n.feelsLikeC, units)}`,
          grid: [
            { label: 'Humidity', value: percent(n.humidityPct) },
            { label: 'Dew point', value: temperature(n.dewPointC, units) },
            { label: 'Pressure', value: pressure(n.pressureHpa, units) },
            { label: 'Wind', value: wind(n.windSpeedMs, n.windFromDeg, units) },
            { label: 'Gusts', value: speed(n.windGustMs, units) },
            { label: 'Cloud cover', value: percent(n.cloudCoverPct) },
            { label: 'Visibility', value: distance(n.visibilityM, units) },
            { label: 'UV index', value: plain(n.uvIndex) },
            { label: 'Thunderstorms', value: percent(n.thunderstormPct) },
          ],
        }
      : null,
    hourly: sources.google === 'ok'
      ? (report.hourly || []).map((hour) => ({
          time: formatClock(hour.time, report.timeZone),
          condition: textOr(hour.condition),
          temperature: temperature(hour.temperatureC, units),
          precip: percent(hour.precipChancePct),
          wind: wind(hour.windSpeedMs, hour.windFromDeg, units),
        }))
      : [],
    daily: sources.google === 'ok'
      ? (report.daily || []).map((day) => ({
          day: dayLabel(day.date),
          dayCondition: textOr(day.dayCondition),
          nightCondition: textOr(day.nightCondition),
          high: temperature(day.highC, units),
          low: temperature(day.lowC, units),
          precip: percent(day.precipChancePct),
        }))
      : [],
    marine: marine
      ? {
          rows: [
            {
              label: 'Waves',
              value: `${height(marine.waveHeightM, units)} from ${cardinal(marine.waveFromDeg) || DASH}, ${plain(marine.wavePeriodS)} s`,
            },
            { label: 'Swell', value: height(marine.swellHeightM, units) },
            { label: 'Sea surface', value: temperature(marine.seaSurfaceTempC, units) },
          ],
          dailyMax: (marine.dailyMaxWaveM || []).map((entry) => ({ day: dayLabel(entry.date), value: height(entry.heightM, units) })),
        }
      : null,
    solar: solarRows.length ? { rows: solarRows } : null,
    sections: {
      forecast: forecastStatus(sources.google),
      marine: sources.openMeteoMarine === 'unavailable' ? 'Open-Meteo unavailable' : null,
      solar: sources.openMeteoSolar === 'unavailable' ? 'Open-Meteo unavailable' : null,
    },
    credits: CREDITS,
    pin: n
      ? {
          title: `${temperature(n.temperatureC, units)} · ${textOr(n.condition)}`,
          details: [
            isNum(n.windSpeedMs)
              ? `Wind ${speed(n.windSpeedMs, units)} ${cardinal(n.windFromDeg)}`.trim() +
                (isNum(n.windGustMs) ? `, gusts ${speedNumber(n.windGustMs, units)}` : '')
              : 'Wind —',
            'Includes weather data from Google',
          ],
        }
      : { title: 'Weather unavailable', details: [] },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/weatherReport/reportModel.test.mjs`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/weatherReport/reportModel.js src/weatherReport/reportModel.test.mjs
git commit -m "feat(weather-report): report view model with units and local time"
```

---

### Task 4: Fake DOM, ground pick and right-click menu

**Files:**
- Create: `src/testSupport/fakeDom.mjs`, `src/weatherReport/groundPick.js`, `src/weatherReport/contextMenu.js`
- Test: `src/weatherReport/groundPick.test.mjs`, `src/weatherReport/contextMenu.test.mjs`

**Interfaces:**
- Consumes:
  - `isPickedWorldPosition(cartesian) → boolean` from `src/data/scenePick.js`.
  - `bindTrackingClickGesture(handler, onClick(click, gesture), { eventTypes })` from `src/data/trackingClickGesture.js`. It returns nothing; unbinding means destroying the handler. `eventTypes` keys are `LEFT_DOWN`, `MOUSE_MOVE`, `LEFT_UP`, `LEFT_CLICK`.
  - `isTrackingSelectionGesture({ travelPx }) → travelPx <= 6`.
- Produces:
  - `createFakeDocument() → document` and `installFakeDocument(t) → document` (restores `globalThis.document` after the test).
    - Elements support `append`, `appendChild`, `prepend`, `replaceChildren`, `remove`, `contains`, `textContent`, `className`/`classList`, `id`, `setAttribute`/`getAttribute`, `style`, `hidden`, `disabled`, `focus`, `click`, `querySelector`/`querySelectorAll` for `#id`, `.class`, `tag` and `[attr="value"]`, and `EventTarget` events.
    - `document.body` exists, and `document.getElementById` searches it.
  - `pickGround(viewer, windowPosition) → { lat, lon } | null`.
  - `MENU_ITEM_LABEL = 'Weather report here'`.
  - `createContextMenu({ viewer, document, isSuppressed, onPick, pick, createHandler, eventTypes }) → { close(), isOpen(), destroy() }`.

- [ ] **Step 1: Write the fake DOM helper**

```js
// src/testSupport/fakeDom.mjs
/** Minimal DOM stand-in for browser-module tests: tree, text, classes, attributes, events and focus. */
class FakeElement extends EventTarget {
  constructor(tagName, ownerDocument) {
    super();
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.dataset = {};
    this.style = {};
    this.hidden = false;
    this.disabled = false;
    this._text = '';
    this._classes = new Set();
    this._rect = { left: 0, top: 0, width: 0, height: 0 };
    const classes = this._classes;
    this.classList = {
      add: (...values) => values.forEach((value) => classes.add(value)),
      remove: (...values) => values.forEach((value) => classes.delete(value)),
      contains: (value) => classes.has(value),
      toggle: (value, force = !classes.has(value)) => {
        if (force) classes.add(value);
        else classes.delete(value);
        return force;
      },
    };
  }

  get className() { return [...this._classes].join(' '); }
  set className(value) {
    this._classes.clear();
    String(value).split(/\s+/).filter(Boolean).forEach((name) => this._classes.add(name));
  }
  get id() { return this.attributes.get('id') ?? ''; }
  set id(value) { this.attributes.set('id', String(value)); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  removeAttribute(name) { this.attributes.delete(name); }

  appendChild(node) {
    node.remove();
    node.parentNode = this;
    this.children.push(node);
    return node;
  }
  append(...nodes) {
    for (const node of nodes) {
      this.appendChild(typeof node === 'string' ? this.ownerDocument.createTextNode(node) : node);
    }
  }
  prepend(node) {
    node.remove();
    node.parentNode = this;
    this.children.unshift(node);
  }
  replaceChildren(...nodes) {
    for (const child of [...this.children]) child.remove();
    this._text = '';
    this.append(...nodes);
  }
  remove() {
    if (!this.parentNode) return;
    const siblings = this.parentNode.children;
    siblings.splice(siblings.indexOf(this), 1);
    this.parentNode = null;
  }
  contains(node) {
    for (let current = node; current; current = current.parentNode) if (current === this) return true;
    return false;
  }

  get textContent() { return this._text + this.children.map((child) => child.textContent).join(''); }
  set textContent(value) {
    for (const child of [...this.children]) child.remove();
    this._text = String(value);
  }

  focus() { this.ownerDocument.activeElement = this; }
  click() { this.dispatchEvent(new Event('click')); }
  getBoundingClientRect() { return this._rect; }

  matches(selector) {
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector.startsWith('.')) return this._classes.has(selector.slice(1));
    const attribute = /^\[([\w-]+)="([^"]*)"\]$/.exec(selector);
    if (attribute) return this.getAttribute(attribute[1]) === attribute[2];
    return this.tagName === selector.toUpperCase();
  }
  querySelectorAll(selector) {
    const found = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (child.matches(selector)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}

export function createFakeDocument() {
  const document = new EventTarget();
  document.activeElement = null;
  document.createElement = (tagName) => new FakeElement(tagName, document);
  document.createTextNode = (text) => {
    const node = new FakeElement('#text', document);
    node._text = String(text);
    return node;
  };
  document.body = document.createElement('body');
  document.getElementById = (id) => document.body.querySelector(`#${id}`);
  return document;
}

export function installFakeDocument(t) {
  const prior = globalThis.document;
  const document = createFakeDocument();
  globalThis.document = document;
  t.after(() => {
    globalThis.document = prior;
  });
  return document;
}
```

- [ ] **Step 2: Write the failing tests**

```js
// src/weatherReport/groundPick.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { pickGround } from './groundPick.js';

const AUSTIN = Cesium.Cartesian3.fromDegrees(-97.743, 30.267);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} ≈ ${expected}`);
function viewer({ supported = true, pickPosition, pickEllipsoid, globePick } = {}) {
  return {
    scene: { pickPositionSupported: supported, pickPosition, globe: { pick: globePick } },
    camera: { pickEllipsoid, getPickRay: () => ({ ray: true }) },
  };
}

test('the depth pick wins when it lands on a real surface', () => {
  const point = pickGround(viewer({ pickPosition: () => AUSTIN }), { x: 10, y: 20 });
  near(point.lat, 30.267);
  near(point.lon, -97.743);
});

test('degenerate or throwing picks fall through to the ellipsoid, then the globe', () => {
  const ellipsoid = pickGround(viewer({ pickPosition: () => new Cesium.Cartesian3(0, 0, 0), pickEllipsoid: () => AUSTIN }), { x: 1, y: 1 });
  near(ellipsoid.lat, 30.267);
  const globe = pickGround(viewer({ supported: false, pickEllipsoid: () => { throw new Error('no'); }, globePick: () => AUSTIN }), { x: 1, y: 1 });
  near(globe.lon, -97.743);
});

test('sky and invalid positions pick nothing', () => {
  assert.equal(pickGround(viewer({ pickPosition: () => undefined, pickEllipsoid: () => undefined, globePick: () => undefined }), { x: 1, y: 1 }), null);
  assert.equal(pickGround(viewer({ pickPosition: () => AUSTIN }), { x: Number.NaN, y: 1 }), null);
  assert.equal(pickGround(null, { x: 1, y: 1 }), null);
});
```

```js
// src/weatherReport/contextMenu.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { installFakeDocument } from '../testSupport/fakeDom.mjs';
import { MENU_ITEM_LABEL, createContextMenu } from './contextMenu.js';

const TYPES = Cesium.ScreenSpaceEventType;
const POINT = { lat: 30.2671, lon: -97.7431 };

function setup(t, { pickResult = POINT } = {}) {
  const document = installFakeDocument(t);
  const canvas = document.createElement('canvas');
  canvas._rect = { left: 100, top: 50, width: 800, height: 600 };
  document.body.appendChild(canvas);
  const handler = { actions: new Map(), destroyed: false, setInputAction(fn, type) { this.actions.set(type, fn); }, destroy() { this.destroyed = true; } };
  const camera = { moveStart: new Cesium.Event() };
  const picks = [];
  const chosen = [];
  const menu = createContextMenu({
    viewer: { scene: { canvas }, camera },
    document,
    onPick: (point) => chosen.push(point),
    pick: (_viewer, position) => { picks.push(position); return pickResult; },
    createHandler: (target) => { assert.equal(target, canvas); return handler; },
  });
  const rightClick = (from, to = from) => {
    handler.actions.get(TYPES.RIGHT_DOWN)({ position: from });
    if (to !== from) handler.actions.get(TYPES.MOUSE_MOVE)({ startPosition: from, endPosition: to });
    handler.actions.get(TYPES.RIGHT_UP)({ position: to });
    handler.actions.get(TYPES.RIGHT_CLICK)({ position: to });
  };
  const key = (target, name) => target.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: name }));
  const menuElement = () => document.body.querySelector('[role="menu"]');
  return { document, canvas, handler, camera, picks, chosen, menu, rightClick, key, menuElement };
}

test('a right click opens the menu at the pointer with the coordinates, focused', (t) => {
  const s = setup(t);
  s.rightClick({ x: 10, y: 20 });
  const element = s.menuElement();
  assert.ok(element);
  assert.equal(element.style.left, '110px');
  assert.equal(element.style.top, '70px');
  const item = element.querySelector('[role="menuitem"]');
  assert.equal(item.textContent, MENU_ITEM_LABEL);
  assert.equal(element.querySelector('.weather-report-menu-coords').textContent, '30.267, -97.743');
  assert.equal(s.document.activeElement, item);
  assert.deepEqual(s.picks, [{ x: 10, y: 20 }]);
  const contextmenu = new Event('contextmenu', { cancelable: true });
  s.canvas.dispatchEvent(contextmenu);
  assert.equal(contextmenu.defaultPrevented, true);
});

test('a right drag, a sky pick and cockpit mode open nothing', (t) => {
  const drag = setup(t);
  drag.rightClick({ x: 10, y: 20 }, { x: 30, y: 20 });
  assert.equal(drag.menuElement(), null);
  assert.equal(drag.picks.length, 0);
  drag.menu.destroy();

  const sky = setup(t, { pickResult: null });
  sky.rightClick({ x: 10, y: 20 });
  assert.equal(sky.menuElement(), null);
  sky.menu.destroy();

  const cockpit = setup(t);
  cockpit.document.body.classList.add('cockpit-mode');
  cockpit.rightClick({ x: 10, y: 20 });
  assert.equal(cockpit.menuElement(), null);
});

test('Enter, Space and click pick exactly once and close the menu', (t) => {
  for (const activate of ['Enter', ' ', 'click']) {
    const s = setup(t);
    s.rightClick({ x: 10, y: 20 });
    const item = s.menuElement().querySelector('[role="menuitem"]');
    if (activate === 'click') item.click();
    else s.key(s.menuElement(), activate);
    item.click();
    assert.deepEqual(s.chosen, [POINT], `activation via ${JSON.stringify(activate)}`);
    assert.equal(s.menu.isOpen(), false);
    assert.equal(s.menuElement(), null);
    s.menu.destroy();
  }
});

test('Escape, an outside pointerdown, a wheel and a camera move close it', (t) => {
  const closers = [
    (s) => s.key(s.menuElement(), 'Escape'),
    (s) => s.document.dispatchEvent(new Event('pointerdown')),
    (s) => s.canvas.dispatchEvent(new Event('wheel')),
    (s) => s.camera.moveStart.raiseEvent(),
  ];
  for (const close of closers) {
    const s = setup(t);
    s.rightClick({ x: 10, y: 20 });
    close(s);
    assert.equal(s.menuElement(), null);
    assert.deepEqual(s.chosen, []);
    assert.equal(s.camera.moveStart.numberOfListeners, 0);
    s.menu.destroy();
  }
});

test('destroy closes the menu and removes the handler and listeners', (t) => {
  const s = setup(t);
  s.rightClick({ x: 10, y: 20 });
  s.menu.destroy();
  assert.equal(s.menuElement(), null);
  assert.equal(s.handler.destroyed, true);
  const contextmenu = new Event('contextmenu', { cancelable: true });
  s.canvas.dispatchEvent(contextmenu);
  assert.equal(contextmenu.defaultPrevented, false);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test src/weatherReport/groundPick.test.mjs src/weatherReport/contextMenu.test.mjs`
Expected: FAIL with `Cannot find module` for `./groundPick.js` and `./contextMenu.js`.

- [ ] **Step 4: Write the implementations**

```js
// src/weatherReport/groundPick.js
import * as Cesium from 'cesium';
import { isPickedWorldPosition } from '../data/scenePick.js';

/** Ground under a window position via depth pick, ellipsoid, then globe ray (the view-target cascade). */
export function pickGround(viewer, windowPosition) {
  const scene = viewer?.scene;
  if (!scene || !Number.isFinite(windowPosition?.x) || !Number.isFinite(windowPosition?.y)) return null;
  const position = new Cesium.Cartesian2(windowPosition.x, windowPosition.y);
  const camera = viewer.camera;
  const attempts = [
    () => (scene.pickPositionSupported && typeof scene.pickPosition === 'function' ? scene.pickPosition(position) : null),
    () => (typeof camera?.pickEllipsoid === 'function' ? camera.pickEllipsoid(position, Cesium.Ellipsoid.WGS84) : null),
    () => (typeof camera?.getPickRay === 'function' && typeof scene.globe?.pick === 'function'
      ? scene.globe.pick(camera.getPickRay(position), scene)
      : null),
  ];
  for (const attempt of attempts) {
    let cartesian = null;
    try {
      cartesian = attempt();
    } catch {
      cartesian = null;
    }
    if (!isPickedWorldPosition(cartesian)) continue;
    const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
    if (!cartographic) continue;
    return {
      lat: Cesium.Math.toDegrees(cartographic.latitude),
      lon: Cesium.Math.toDegrees(cartographic.longitude),
    };
  }
  return null;
}
```

```js
// src/weatherReport/contextMenu.js
import * as Cesium from 'cesium';
import { bindTrackingClickGesture, isTrackingSelectionGesture } from '../data/trackingClickGesture.js';
import { pickGround } from './groundPick.js';

export const MENU_ITEM_LABEL = 'Weather report here';

/** Right-click (not right-drag) on the globe opens a one-item menu for the picked ground point. */
export function createContextMenu({
  viewer,
  document: doc = globalThis.document,
  isSuppressed = () => doc.body.classList.contains('cockpit-mode'),
  onPick,
  pick = pickGround,
  createHandler = (canvas) => new Cesium.ScreenSpaceEventHandler(canvas),
  eventTypes = Cesium.ScreenSpaceEventType,
}) {
  const canvas = viewer.scene.canvas;
  const handler = createHandler(canvas);
  let menu = null;
  let removeMoveStart = null;

  const onContextMenu = (event) => event.preventDefault();
  const onOutsidePointer = (event) => {
    if (menu && !menu.contains(event.target)) close();
  };
  const onWheel = () => close();

  function close() {
    if (!menu) return;
    menu.remove();
    menu = null;
    doc.removeEventListener('pointerdown', onOutsidePointer, true);
    canvas.removeEventListener('wheel', onWheel);
    removeMoveStart?.();
    removeMoveStart = null;
  }

  function open(point, windowPosition) {
    close();
    const rect = canvas.getBoundingClientRect?.() || { left: 0, top: 0 };
    menu = doc.createElement('div');
    menu.className = 'weather-report-menu';
    menu.setAttribute('role', 'menu');
    menu.style.left = `${Math.round(rect.left + windowPosition.x)}px`;
    menu.style.top = `${Math.round(rect.top + windowPosition.y)}px`;
    const item = doc.createElement('button');
    item.className = 'weather-report-menu-item';
    item.setAttribute('role', 'menuitem');
    item.setAttribute('type', 'button');
    item.textContent = MENU_ITEM_LABEL;
    const coords = doc.createElement('div');
    coords.className = 'weather-report-menu-coords';
    coords.textContent = `${point.lat.toFixed(3)}, ${point.lon.toFixed(3)}`;
    menu.append(item, coords);

    let chosen = false;
    const choose = () => {
      if (chosen) return;
      chosen = true;
      close();
      onPick(point);
    };
    item.addEventListener('click', choose);
    menu.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        choose();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    });

    doc.body.appendChild(menu);
    doc.addEventListener('pointerdown', onOutsidePointer, true);
    canvas.addEventListener('wheel', onWheel, { passive: true });
    removeMoveStart = viewer.camera?.moveStart?.addEventListener?.(close) ?? null;
    item.focus();
  }

  bindTrackingClickGesture(
    handler,
    (click, gesture) => {
      if (!isTrackingSelectionGesture(gesture) || isSuppressed()) return;
      const point = pick(viewer, click?.position);
      if (point) open(point, click.position);
    },
    {
      eventTypes: {
        LEFT_DOWN: eventTypes.RIGHT_DOWN,
        MOUSE_MOVE: eventTypes.MOUSE_MOVE,
        LEFT_UP: eventTypes.RIGHT_UP,
        LEFT_CLICK: eventTypes.RIGHT_CLICK,
      },
    },
  );
  canvas.addEventListener('contextmenu', onContextMenu);

  return {
    close,
    isOpen: () => Boolean(menu),
    destroy() {
      close();
      canvas.removeEventListener('contextmenu', onContextMenu);
      handler.destroy();
    },
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test src/weatherReport/groundPick.test.mjs src/weatherReport/contextMenu.test.mjs`
Expected: PASS, 8 tests (3 + 5).

- [ ] **Step 6: Commit**

```bash
git add src/testSupport/fakeDom.mjs src/weatherReport/groundPick.js src/weatherReport/groundPick.test.mjs src/weatherReport/contextMenu.js src/weatherReport/contextMenu.test.mjs
git commit -m "feat(weather-report): ground pick and right-click menu"
```

---

### Task 5: Report pin and overlay card

**Files:**
- Create: `src/weatherReport/reportPin.js`
- Test: `src/weatherReport/reportPin.test.mjs`

**Interfaces:**
- Consumes:
  - `overlayHost = { setEntries(sourceId, entries, options?), setVisible(sourceId, visible), clearSource(sourceId) }`. This is the same host the earthquakes layer uses; `src/data/earthquakes.js` builds it from `src/overlays/worldOverlay.js`.
  - Entries accept `id`, `position` (a Cartesian3), `variant: 'card'`, `title`, `details[]`, `pinned`, `interactive`, `accessibilityLabel`, `activate`, `priority` and `placement`.
  - Task 3's `view.pin` shape `{ title, details }`.
- Produces:
  - `PIN_SOURCE_ID = 'weather-report'`.
  - `createReportPin({ viewer, overlayHost, requestRender, onActivate }) → { show(point, summary), update(summary), clear(), destroy() }`, where `point = { lat, lon }` and `summary = { title, details }`.

- [ ] **Step 1: Write the failing test**

```js
// src/weatherReport/reportPin.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { PIN_SOURCE_ID, createReportPin } from './reportPin.js';

const LOADING = { title: 'Loading weather', details: [] };
const LOADED = { title: '86°F · Sunny', details: ['Wind 8 mph SSE, gusts 9', 'Includes weather data from Google'] };
const GALVESTON = { lat: 29.25, lon: -94.8 };

function setup() {
  const calls = [];
  const renders = [];
  const activations = [];
  const viewer = {
    dataSources: {
      added: [],
      removed: [],
      add(source) { this.added.push(source); return source; },
      remove(source, destroy) { this.removed.push([source, destroy]); return true; },
    },
  };
  const overlayHost = {
    setEntries: (...args) => calls.push(['setEntries', ...args]),
    setVisible: (...args) => calls.push(['setVisible', ...args]),
    clearSource: (...args) => calls.push(['clearSource', ...args]),
  };
  const pin = createReportPin({
    viewer,
    overlayHost,
    requestRender: (reason) => renders.push(reason),
    onActivate: () => activations.push('activate'),
  });
  const entities = () => viewer.dataSources.added[0]?.entities.values ?? [];
  return { pin, calls, renders, activations, viewer, entities };
}

test('show adds one point marker and publishes a pinned, interactive card', () => {
  const s = setup();
  s.pin.show(GALVESTON, LOADING);
  assert.equal(PIN_SOURCE_ID, 'weather-report');
  assert.equal(s.viewer.dataSources.added.length, 1);
  assert.equal(s.entities().length, 1);
  const marker = s.entities()[0];
  assert.equal(marker.point.pixelSize.getValue(), 8);
  assert.equal(marker.point.outlineWidth.getValue(), 2);
  assert.ok(Cesium.Color.WHITE.equals(marker.point.outlineColor.getValue()));
  const expected = Cesium.Cartesian3.fromDegrees(-94.8, 29.25);
  assert.ok(Cesium.Cartesian3.equalsEpsilon(marker.position.getValue(Cesium.JulianDate.now()), expected, 1e-6));

  assert.deepEqual(s.calls[0], ['setVisible', 'weather-report', true]);
  assert.equal(s.calls[1][0], 'setEntries');
  assert.equal(s.calls[1][1], 'weather-report');
  const [entry] = s.calls[1][2];
  assert.equal(entry.variant, 'card');
  assert.equal(entry.title, 'Loading weather');
  assert.deepEqual(entry.details, []);
  assert.equal(entry.pinned, true);
  assert.equal(entry.interactive, true);
  assert.equal(entry.accessibilityLabel, 'Open weather report');
  assert.ok(Cesium.Cartesian3.equalsEpsilon(entry.position, expected, 1e-6));
  entry.activate();
  assert.deepEqual(s.activations, ['activate']);
  assert.deepEqual(s.renders, ['weather-report'], 'the marker change requests a render');
});

test('update republishes the card without replacing the marker; before show it does nothing', () => {
  const idle = setup();
  idle.pin.update(LOADED);
  assert.deepEqual(idle.calls, []);

  const s = setup();
  s.pin.show(GALVESTON, LOADING);
  const marker = s.entities()[0];
  s.pin.update(LOADED);
  const last = s.calls.at(-1);
  assert.equal(last[0], 'setEntries');
  assert.equal(last[2][0].title, '86°F · Sunny');
  assert.deepEqual(last[2][0].details, LOADED.details);
  assert.equal(s.entities()[0], marker);
});

test('showing a new point moves the single marker', () => {
  const s = setup();
  s.pin.show(GALVESTON, LOADING);
  s.pin.show({ lat: 30.25, lon: -97.75 }, LOADING);
  assert.equal(s.entities().length, 1);
  const position = s.entities()[0].position.getValue(Cesium.JulianDate.now());
  assert.ok(Cesium.Cartesian3.equalsEpsilon(position, Cesium.Cartesian3.fromDegrees(-97.75, 30.25), 1e-6));
  assert.equal(s.viewer.dataSources.added.length, 1, 'the data source is reused');
});

test('clear removes the marker and the overlay source once; destroy removes the data source', () => {
  const s = setup();
  s.pin.show(GALVESTON, LOADING);
  s.renders.length = 0;
  s.pin.clear();
  assert.equal(s.entities().length, 0);
  assert.deepEqual(s.calls.slice(-2), [['clearSource', 'weather-report'], ['setVisible', 'weather-report', false]]);
  assert.deepEqual(s.renders, ['weather-report']);
  const callCount = s.calls.length;
  s.pin.clear();
  assert.equal(s.calls.length, callCount, 'a second clear is a no-op');
  s.pin.destroy();
  assert.equal(s.viewer.dataSources.removed.length, 1);
  assert.equal(s.viewer.dataSources.removed[0][1], true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/weatherReport/reportPin.test.mjs`
Expected: FAIL with `Cannot find module` for `./reportPin.js`.

- [ ] **Step 3: Write the implementation**

```js
// src/weatherReport/reportPin.js
import * as Cesium from 'cesium';

export const PIN_SOURCE_ID = 'weather-report';
const ENTITY_ID = 'weather-report-pin';

/** One report location: a Cesium point marker plus a pinned world-overlay card. */
export function createReportPin({ viewer, overlayHost, requestRender = () => {}, onActivate = () => {} }) {
  let dataSource = null;
  let marker = null;
  let current = null;

  function publish() {
    const position = Cesium.Cartesian3.fromDegrees(current.point.lon, current.point.lat);
    overlayHost.setVisible(PIN_SOURCE_ID, true);
    overlayHost.setEntries(PIN_SOURCE_ID, [
      {
        id: ENTITY_ID,
        position,
        variant: 'card',
        title: current.summary.title,
        details: [...current.summary.details],
        pinned: true,
        interactive: true,
        accessibilityLabel: 'Open weather report',
        activate: () => onActivate(),
        priority: 1_000_000,
        placement: 'above',
      },
    ]);
  }

  function show(point, summary) {
    current = { point, summary };
    if (!dataSource) {
      dataSource = new Cesium.CustomDataSource('weather-report-pin');
      viewer.dataSources.add(dataSource);
    }
    if (marker) dataSource.entities.remove(marker);
    marker = dataSource.entities.add({
      id: ENTITY_ID,
      position: Cesium.Cartesian3.fromDegrees(point.lon, point.lat),
      point: {
        pixelSize: 8,
        color: Cesium.Color.fromCssColorString('#00d4ff'),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    publish();
    // Entity changes do not wake Cesium's requestRenderMode; overlay calls request their own frame.
    requestRender('weather-report');
  }

  function update(summary) {
    if (!current) return;
    current = { ...current, summary };
    publish();
  }

  function clear() {
    if (!current) return;
    if (marker && dataSource) dataSource.entities.remove(marker);
    marker = null;
    current = null;
    overlayHost.clearSource(PIN_SOURCE_ID);
    overlayHost.setVisible(PIN_SOURCE_ID, false);
    requestRender('weather-report');
  }

  function destroy() {
    clear();
    if (dataSource) {
      viewer.dataSources.remove(dataSource, true);
      dataSource = null;
    }
  }

  return { show, update, clear, destroy };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/weatherReport/reportPin.test.mjs`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/weatherReport/reportPin.js src/weatherReport/reportPin.test.mjs
git commit -m "feat(weather-report): report pin marker and overlay card"
```

---

### Task 6: Right-rail report panel and styles

**Files:**
- Create: `src/weatherReport/reportPanel.js`, `src/ui/styles/weather-report.css`
- Modify: `style.css` (add `@import './src/ui/styles/weather-report.css';` as the last line); `src/ui/styles/layers.css` (add `#right-context-rail > #weather-report-panel,` to the selector list at lines 146–148, directly after `#right-context-rail > #global-context-panel,` — keep `{` on the last selector)
- Test: `src/weatherReport/reportPanel.test.mjs`

**Interfaces:**
- Consumes:
  - Task 3: `CREDITS`, `normalizeUnits`, `buildReportView` (the test only) and the `view` shape.
  - Task 4: `installFakeDocument` from `src/testSupport/fakeDom.mjs`.
  - The rail element is `#right-context-rail`. It sets `pointer-events: none` on itself, and its direct children opt back in through the `layers.css` selector list.
- Produces:
  - `PANEL_ID = 'weather-report-panel'`.
  - `createReportPanel({ document, rail, units, onClose, onRefresh, onUnitsChange }) → { element, setUnits(units), showLoading({ title, coordinates }), showError(message, { title, coordinates }), render(view), reveal(), destroy() }`.
- Rules:
  - All text is set with `textContent`.
  - The footer always shows both `CREDITS` lines.
  - The forecast status line appears under "Now". The "Next 48 hours" and "10 days" sections are omitted when their lists are empty.
  - "Marine" appears when `view.marine` or `view.sections.marine` is set; "Sun and surface" appears when `view.solar` or `view.sections.solar` is set.

- [ ] **Step 1: Write the failing test**

```js
// src/weatherReport/reportPanel.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDocument } from '../testSupport/fakeDom.mjs';
import { CREDITS, buildReportView } from './reportModel.js';
import { PANEL_ID, createReportPanel } from './reportPanel.js';

const T0 = Date.UTC(2026, 8, 14, 12, 10);
const REPORT = {
  point: { lat: 29.25, lon: -94.8 },
  place: 'Galveston, Texas',
  timeZone: 'America/Chicago',
  generatedAt: T0,
  stale: false,
  sources: { google: 'ok', openMeteoMarine: 'ok', openMeteoSolar: 'ok', place: 'ok' },
  now: { condition: 'Sunny', temperatureC: 29.8, feelsLikeC: 36.8, dewPointC: 26.1, humidityPct: 80, pressureHpa: 1017.56,
    windSpeedMs: 3.61, windGustMs: 3.89, windFromDeg: 166, cloudCoverPct: 9, visibilityM: 16000, uvIndex: 0, thunderstormPct: 0 },
  hourly: [{ time: Date.parse('2026-09-14T12:00:00Z'), condition: 'Clear', temperatureC: 29.8, precipChancePct: 0, windSpeedMs: 3.61, windFromDeg: 166 }],
  daily: [{ date: '2026-09-14', dayCondition: 'Sunny', nightCondition: 'Clear', highC: 31.4, lowC: 29.4, precipChancePct: 45,
    sunrise: Date.parse('2026-09-14T12:03:33.388Z'), sunset: Date.parse('2026-09-15T00:25:23.308Z') }],
  marine: { waveHeightM: 0.46, wavePeriodS: 4, waveFromDeg: 165, swellHeightM: 0.42, seaSurfaceTempC: 31, dailyMaxWaveM: [] },
  solar: { shortwaveWm2: 0, directWm2: 0, surfaceTempC: 28.8 },
};
const viewOf = (patch = {}, options = {}) => buildReportView({ ...REPORT, ...patch }, { units: 'imperial', now: T0, ...options });

function setup(t, options = {}) {
  const document = installFakeDocument(t);
  const rail = document.createElement('aside');
  rail.id = 'right-context-rail';
  rail.appendChild(document.createElement('div'));
  document.body.appendChild(rail);
  const events = [];
  const panel = createReportPanel({
    document,
    rail,
    onClose: () => events.push('close'),
    onRefresh: () => events.push('refresh'),
    onUnitsChange: (units) => events.push(`units:${units}`),
    ...options,
  });
  const el = panel.element;
  const texts = (selector) => el.querySelectorAll(selector).map((node) => node.textContent);
  return { document, rail, panel, el, events, texts };
}

test('the panel is inserted first in the rail with the shared panel markup and permanent credits', (t) => {
  const s = setup(t);
  assert.equal(s.rail.children[0], s.el);
  assert.equal(PANEL_ID, 'weather-report-panel');
  assert.equal(s.el.id, 'weather-report-panel');
  assert.equal(s.el.getAttribute('data-panel-id'), 'weather-report-panel');
  assert.equal(s.el.classList.contains('panel-collapsible'), true);
  assert.ok(s.el.querySelector('.panel-glow'));
  assert.deepEqual(s.texts('.panel-title'), ['WEATHER']);
  s.panel.showLoading({ title: '29.250, -94.800', coordinates: '29.250, -94.800' });
  assert.deepEqual(s.texts('.weather-report-status'), ['Loading weather']);
  assert.equal(s.el.querySelector('.weather-report-status').getAttribute('aria-live'), 'polite');
  assert.equal(s.el.querySelector('.weather-report-refresh').disabled, true);
  const credits = s.el.querySelector('.weather-report-credits').textContent;
  assert.ok(credits.includes(CREDITS[0]));
  assert.ok(credits.includes(CREDITS[1]));
});

test('a full view renders every section in order', (t) => {
  const s = setup(t);
  s.panel.render(viewOf());
  assert.deepEqual(s.texts('h3'), ['Now', 'Next 48 hours', '10 days', 'Marine', 'Sun and surface']);
  assert.deepEqual(s.texts('.weather-report-place'), ['Galveston, Texas']);
  assert.deepEqual(s.texts('.weather-report-updated'), ['29.250, -94.800 · Updated 07:10 local (UTC−5)']);
  assert.deepEqual(s.texts('.weather-report-status'), ['']);
  assert.deepEqual(s.texts('.weather-report-now-temp'), ['86°F']);
  assert.deepEqual(s.texts('.weather-report-now-condition'), ['Sunny · Feels like 98°F']);
  assert.ok(s.texts('dd').includes('30.05 inHg'));
  assert.deepEqual(s.texts('.weather-report-hour'), ['07:00Clear86°F0%SSE 8 mph']);
  assert.deepEqual(s.texts('.weather-report-day'), ['Mon 14Sunny / Clear89°F / 85°F45%']);
  assert.ok(s.texts('dd').includes('07:03'));
  assert.deepEqual(s.texts('.weather-report-section-status'), []);
  assert.equal(s.el.querySelector('.weather-report-refresh').disabled, false);
});

test('section statuses, inland marine and stale reports', (t) => {
  const s = setup(t);
  s.panel.render(viewOf({
    sources: { ...REPORT.sources, google: 'unavailable', openMeteoMarine: 'unavailable' },
    now: null, hourly: null, daily: null, marine: null, timeZone: null,
  }));
  assert.deepEqual(s.texts('h3'), ['Now', 'Marine', 'Sun and surface']);
  assert.deepEqual(s.texts('.weather-report-section-status'), ['Google forecast unavailable', 'Open-Meteo unavailable']);
  assert.equal(s.el.querySelector('.weather-report-section-status').getAttribute('aria-live'), 'polite');

  s.panel.render(viewOf({ marine: null }));
  assert.deepEqual(s.texts('h3'), ['Now', 'Next 48 hours', '10 days', 'Sun and surface']);

  s.panel.render(viewOf({ stale: true }, { now: T0 + 45 * 60_000 }));
  assert.deepEqual(s.texts('.weather-report-status'), ['Showing weather from 45 min ago']);
});

test('units, refresh, close, errors and destroy', (t) => {
  const s = setup(t);
  const units = s.el.querySelector('.weather-report-units');
  assert.equal(units.textContent, '°F');
  units.click();
  s.panel.setUnits('metric');
  assert.equal(units.textContent, '°C');
  units.click();
  s.el.querySelector('.weather-report-refresh').click();
  s.el.querySelector('.weather-report-close').click();
  assert.deepEqual(s.events, ['units:metric', 'units:imperial', 'refresh', 'close']);
  s.panel.render(viewOf());
  s.panel.showError('Weather sources unavailable', { title: 'Galveston, Texas', coordinates: '29.250, -94.800' });
  assert.deepEqual(s.texts('.weather-report-status'), ['Weather sources unavailable']);
  assert.deepEqual(s.texts('h3'), []);
  s.panel.destroy();
  assert.equal(s.rail.children.includes(s.el), false);
});

test('place names are rendered as text, never markup', (t) => {
  const s = setup(t);
  s.panel.render(viewOf({ place: '<img src=x onerror=alert(1)>' }));
  assert.deepEqual(s.texts('.weather-report-place'), ['<img src=x onerror=alert(1)>']);
  assert.equal(s.el.querySelector('img'), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/weatherReport/reportPanel.test.mjs`
Expected: FAIL with `Cannot find module` for `./reportPanel.js`.

- [ ] **Step 3: Write the implementation**

```js
// src/weatherReport/reportPanel.js
import { CREDITS, normalizeUnits } from './reportModel.js';

export const PANEL_ID = 'weather-report-panel';

/** Right-rail weather report panel. Every string is set as text: the place name comes from Nominatim. */
export function createReportPanel({
  document: doc = globalThis.document,
  rail,
  units = 'imperial',
  onClose = () => {},
  onRefresh = () => {},
  onUnitsChange = () => {},
}) {
  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (className, text, label) => {
    const node = el('button', className, text);
    node.setAttribute('type', 'button');
    if (label) node.setAttribute('aria-label', label);
    return node;
  };

  const element = el('section', 'panel-collapsible weather-report-panel');
  element.id = PANEL_ID;
  element.setAttribute('data-panel-id', PANEL_ID);
  element.setAttribute('aria-label', 'Weather report');
  const inner = el('div', 'weather-report-panel-inner');
  const header = el('div', 'panel-header');
  const unitsButton = button('weather-report-units', '°F');
  const refreshButton = button('weather-report-refresh', '↻', 'Refresh weather report');
  const closeButton = button('weather-report-close', '×', 'Close weather report');
  header.append(el('span', 'panel-title', 'WEATHER'), el('span', 'panel-divider'), unitsButton, refreshButton, closeButton);
  const place = el('p', 'weather-report-place');
  const updated = el('p', 'weather-report-updated');
  const status = el('p', 'weather-report-status');
  status.setAttribute('aria-live', 'polite');
  const body = el('div', 'weather-report-body');
  const footer = el('footer', 'weather-report-credits');
  for (const credit of CREDITS) footer.append(el('p', null, credit));
  inner.append(header, place, updated, status, body, footer);
  element.append(el('div', 'panel-glow'), inner);
  rail.prepend(element);

  let currentUnits = normalizeUnits(units);
  const syncUnits = () => {
    unitsButton.textContent = currentUnits === 'metric' ? '°C' : '°F';
    unitsButton.setAttribute('aria-label', currentUnits === 'metric' ? 'Show °F' : 'Show °C');
  };
  syncUnits();
  unitsButton.addEventListener('click', () => onUnitsChange(currentUnits === 'metric' ? 'imperial' : 'metric'));
  refreshButton.addEventListener('click', () => onRefresh());
  closeButton.addEventListener('click', () => onClose());

  const grid = (rows) => {
    const list = el('dl', 'weather-report-grid');
    for (const row of rows) list.append(el('dt', null, row.label), el('dd', null, row.value));
    return list;
  };
  const section = (heading, statusText, ...content) => {
    const node = el('section', 'weather-report-section');
    node.append(el('h3', null, heading));
    if (statusText) {
      const line = el('p', 'weather-report-section-status', statusText);
      line.setAttribute('aria-live', 'polite');
      node.append(line);
    }
    node.append(...content);
    return node;
  };
  const row = (className, ...cells) => {
    const node = el('div', className);
    for (const cell of cells) node.append(el('span', null, cell));
    return node;
  };

  function setHeader({ title, coordinates }, statusText) {
    place.textContent = title;
    updated.textContent = coordinates;
    status.textContent = statusText;
  }

  function render(view) {
    place.textContent = view.title;
    updated.textContent = `${view.coordinates} · ${view.updated}`;
    status.textContent = view.status ?? '';
    refreshButton.disabled = false;
    const sections = [
      section(
        'Now',
        view.sections.forecast,
        ...(view.now
          ? [
              el('div', 'weather-report-now-temp', view.now.temperature),
              el('div', 'weather-report-now-condition', `${view.now.condition} · ${view.now.feelsLike}`),
              grid(view.now.grid),
            ]
          : []),
      ),
    ];
    if (view.hourly.length) {
      const strip = el('div', 'weather-report-hourly');
      for (const hour of view.hourly) {
        strip.append(row('weather-report-hour', hour.time, hour.condition, hour.temperature, hour.precip, hour.wind));
      }
      sections.push(section('Next 48 hours', null, strip));
    }
    if (view.daily.length) {
      const days = el('div', 'weather-report-daily');
      for (const day of view.daily) {
        days.append(row('weather-report-day', day.day, `${day.dayCondition} / ${day.nightCondition}`, `${day.high} / ${day.low}`, day.precip));
      }
      sections.push(section('10 days', null, days));
    }
    if (view.marine || view.sections.marine) {
      const content = [];
      if (view.marine) {
        content.push(grid(view.marine.rows));
        if (view.marine.dailyMax.length) {
          const maxima = el('div', 'weather-report-wave-max');
          for (const entry of view.marine.dailyMax) maxima.append(row('weather-report-wave-day', entry.day, entry.value));
          content.push(maxima);
        }
      }
      sections.push(section('Marine', view.sections.marine, ...content));
    }
    if (view.solar || view.sections.solar) {
      sections.push(section('Sun and surface', view.sections.solar, ...(view.solar ? [grid(view.solar.rows)] : [])));
    }
    body.replaceChildren(...sections);
  }

  return {
    element,
    setUnits(nextUnits) {
      currentUnits = normalizeUnits(nextUnits);
      syncUnits();
    },
    showLoading(header) {
      setHeader(header, 'Loading weather');
      refreshButton.disabled = true;
      body.replaceChildren();
    },
    showError(message, header) {
      setHeader(header, message);
      refreshButton.disabled = false;
      body.replaceChildren();
    },
    render,
    reveal() {
      element.scrollIntoView?.({ block: 'nearest' });
      closeButton.focus();
    },
    destroy() {
      element.remove();
    },
  };
}
```

- [ ] **Step 4: Add the styles**

Create `src/ui/styles/weather-report.css`:

```css
/* Right-click weather report: context menu and right-rail panel. */
.weather-report-menu {
  position: fixed;
  z-index: 1000;
  min-width: 180px;
  padding: 6px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 10px;
  backdrop-filter: blur(12px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: 13px;
}
.weather-report-menu-item {
  display: block;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.weather-report-menu-item:hover,
.weather-report-menu-item:focus-visible {
  background: var(--accent-dim);
  outline: none;
}
.weather-report-menu-coords {
  padding: 2px 10px 4px;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 11px;
}
#right-context-rail #weather-report-panel {
  width: 100%;
  max-height: 100%;
  pointer-events: auto;
}
.weather-report-panel-inner {
  max-height: 100%;
  overflow-y: auto;
  padding: 10px 14px 12px;
  box-sizing: border-box;
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: 12px;
}
.weather-report-panel .panel-header button {
  margin-left: 6px;
  padding: 2px 8px;
  border: 1px solid var(--glass-border);
  border-radius: 6px;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  cursor: pointer;
}
.weather-report-panel .panel-header button:disabled {
  opacity: 0.4;
  cursor: default;
}
.weather-report-place {
  margin: 8px 0 0;
  font-size: 14px;
  font-weight: 600;
}
.weather-report-updated,
.weather-report-status,
.weather-report-section-status {
  margin: 2px 0 0;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 11px;
}
.weather-report-section h3 {
  margin: 12px 0 6px;
  color: var(--accent);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.weather-report-now-temp {
  font-size: 28px;
  font-weight: 600;
}
.weather-report-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 10px;
  margin: 6px 0 0;
}
.weather-report-grid dt {
  color: var(--text-secondary);
}
.weather-report-grid dd {
  margin: 0;
  text-align: right;
}
.weather-report-hourly {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 4px;
}
.weather-report-hour {
  display: grid;
  flex: 0 0 auto;
  gap: 2px;
  min-width: 64px;
  text-align: center;
}
.weather-report-day,
.weather-report-wave-day {
  display: grid;
  grid-template-columns: 56px 1fr auto auto;
  gap: 8px;
  padding: 2px 0;
}
.weather-report-wave-day {
  grid-template-columns: 56px 1fr;
}
.weather-report-credits {
  margin-top: 12px;
  color: var(--text-dim);
  font-size: 10px;
}
.weather-report-credits p {
  margin: 2px 0 0;
}
```

In `style.css`, append as the last line:

```css
@import './src/ui/styles/weather-report.css';
```

In `src/ui/styles/layers.css`, change the selector list at lines 146–148 to:

```css
#right-context-rail > #pp-toggles,
#right-context-rail > #cctv-panel,
#right-context-rail > #global-context-panel,
#right-context-rail > #weather-report-panel {
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test src/weatherReport/reportPanel.test.mjs`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add src/weatherReport/reportPanel.js src/weatherReport/reportPanel.test.mjs src/ui/styles/weather-report.css style.css src/ui/styles/layers.css
git commit -m "feat(weather-report): right-rail report panel and styles"
```

---

### Task 7: Weather report orchestration

**Files:**
- Create: `src/weatherReport/index.js`
- Test: `src/weatherReport/index.test.mjs`

**Interfaces:**
- Consumes:
  - Task 3: `UNITS_STORAGE_KEY`, `normalizeUnits`, `buildReportView`.
  - Task 4: `createContextMenu({ viewer, document, onPick })`, returning `{ destroy }`.
  - Task 5: `createReportPin({ viewer, overlayHost, requestRender, onActivate })`, returning `{ show, update, clear, destroy }`.
  - Task 6: `createReportPanel({ document, rail, units, onClose, onRefresh, onUnitsChange })`, returning `{ setUnits, showLoading, showError, render, reveal, destroy }`.
  - Task 2: the route `/api/weather-report?lat&lon`, which answers a report, or `{ error }` with a non-2xx status.
- Produces:
  - `REPORT_ENDPOINT = '/api/weather-report'`.
  - `createWeatherReport({ viewer, overlayHost, document, fetchImpl, storage, requestRender, now, createMenu, createPin, createPanel }) → { open(point), close(), setUnits(units), getUnits(), destroy() }`.
- Rules:
  - The panel is created lazily on the first report, inside `#right-context-rail`. Closing it destroys the panel and clears the pin.
  - A new pick aborts the in-flight request, and a result from a superseded request is ignored.
  - Storage reads and writes are wrapped in try/catch, defaulting to `imperial`.

- [ ] **Step 1: Write the failing test**

```js
// src/weatherReport/index.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDocument } from '../testSupport/fakeDom.mjs';
import { REPORT_ENDPOINT, createWeatherReport } from './index.js';

const T0 = Date.UTC(2026, 8, 14, 12, 10);
const POINT = { lat: 29.3, lon: -94.8 };
const REPORT = {
  point: { lat: 29.3, lon: -94.8 },
  place: 'Galveston, Texas',
  timeZone: 'America/Chicago',
  generatedAt: T0,
  stale: false,
  sources: { google: 'ok', openMeteoMarine: 'ok', openMeteoSolar: 'ok', place: 'ok' },
  now: { condition: 'Sunny', temperatureC: 29.8, feelsLikeC: 36.8, dewPointC: 26.1, humidityPct: 80, pressureHpa: 1017.56,
    windSpeedMs: 3.61, windGustMs: 3.89, windFromDeg: 166, cloudCoverPct: 9, visibilityM: 16000, uvIndex: 0, thunderstormPct: 0 },
  hourly: [],
  daily: [],
  marine: null,
  solar: { shortwaveWm2: 0, directWm2: 0, surfaceTempC: 28.8 },
};
const settle = async () => {
  for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

function setup(t, { storage = new Map(), rail = true } = {}) {
  const document = installFakeDocument(t);
  if (rail) {
    const aside = document.createElement('aside');
    aside.id = 'right-context-rail';
    document.body.appendChild(aside);
  }
  const requests = [];
  const pinCalls = [];
  const panels = [];
  let menuOptions = null;
  let pinOptions = null;
  const menu = { destroyed: false, destroy() { this.destroyed = true; } };
  const fetchImpl = (url, { signal }) =>
    new Promise((resolve, reject) => {
      requests.push({ url, signal, resolve });
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
  const respond = (index, status, body) =>
    requests[index].resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
  const store = storage instanceof Map
    ? { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }
    : storage;
  const report = createWeatherReport({
    viewer: { id: 'viewer' },
    overlayHost: { id: 'host' },
    document,
    fetchImpl,
    storage: store,
    requestRender: () => {},
    now: () => T0,
    createMenu: (options) => { menuOptions = options; return menu; },
    createPin: (options) => {
      pinOptions = options;
      return {
        show: (...args) => pinCalls.push(['show', ...args]),
        update: (...args) => pinCalls.push(['update', ...args]),
        clear: () => pinCalls.push(['clear']),
        destroy: () => pinCalls.push(['destroy']),
      };
    },
    createPanel: (options) => {
      const calls = [];
      const panel = {
        options,
        calls,
        setUnits: (...args) => calls.push(['setUnits', ...args]),
        showLoading: (...args) => calls.push(['showLoading', ...args]),
        showError: (...args) => calls.push(['showError', ...args]),
        render: (view) => calls.push(['render', view]),
        reveal: () => calls.push(['reveal']),
        destroy: () => calls.push(['destroy']),
      };
      panels.push(panel);
      return panel;
    },
  });
  return { document, report, requests, respond, pinCalls, panels, menu, storage, menuOptions: () => menuOptions, pinOptions: () => pinOptions };
}

test('a pick pins the spot, shows loading, fetches the report and renders it', async (t) => {
  const s = setup(t);
  s.menuOptions().onPick(POINT);
  assert.deepEqual(s.pinCalls[0], ['show', POINT, { title: 'Loading weather', details: [] }]);
  assert.equal(s.panels.length, 1);
  assert.deepEqual(s.panels[0].calls[0], ['showLoading', { title: '29.300, -94.800', coordinates: '29.300, -94.800' }]);
  assert.equal(s.panels[0].options.units, 'imperial');
  assert.equal(s.requests[0].url, `${REPORT_ENDPOINT}?lat=29.3000&lon=-94.8000`);
  s.respond(0, 200, REPORT);
  await settle();
  const render = s.panels[0].calls.find(([name]) => name === 'render');
  assert.equal(render[1].title, 'Galveston, Texas');
  assert.equal(render[1].now.temperature, '86°F');
  assert.deepEqual(s.pinCalls.at(-1), ['update', { title: '86°F · Sunny', details: ['Wind 8 mph SSE, gusts 9', 'Includes weather data from Google'] }]);
});

test('a second pick aborts the first request and ignores its result', async (t) => {
  const s = setup(t);
  s.menuOptions().onPick(POINT);
  s.menuOptions().onPick({ lat: 30.25, lon: -97.75 });
  assert.equal(s.requests[0].signal.aborted, true);
  s.respond(0, 200, REPORT);
  s.respond(1, 200, { ...REPORT, place: 'Austin, Texas' });
  await settle();
  const renders = s.panels[0].calls.filter(([name]) => name === 'render');
  assert.equal(renders.length, 1);
  assert.equal(renders[0][1].title, 'Austin, Texas');
  assert.equal(s.panels.length, 1, 'the open panel is reused');
});

test('an error response shows the panel status and an unavailable pin', async (t) => {
  const s = setup(t);
  s.menuOptions().onPick(POINT);
  s.respond(0, 502, { error: 'Weather sources unavailable' });
  await settle();
  assert.deepEqual(s.panels[0].calls.at(-1), ['showError', 'Weather sources unavailable', { title: '29.300, -94.800', coordinates: '29.300, -94.800' }]);
  assert.deepEqual(s.pinCalls.at(-1), ['update', { title: 'Weather unavailable', details: [] }]);
});

test('closing aborts, clears the pin and destroys the panel; the next pick builds a new panel', async (t) => {
  const s = setup(t);
  s.menuOptions().onPick(POINT);
  s.panels[0].options.onClose();
  assert.equal(s.requests[0].signal.aborted, true);
  assert.deepEqual(s.pinCalls.at(-1), ['clear']);
  assert.deepEqual(s.panels[0].calls.at(-1), ['destroy']);
  s.menuOptions().onPick(POINT);
  assert.equal(s.panels.length, 2);
});

test('the units preference persists, re-renders, and survives broken storage', async (t) => {
  const storage = new Map([['gev.weatherReport.units', 'metric']]);
  const s = setup(t, { storage });
  s.menuOptions().onPick(POINT);
  assert.equal(s.panels[0].options.units, 'metric');
  s.respond(0, 200, REPORT);
  await settle();
  s.panels[0].options.onUnitsChange('imperial');
  assert.equal(storage.get('gev.weatherReport.units'), 'imperial');
  assert.deepEqual(s.panels[0].calls.filter(([name]) => name === 'setUnits'), [['setUnits', 'imperial']]);
  assert.equal(s.panels[0].calls.filter(([name]) => name === 'render').at(-1)[1].now.temperature, '86°F');
  assert.equal(s.report.getUnits(), 'imperial');

  const broken = setup(t, { storage: { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } } });
  assert.equal(broken.report.getUnits(), 'imperial');
  assert.doesNotThrow(() => broken.report.setUnits('metric'));
  assert.equal(broken.report.getUnits(), 'metric');
});

test('refresh re-requests the same point, pin activation reveals the panel, destroy cleans up', async (t) => {
  const s = setup(t);
  s.menuOptions().onPick(POINT);
  s.respond(0, 200, REPORT);
  await settle();
  s.panels[0].options.onRefresh();
  assert.equal(s.requests.length, 2);
  assert.equal(s.requests[1].url, s.requests[0].url);
  s.pinOptions().onActivate();
  assert.deepEqual(s.panels[0].calls.at(-1), ['reveal']);
  s.report.destroy();
  assert.equal(s.menu.destroyed, true);
  assert.deepEqual(s.pinCalls.slice(-2), [['clear'], ['destroy']]);
  s.menuOptions().onPick(POINT);
  assert.equal(s.requests.length, 2, 'no request after destroy');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/weatherReport/index.test.mjs`
Expected: FAIL with `Cannot find module` for `./index.js`.

- [ ] **Step 3: Write the implementation**

```js
// src/weatherReport/index.js
import { createContextMenu } from './contextMenu.js';
import { UNITS_STORAGE_KEY, buildReportView, normalizeUnits } from './reportModel.js';
import { createReportPanel } from './reportPanel.js';
import { createReportPin } from './reportPin.js';

export const REPORT_ENDPOINT = '/api/weather-report';
const LOADING_PIN = Object.freeze({ title: 'Loading weather', details: Object.freeze([]) });
const UNAVAILABLE_PIN = Object.freeze({ title: 'Weather unavailable', details: Object.freeze([]) });

/** Right-click → pin → one report request → right-rail panel. */
export function createWeatherReport({
  viewer,
  overlayHost,
  document: doc = globalThis.document,
  fetchImpl = (...args) => fetch(...args),
  storage = null,
  requestRender = () => {},
  now = Date.now,
  createMenu = createContextMenu,
  createPin = createReportPin,
  createPanel = createReportPanel,
}) {
  let units = readUnits();
  let panel = null;
  let point = null;
  let report = null;
  let controller = null;
  let destroyed = false;

  function readUnits() {
    try {
      return normalizeUnits(storage?.getItem(UNITS_STORAGE_KEY));
    } catch {
      return 'imperial';
    }
  }

  function writeUnits(value) {
    try {
      storage?.setItem(UNITS_STORAGE_KEY, value);
    } catch {
      // Storage unavailable: the choice lasts for this session only.
    }
  }

  const coordinates = (value) => `${value.lat.toFixed(3)}, ${value.lon.toFixed(3)}`;
  const pin = createPin({ viewer, overlayHost, requestRender, onActivate: () => panel?.reveal() });
  const menu = createMenu({ viewer, document: doc, onPick: (picked) => open(picked) });

  function ensurePanel() {
    if (panel) return panel;
    const rail = doc.getElementById('right-context-rail');
    if (!rail) return null;
    panel = createPanel({
      document: doc,
      rail,
      units,
      onClose: () => close(),
      onRefresh: () => {
        if (point) open(point);
      },
      onUnitsChange: (next) => setUnits(next),
    });
    return panel;
  }

  function renderReport() {
    if (!report) return;
    const view = buildReportView(report, { units, now: now() });
    panel?.render(view);
    pin.update(view.pin);
  }

  async function open(picked) {
    if (destroyed) return;
    controller?.abort();
    const request = new AbortController();
    controller = request;
    point = picked;
    report = null;
    const header = { title: coordinates(picked), coordinates: coordinates(picked) };
    pin.show(picked, LOADING_PIN);
    ensurePanel()?.showLoading(header);
    try {
      const params = new URLSearchParams({ lat: picked.lat.toFixed(4), lon: picked.lon.toFixed(4) });
      const response = await fetchImpl(`${REPORT_ENDPOINT}?${params}`, { signal: request.signal });
      const body = await response.json().catch(() => null);
      if (controller !== request) return;
      if (!response.ok || !body || body.error) throw new Error(body?.error || 'Weather report unavailable');
      report = body;
      renderReport();
    } catch (error) {
      if (request.signal.aborted || controller !== request) return;
      panel?.showError(error?.message || 'Weather report unavailable', header);
      pin.update(UNAVAILABLE_PIN);
    } finally {
      if (controller === request) controller = null;
    }
  }

  function setUnits(next) {
    units = normalizeUnits(next);
    writeUnits(units);
    panel?.setUnits(units);
    renderReport();
  }

  function close() {
    controller?.abort();
    controller = null;
    point = null;
    report = null;
    pin.clear();
    panel?.destroy();
    panel = null;
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    close();
    menu.destroy();
    pin.destroy();
  }

  return { open, close, setUnits, getUnits: () => units, destroy };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/weatherReport/index.test.mjs`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/weatherReport/index.js src/weatherReport/index.test.mjs
git commit -m "feat(weather-report): orchestrate pick, pin, request and panel"
```

---

### Task 8: App wiring, credits, docs, package boundaries and CI parity

**Files:**
- Modify:
  - `src/standalone/tools.js`, `src/data/dataCredits.js`
  - `DATA_SOURCES.md`, `CHANGELOG.md`
  - `package.json` (`exports`), `scripts/package-boundaries.json`, `scripts/format-scope.json`

**Interfaces:**
- Consumes:
  - Task 7: `createWeatherReport({ viewer, overlayHost, document, storage, requestRender })`, returning `{ destroy }`.
  - Task 2: `weatherReportProxy()`, already registered.
  - In `src/standalone/tools.js`, `viewer` is destructured from `scene` (line 24), `defer` registers teardown, and `governorRequestRender` is already imported from `../renderGovernor.js`.
  - `src/overlays/worldOverlay.js` exports `setOverlayEntries`, `setOverlaySourceVisible` and `clearOverlaySource`. The controls phase has already initialised the overlay host by the time tools run.
- Produces: the right-click weather report in the running app, documented credits, package boundary groups, and a green CI-parity run.

- [ ] **Step 1: Wire the weather report into the standalone tools**

In `src/standalone/tools.js`, add these imports directly after `import { startStandaloneChrome } from './startupChrome.js';`:

```js
import { createWeatherReport } from '../weatherReport/index.js';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
```

Directly after the block

```js
  defer(() => {
    if (window.__gevAnnotations === annotations) delete window.__gevAnnotations;
    annotations.destroy();
  });
```

add:

```js
  // Right-click weather report (fork). The world overlay host was initialised in the controls phase.
  const weatherReport = createWeatherReport({
    viewer,
    overlayHost: {
      setEntries: setOverlayEntries,
      setVisible: setOverlaySourceVisible,
      clearSource: clearOverlaySource,
    },
    document,
    storage: {
      getItem: (key) => window.localStorage.getItem(key),
      setItem: (key, value) => window.localStorage.setItem(key, value),
    },
    requestRender: governorRequestRender,
  });
  defer(() => weatherReport.destroy());
```

`governorRequestRender` is a no-op until `installRenderGovernor(viewer)` runs a few lines later, which is fine: the first right-click happens after startup.

- [ ] **Step 2: Credits**

In `src/data/dataCredits.js`, replace the existing `open-meteo` entry:

```js
  {
    key: 'open-meteo',
    html:
      'Cockpit current conditions: ' +
      '<a href="https://open-meteo.com/en/licence" target="_blank" rel="noopener">Weather data by Open-Meteo.com</a> ' +
      '(CC BY 4.0)',
  },
```

with:

```js
  {
    key: 'open-meteo',
    html:
      'Cockpit current conditions and weather report marine, solar and surface: ' +
      '<a href="https://open-meteo.com/en/licence" target="_blank" rel="noopener">Weather data by Open-Meteo.com</a> ' +
      '(CC BY 4.0)',
  },
  {
    key: 'google-weather',
    html: 'Weather report: Source: Includes weather data from Google',
  },
```

- [ ] **Step 3: Documentation**

In `DATA_SOURCES.md`, in the live-sources table, directly after the `**Open-Meteo**` row add:

```markdown
| **Google Maps Platform Weather API** (current conditions, hourly and daily forecast) | Right-click weather report: now, next 48 hours, 10 days, sunrise and sunset | Google Maps Platform Terms and Weather API policies (your own key and billing); data is kept in server memory only, never persisted | "Source: Includes weather data from Google", always visible in the weather report panel and on its pin card |
| **Open-Meteo Marine API** and Open-Meteo Forecast (radiation, soil temperature) | Right-click weather report: waves, swell, sea surface temperature, solar radiation and surface temperature | [CC BY 4.0 data licence](https://open-meteo.com/en/licence) | "Marine, solar and surface: Weather data by Open-Meteo.com (CC BY 4.0)" in the weather report panel footer |
```

At the top of `CHANGELOG.md`, directly under `# Changelog` and its blank line, add:

```markdown
## Right-click weather report (fork)

- Right-click the globe and choose **Weather report here** to pin the spot and open a WEATHER
  panel in the right rail: current conditions, the next 48 hours, 10 days, marine conditions,
  and solar and surface readings.
- Served by a new `/api/weather-report` proxy that combines Google Weather API (with a Google
  Maps key) and Open-Meteo, cached in memory for ten minutes, with a stale report kept for an hour
  if every source fails.
- °F/°C switch remembered per browser; Google and Open-Meteo credits always visible in the panel.

```

- [ ] **Step 4: Package exports and boundary groups**

In `package.json` `exports`:
- directly after the `"./server/providers/weather-radar": { "node": "./server/providers/weather-radar.js" },` entry add:

```json
    "./server/providers/weather-report": {
      "node": "./server/providers/weather-report.js"
    },
```

- directly after `"./layers/weather-radar": "./src/layers/weather-radar/index.js",` add:

```json
    "./weather-report": "./src/weatherReport/index.js",
```

In `scripts/package-boundaries.json`:
- directly after the `"weather-radar-provider"` group add:

```json
  "weather-report-provider": {
    "runtime": "node",
    "exports": ["./server/providers/weather-report"],
    "modules": [
      "server/providers/weather-report.js",
      "server/providers/weather-report/normalize.js",
      "server/providers/places/google-key.js",
      "scripts/google-server-key.mjs",
      "server/providers/regional/place.js",
      "server/providers/regional/http.js",
      "src/data/regionalBrief.js",
      "server/providers/common/rate-limit.js",
      "server/providers/common/http.js"
    ],
    "external": []
  },
```

- directly after the `"weather-radar-layer"` group add:

```json
  "weather-report": {
    "exports": ["./weather-report"],
    "modules": [
      "src/weatherReport/contextMenu.js",
      "src/weatherReport/groundPick.js",
      "src/weatherReport/index.js",
      "src/weatherReport/reportModel.js",
      "src/weatherReport/reportPanel.js",
      "src/weatherReport/reportPin.js",
      "src/data/scenePick.js",
      "src/data/trackingClickGesture.js"
    ],
    "external": ["cesium"]
  },
```

- in the `"ui-styles"` group's `modules`, directly after `"src/ui/styles/provider-settings.css"` add `"src/ui/styles/weather-report.css"` (add the comma to the previous line).

Run: `npm run check:boundaries`
Expected: exit 0, with these lines among the output:

```text
Checked weather-report-provider: 1 exports, 9 owned modules.
Checked weather-report: 1 exports, 8 owned modules.
```

If it reports `imports an unowned module`, the named file is a real import. Add it to that group's `modules` only if it is a shared helper, never another layer's module, and record the addition in the report.

- [ ] **Step 5: Formatting scope**

Append these entries to the end of the JSON array in `scripts/format-scope.json`:

```json
  "server/providers/weather-report.js",
  "server/providers/weather-report/normalize.js",
  "src/data/weatherReportNormalize.test.mjs",
  "src/data/weatherReportProxy.test.mjs",
  "src/testSupport/fakeDom.mjs",
  "src/weatherReport/contextMenu.js",
  "src/weatherReport/contextMenu.test.mjs",
  "src/weatherReport/groundPick.js",
  "src/weatherReport/groundPick.test.mjs",
  "src/weatherReport/index.js",
  "src/weatherReport/index.test.mjs",
  "src/weatherReport/reportModel.js",
  "src/weatherReport/reportModel.test.mjs",
  "src/weatherReport/reportPanel.js",
  "src/weatherReport/reportPanel.test.mjs",
  "src/weatherReport/reportPin.js",
  "src/weatherReport/reportPin.test.mjs",
  "src/ui/styles/weather-report.css"
```

Run: `npm run format`, then `npm run format:check`
Expected: the check exits 0. The plan's code uses long lines, so `format` reflowing the new files (and `src/standalone/tools.js`, `src/data/dataCredits.js`, `style.css`, `src/ui/styles/layers.css`, `package.json` if they are in scope) is expected and belongs in this commit.

- [ ] **Step 6: CI parity**

Run in order, stopping at the first failure:

```bash
npm run format:check
npm run check:boundaries
npm test
npm run build
```

Expected: all four exit 0. On this machine (Node 26) `npm test` skips 6 allocation microbenchmarks, which is expected.

- [ ] **Step 7: Smoke-check the proxy once**

The worktree has no Google key, so Google reports `not-configured`; this proves the route, Open-Meteo and the place lookup without touching credentials. Start the dev server in the background with `npx vite --port 5199 --strictPort`. Do not open the app in a browser, because that would consume a limited AISStream connection. Then run:

```bash
curl -s "http://localhost:5199/api/weather-report?lat=29.3&lon=-94.8"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:5199/api/weather-report?lat=95&lon=0"
```

Expected:
- The first response is JSON with `"google":"not-configured"`, `"openMeteoMarine":"ok"`, `"openMeteoSolar":"ok"`, a non-null `marine` and `solar`, and `place` (normally `"Galveston, Texas"`, or `null` if Nominatim is slow).
- The second prints `400`.

Stop the dev server and confirm port 5199 is free.

- [ ] **Step 8: Commit**

```bash
git add src/standalone/tools.js src/data/dataCredits.js DATA_SOURCES.md CHANGELOG.md package.json scripts/package-boundaries.json scripts/format-scope.json server/providers src/data src/testSupport src/weatherReport src/ui/styles style.css
git commit -m "feat(weather-report): wire the right-click weather report, credits and boundaries"
```

Check `git status` first: the `git add` paths are directories, so stage only files this plan created or changed, plus the formatting reflow.
