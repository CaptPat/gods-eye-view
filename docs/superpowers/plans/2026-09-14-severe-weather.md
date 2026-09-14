# Severe Weather Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Severe Weather" on/off data layer in Cyclops View. It shows National Weather Service active alerts over their US zones and GDACS cyclones, floods, droughts, volcanoes and wildfires worldwide. A click on an area or event pins a card that links to the full report.

**Architecture:**
- **Proxy:** a Vite provider plugin (`server/providers/severe-weather.js`, pure helpers in `server/providers/severe-weather/`). It fetches NWS active alerts, resolves each alert's forecast/county/fire zone shapes (simplified, cached on disk for 7 days), and fetches the GDACS event list plus cyclone tracks and cones. It serves one merged JSON body with per-source status and stale serving.
- **Layer:** a data layer (`src/layers/severe-weather/`). It draws ground-clamped Cesium entities, publishes one selected world-overlay card following the FIRMS pattern, and registers the selection in the context store. `src/data/severeWeather.js` injects the application services.

**Tech Stack:** Node ≥ 24 Vite provider plugins, CesiumJS 1.138 (`CustomDataSource`, ground polygons and polylines, `ScreenSpaceEventHandler`), the shared world-overlay host, `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-14-severe-weather-design.md`

## Global Constraints

- Fork-only work on `CaptPat/gods-eye-view`. Never open upstream PRs or issues, and never contact the upstream repo. `gh pr create` defaults to the parent repository, so do not use it.
- Commit trailer, exactly, whatever model implements: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Shared files.** Sub-projects 3 (tides and currents) and 4 (weather overlays) merge before this plan, so they may have inserted lines near the anchors named here. Insert at the named anchor and keep sorted lists sorted. The layer-registry count test is "raise the expected count by one from its current value" (18 at `6462f0a`, higher once 3 and 4 have merged). Never overwrite their lines.
- **Layer identity.** Id `severe-weather`, name `Severe Weather`, icon `⚠️`, source `NWS · GDACS`, `updateInterval: 300000`. Share token `v`, disposition `enabled-only`, no option group and no row chips. Registered in `src/app/data.js` directly after `earthquakesLayer`.
- **Route:** `GET /api/severe-weather`. Upstreams, exactly:
  - `https://api.weather.gov/alerts/active` (`Accept: application/geo+json`);
  - `https://api.weather.gov/zones/{forecast|county|fire}/{ID}`, zone keys matching `^(forecast|county|fire)/[A-Z]{2}[CZ]\d{3}$`;
  - `https://www.gdacs.org/gdacsapi/api/events/geteventlist/EVENTS4APP`;
  - `https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP?eventtype=TC`, fetched only when the list has a TC event.
- **Upstream etiquette.**
  - `User-Agent: CyclopsView/0.1 (+https://github.com/CaptPat/gods-eye-view)` on every upstream request.
  - Zone concurrency 4; a 429 or 503 stops the rest of the round (60 s back-off); zone resolution deadline 30 s; a 404 zone is remembered for 1 h.
  - Timeout 20 s; caps 8 MB for alerts, 4 MB per zone, 6 MB for GDACS.
- **Cadence and cache.**
  - NWS is fresh for 5 min and GDACS for 15 min. A failed source is served `stale` for up to 60 min after its last success, then `unavailable`. Both unavailable: 502 `{ error: 'Severe weather sources unavailable' }`.
  - Zone shapes live at `.gev-cache/severe-weather/zones/<type>_<ID>.json` for 7 days (mtime), and an age prune runs at most hourly (the lesson from the radar cache).
  - Proxy limiter: 30 requests per minute per client, 120 overall; 429 with `Retry-After: 10`.
- **Geometry.** Douglas–Peucker at 0.01°; coordinates rounded to 4 decimals; rings with fewer than 4 positions dropped. Render budget: 150,000 NWS positions, keeping the highest-ranked areas.
- **Filters.** NWS keeps only `status === 'Actual'`. GDACS keeps TC, FL, DR, VO and WF with alert level `Green`, `Orange` or `Red`. Earthquakes (EQ) are excluded, because the app has a USGS layer. GDACS wind circles, buffers and burnt areas are not drawn.
- **Palettes.**
  - NWS: emergency `#ff2d95`, warning `#ff3b30`, watch `#ff9500`, advisory `#ffcc00`, statement `#5ac8fa`.
  - GDACS: Green `#34c759`, Orange `#ff9500`, Red `#ff3b30`.
  - Fill alpha 0.22 for NWS and 0.14 for cones. Outline width 2, cone outline 1.5, track 3. Points 11 px; when selected, 15 px with a white outline and lines white and 2 px wider.
- **Card copy.** Every line is at most 44 characters, clamped with `…`.
  - NWS lines: `<severity> · <urgency> · <certainty>`; `Sep 15 12:00 – Sep 19 16:00 UTC−8` (onset else effective, to ends else expires, in the offset NWS wrote, with U+2212); area description; headline; `+N more: …`; `Open weather.gov forecast`. The link is `https://forecast.weather.gov/MapClick.php?lat=<4dp>&lon=<4dp>`.
  - GDACS lines: `<Level> alert · <Type>`; `Nov 21, 2025 – Sep 14, 2026 UTC`; country; `Open GDACS report`.
- **Row text** (exact, checked through `LayerPanel._buildMetaText`):
  - `NWS 6 · GDACS 6 · 2m ago`
  - `NWS 6 · GDACS unavailable · 2m ago` (stats `degraded: true`, never `error`: one source down is not a failed refresh)
  - `STALE · NWS 6 (stale) · GDACS 6 · 2m ago`
  - `NWS 6 (2 unmapped, 1 hidden) · GDACS 6 · 2m ago`
  - `STALE · NWS 6 · GDACS 6 · Severe weather refresh failed`
  - `UNAVAILABLE · NWS · GDACS · Severe weather sources unavailable`
  - `NWS · GDACS · never`
- **Credits** (HTML exactly):
  - `US weather alerts: <a href="https://www.weather.gov/" target="_blank" rel="noopener">National Weather Service</a> (NOAA, public domain)`
  - `Global disaster alerts: <a href="https://www.gdacs.org/" target="_blank" rel="noopener">GDACS</a>, European Commission JRC and UN OCHA (indicative, not official warnings)`
- **Render governor** (weather-radar lesson). Cyclops View idles in Cesium `requestRenderMode`.
  - Every scene mutation the manager does not drive (rebuilds after async fetches, selection highlights, visibility, clear) calls the injected `requestRender(reason)`. `src/data/severeWeather.js` passes `governorRequestRender`, so `src/layers/severe-weather/*` imports only `cesium`.
  - Ground primitives build only during rendered frames, so after a rebuild or highlight a bounded ready pump requests a frame every 250 ms, at most 40 times, while `dataSourceDisplay.getBoundingSphere` reports `PENDING`.
- **Status strings** (radar lesson). Check row text against `layerPanel._buildMetaText`, not only `getStats()`:
  - `loading: true` with no `loadingLabel` appends `loading...`;
  - `error` prefixes the STALE or UNAVAILABLE label;
  - `lastUpdate` appends `· Nm ago`.
- **Manager contract** (radar lesson). `update() === false` means a failed enable or refresh, and refresh failures are read from `stats.error`. `update()` resolves `false` only when the manager's own signal aborted.
- **Disable releases everything** (Dams lesson 2026-09-13). A hidden data source still costs a visualizer walk every frame, so `disable()` removes every entity, the card, the pick owner and the data.
- **Right rail and Escape** (weather-report lessons). This layer adds no DOM panel and no key handler, so the right-rail checklist does not apply. The card is canvas-painted and keyboard-reachable through the world overlay's accessible mirror (`activate`). If a later change adds focused UI that handles Escape, Enter or Space, it must call `stopPropagation()`.
- **Boundaries** (upstream-sync lesson). `src/app/*` sits in the `application-components` boundary group, which must list every module it imports transitively: `src/data/severeWeather.js` and the four `src/layers/severe-weather/*.js` modules. Node groups use `"runtime": "node"`.
- **Tests.** Colocated `*.test.mjs`, `node:test` plus `node:assert/strict`, no live network. Use real `cesium` constructors with hand-built fake viewers.
- **Fixtures.** Recorded 2026-09-14 and already present, uncommitted, in the working tree under `src/data/fixtures/severe-weather/`, with a README. Task 1 commits them. Do not re-record.
- **Formatting.** Every code block below is already Prettier-formatted, so `npm run format` in Task 8 should leave the new files unchanged.
- **CI parity** before the final commit: `npm run format:check`, `npm run check:boundaries`, `npm test`, `npm run build`. On Node 26, `npm test` skips the allocation microbenchmarks (7 skipped), which is expected.

## File Structure

| File | Responsibility |
|---|---|
| `server/providers/severe-weather/geometry.js` | Position cleaning, Douglas–Peucker ring and geometry simplification |
| `server/providers/severe-weather/nws.js` | NWS URLs, zone keys, active-alert normalization |
| `server/providers/severe-weather/gdacs.js` | GDACS URLs, event normalization, cyclone track and cone shapes |
| `server/providers/severe-weather.js` | Route handler: source cadence, stale serving, zone memory and disk cache, prune, limiter, plugin |
| `server/providers/local.js` | Register and re-export the plugin |
| `src/layers/severe-weather/model.js` | Pure: payload parsing, NWS areas and ranks, budget, time formatting, cards, row stats |
| `src/layers/severe-weather/rendering.js` | Cesium entities, highlight, rebuild signature, ready pump |
| `src/layers/severe-weather/selection.js` | Click handling, selected overlay card, context store, pick ownership |
| `src/layers/severe-weather/index.js` | Layer lifecycle and refresh |
| `src/data/severeWeather.js` | Application services, credits and the default instance |
| `src/data/dataCredits.js` | `NWS_ALERTS_CREDIT`, `GDACS_CREDIT` |
| `src/data/layerState.js`, `src/app/data.js` | Registry token `v`; registration |
| `package.json`, `scripts/package-boundaries.json`, `scripts/format-scope.json`, `DATA_SOURCES.md`, `CHANGELOG.md` | Exports, boundaries, formatting scope, docs |

---

### Task 1: Geometry simplification and NWS alert normalization

**Files:**
- Create: `server/providers/severe-weather/geometry.js`, `server/providers/severe-weather/nws.js`
- Commit (already recorded): `src/data/fixtures/severe-weather/` (`README.md`, `nws-alerts-active.json`, `nws-zones.json`, `gdacs-events4app.json`, `gdacs-map-tc.json`)
- Test: `src/data/severeWeatherNws.test.mjs`

**Interfaces:**
- Produces:
  - `geometry.js`:
    - `SIMPLIFY_TOLERANCE_DEG = 0.01`;
    - `cleanPositions(positions) → [[lon, lat], ...]`;
    - `simplifyRing(ring, tolerance?) → ring | null`;
    - `simplifyGeometry(geometry, tolerance?) → [[outer, ...holes], ...]`;
    - `countPositions(polygons) → number`.
  - `nws.js`:
    - `NWS_ALERTS_URL`, `NWS_ZONE_URL_PREFIX`;
    - `isZoneKey(key) → boolean`;
    - `zoneKeyFromUrl(url) → 'forecast/AKZ844' | null`;
    - `zoneUrl(key) → string`;
    - `normalizeNwsAlerts(json) → { updatedAt: number | null, alerts: Alert[] } | null`.
  - `Alert = { id, event, headline, severity, urgency, certainty, onset, ends, expires, areaDesc, senderName, zones: string[], polygons: Polygon[] | null }`. Times are the NWS ISO strings (with offset) or `null`; `zones` is `[]` whenever `polygons` is set.

- [ ] **Step 1: Confirm the fixtures are present**

Run: `git status --short src/data/fixtures/severe-weather`
Expected: `?? src/data/fixtures/severe-weather/`, holding `README.md`, `gdacs-events4app.json`, `gdacs-map-tc.json`, `nws-alerts-active.json` and `nws-zones.json`.

- [ ] **Step 2: Write the failing test**

```js
// src/data/severeWeatherNws.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SIMPLIFY_TOLERANCE_DEG,
  countPositions,
  simplifyGeometry,
  simplifyRing,
} from '../../server/providers/severe-weather/geometry.js';
import {
  isZoneKey,
  normalizeNwsAlerts,
  zoneKeyFromUrl,
  zoneUrl,
} from '../../server/providers/severe-weather/nws.js';

const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`./fixtures/severe-weather/${name}`, import.meta.url),
      'utf8',
    ),
  );

test('zone keys come only from api.weather.gov forecast, county and fire zone URLs', () => {
  assert.equal(
    zoneKeyFromUrl('https://api.weather.gov/zones/forecast/AKZ844'),
    'forecast/AKZ844',
  );
  assert.equal(
    zoneKeyFromUrl('https://api.weather.gov/zones/county/MDC031'),
    'county/MDC031',
  );
  assert.equal(
    zoneKeyFromUrl('https://api.weather.gov/zones/fire/NEZ434'),
    'fire/NEZ434',
  );
  for (const bad of [
    'https://api.weather.gov/zones/forecast/../x',
    'https://evil.example/zones/forecast/AKZ844',
    'https://api.weather.gov/zones/offshore/AKZ844',
    'https://api.weather.gov/zones/forecast/akz844',
    null,
  ]) {
    assert.equal(zoneKeyFromUrl(bad), null, String(bad));
  }
  assert.equal(isZoneKey('fire/NEZ434'), true);
  assert.equal(isZoneKey('fire/NEZ434/x'), false);
  assert.equal(
    zoneUrl('forecast/AKZ844'),
    'https://api.weather.gov/zones/forecast/AKZ844',
  );
});

test('rings are simplified within the tolerance, rounded to 4 decimals, and stay closed', () => {
  assert.equal(SIMPLIFY_TOLERANCE_DEG, 0.01);
  const ring = [
    [0, 0],
    [0.5, 0.004],
    [1, 0],
    [1, 1],
    [0.5, 1.3],
    [0, 1],
    [0.000001, 0.0000004],
    [0, 0],
  ];
  assert.deepEqual(
    simplifyRing(ring),
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0.5, 1.3],
      [0, 1],
      [0, 0],
    ],
    'a 0.004° bump goes, a 0.3° bump stays',
  );
  assert.deepEqual(
    simplifyRing([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]),
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ],
    'an open ring is closed',
  );
  assert.equal(
    simplifyRing([
      [0, 0],
      [0.001, 0],
      [0, 0.001],
      [0, 0],
    ]),
    null,
    'a sliver below the tolerance collapses',
  );
  assert.equal(
    simplifyRing([
      [0, 0],
      [1, 0],
      [0, 0],
    ]),
    null,
  );
  assert.deepEqual(
    simplifyRing([
      [10.123456, 20.987654],
      [11, 20],
      [11, 21],
      [10.123456, 20.987654],
    ])[0],
    [10.1235, 20.9877],
  );
});

test('real zone geometry shrinks under simplification and every ring stays valid', () => {
  const zones = fixture('nws-zones.json');
  let raw = 0;
  let simplified = 0;
  for (const [key, zone] of Object.entries(zones)) {
    const polygons = simplifyGeometry(zone.geometry);
    assert.ok(polygons.length > 0, key);
    for (const polygon of polygons) {
      for (const ring of polygon) {
        assert.ok(ring.length >= 4, key);
        assert.deepEqual(ring[0], ring.at(-1), `${key} ring closed`);
        for (const [lon, lat] of ring) {
          assert.equal(lon, Math.round(lon * 1e4) / 1e4);
          assert.equal(lat, Math.round(lat * 1e4) / 1e4);
        }
      }
    }
    raw += zone.geometry.coordinates.flat().length;
    simplified += countPositions(polygons);
  }
  assert.equal(raw, 605);
  assert.ok(simplified < raw, `${simplified} < ${raw}`);
  const akz843 = zones['forecast/AKZ843'].geometry;
  assert.deepEqual(
    simplifyGeometry({
      type: 'GeometryCollection',
      geometries: [akz843, { type: 'Point', coordinates: [0, 0] }],
    }),
    simplifyGeometry(akz843),
  );
  assert.deepEqual(
    simplifyGeometry({
      type: 'MultiPolygon',
      coordinates: [akz843.coordinates],
    }),
    simplifyGeometry(akz843),
  );
  assert.deepEqual(simplifyGeometry(null), []);
});

test('active alerts keep Actual messages with their own polygons or zone keys', () => {
  const result = normalizeNwsAlerts(fixture('nws-alerts-active.json'));
  assert.equal(result.updatedAt, Date.parse('2026-09-14T16:05:29+00:00'));
  assert.deepEqual(
    result.alerts.map((alert) => alert.event),
    [
      'Flood Watch',
      'Dense Fog Advisory',
      'Wind Advisory',
      'Special Weather Statement',
      'Red Flag Warning',
      'Heat Advisory',
    ],
    'the Test Message is dropped',
  );
  assert.deepEqual(result.alerts[0], {
    id: 'urn:oid:2.49.0.1.840.0.72c6ec33bfeaa6b7c7b00e6f14f58fc54f222fe4.001.1',
    event: 'Flood Watch',
    headline:
      'Flood Watch issued September 13 at 1:21PM AKDT until September 19 at 4:00PM AKDT by NWS Fairbanks AK',
    severity: 'Severe',
    urgency: 'Future',
    certainty: 'Possible',
    onset: '2026-09-15T12:00:00-08:00',
    ends: '2026-09-19T16:00:00-08:00',
    expires: '2026-09-14T16:00:00-08:00',
    areaDesc: 'Two Rivers; Fairbanks Metro Area',
    senderName: 'NWS Fairbanks AK',
    zones: ['forecast/AKZ843', 'forecast/AKZ844'],
    polygons: null,
  });
  const statement = result.alerts[3];
  assert.deepEqual(
    statement.zones,
    [],
    'an alert with its own polygon needs no zones',
  );
  assert.equal(statement.polygons.length, 1);
  assert.equal(statement.ends, null);
  assert.deepEqual(result.alerts[4].zones, [
    'fire/NEZ434',
    'fire/NEZ435',
    'fire/NEZ436',
  ]);
  assert.equal(normalizeNwsAlerts({}), null);
  assert.deepEqual(
    normalizeNwsAlerts({
      features: [
        {
          properties: {
            status: 'Actual',
            id: 'x',
            event: 'Tornado Warning',
            severity: 'Apocalyptic',
            onset: 'soon',
            affectedZones: ['https://api.weather.gov/zones/forecast/../../x'],
          },
        },
      ],
    }).alerts[0],
    {
      id: 'x',
      event: 'Tornado Warning',
      headline: null,
      severity: 'Unknown',
      urgency: 'Unknown',
      certainty: 'Unknown',
      onset: null,
      ends: null,
      expires: null,
      areaDesc: null,
      senderName: null,
      zones: [],
      polygons: null,
    },
  );
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test src/data/severeWeatherNws.test.mjs`
Expected: FAIL with `Cannot find module` for `server/providers/severe-weather/geometry.js`.

- [ ] **Step 4: Write the geometry helpers**

```js
// server/providers/severe-weather/geometry.js
/** 0.01° (~1.1 km): 613,743 raw zone positions became 32,853 (measured 2026-09-14). */
export const SIMPLIFY_TOLERANCE_DEG = 0.01;

const roundCoordinate = (value) => Math.round(value * 10_000) / 10_000;

function validPosition(position) {
  return (
    Array.isArray(position) &&
    Number.isFinite(position[0]) &&
    Number.isFinite(position[1]) &&
    Math.abs(position[0]) <= 180 &&
    Math.abs(position[1]) <= 90
  );
}

/** Round to 4 decimals and drop invalid or repeated positions. */
export function cleanPositions(positions) {
  if (!Array.isArray(positions)) return [];
  const out = [];
  for (const position of positions) {
    if (!validPosition(position)) continue;
    const next = [roundCoordinate(position[0]), roundCoordinate(position[1])];
    const last = out.at(-1);
    if (last && last[0] === next[0] && last[1] === next[1]) continue;
    out.push(next);
  }
  return out;
}

/** Douglas–Peucker on one ring; the result is closed, or null when it collapses. */
export function simplifyRing(ring, tolerance = SIMPLIFY_TOLERANCE_DEG) {
  const points = cleanPositions(ring);
  if (points.length < 4) return null;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const toleranceSq = tolerance * tolerance;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop();
    const [ax, ay] = points[start];
    const [bx, by] = points[end];
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    let farthest = -1;
    let farthestSq = toleranceSq;
    for (let i = start + 1; i < end; i += 1) {
      const [px, py] = points[i];
      const t = lengthSq
        ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq))
        : 0;
      const ex = ax + t * dx - px;
      const ey = ay + t * dy - py;
      const distanceSq = ex * ex + ey * ey;
      if (distanceSq > farthestSq) {
        farthestSq = distanceSq;
        farthest = i;
      }
    }
    if (farthest >= 0) {
      keep[farthest] = 1;
      stack.push([start, farthest], [farthest, end]);
    }
  }
  const simplified = points.filter((_, index) => keep[index]);
  const first = simplified[0];
  const last = simplified.at(-1);
  if (first[0] !== last[0] || first[1] !== last[1])
    simplified.push([first[0], first[1]]);
  return simplified.length >= 4 ? simplified : null;
}

function polygonCoordinates(geometry) {
  if (!geometry || typeof geometry !== 'object') return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') {
    return Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
  }
  if (geometry.type === 'GeometryCollection') {
    return (
      Array.isArray(geometry.geometries) ? geometry.geometries : []
    ).flatMap(polygonCoordinates);
  }
  return [];
}

/** Polygon, MultiPolygon or GeometryCollection → `[[outer, ...holes], ...]`, simplified. */
export function simplifyGeometry(geometry, tolerance = SIMPLIFY_TOLERANCE_DEG) {
  const polygons = [];
  for (const polygon of polygonCoordinates(geometry)) {
    if (!Array.isArray(polygon)) continue;
    const outer = simplifyRing(polygon[0], tolerance);
    if (!outer) continue;
    const holes = polygon
      .slice(1)
      .map((ring) => simplifyRing(ring, tolerance))
      .filter(Boolean);
    polygons.push([outer, ...holes]);
  }
  return polygons;
}

export function countPositions(polygons) {
  let count = 0;
  for (const polygon of polygons)
    for (const ring of polygon) count += ring.length;
  return count;
}
```

- [ ] **Step 5: Write the NWS normalizer**

```js
// server/providers/severe-weather/nws.js
import { simplifyGeometry } from './geometry.js';

export const NWS_ALERTS_URL = 'https://api.weather.gov/alerts/active';
export const NWS_ZONE_URL_PREFIX = 'https://api.weather.gov/zones/';
const ZONE_KEY = /^(forecast|county|fire)\/[A-Z]{2}[CZ]\d{3}$/;
const SEVERITIES = Object.freeze([
  'Extreme',
  'Severe',
  'Moderate',
  'Minor',
  'Unknown',
]);
const URGENCIES = Object.freeze([
  'Immediate',
  'Expected',
  'Future',
  'Past',
  'Unknown',
]);
const CERTAINTIES = Object.freeze([
  'Observed',
  'Likely',
  'Possible',
  'Unlikely',
  'Unknown',
]);
const ISO_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/;

export function isZoneKey(key) {
  return ZONE_KEY.test(String(key ?? ''));
}

/** `https://api.weather.gov/zones/forecast/AKZ844` → `forecast/AKZ844`; anything else → null. */
export function zoneKeyFromUrl(url) {
  const text = String(url ?? '');
  if (!text.startsWith(NWS_ZONE_URL_PREFIX)) return null;
  const key = text.slice(NWS_ZONE_URL_PREFIX.length);
  return isZoneKey(key) ? key : null;
}

export function zoneUrl(key) {
  return `${NWS_ZONE_URL_PREFIX}${key}`;
}

const cleanText = (value, max = 400) => {
  const text =
    typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return text ? text.slice(0, max) : null;
};
const oneOf = (values, value) => (values.includes(value) ? value : 'Unknown');
/** Keep the NWS string as written: its offset is the alert area's local time. */
const isoTime = (value) =>
  typeof value === 'string' &&
  ISO_WITH_OFFSET.test(value) &&
  Number.isFinite(Date.parse(value))
    ? value
    : null;

/** Active alerts → `Actual` messages with their own simplified polygons, or the zone keys to resolve. */
export function normalizeNwsAlerts(json) {
  if (!json || !Array.isArray(json.features)) return null;
  const updatedAt = Date.parse(json.updated);
  const seen = new Set();
  const alerts = [];
  for (const feature of json.features) {
    const p = feature?.properties;
    if (!p || p.status !== 'Actual') continue;
    const id = cleanText(p.id, 200);
    const event = cleanText(p.event, 80);
    if (!id || !event || seen.has(id)) continue;
    seen.add(id);
    const polygons = feature.geometry ? simplifyGeometry(feature.geometry) : [];
    const zones = polygons.length
      ? []
      : [
          ...new Set(
            (Array.isArray(p.affectedZones) ? p.affectedZones : [])
              .map(zoneKeyFromUrl)
              .filter(Boolean),
          ),
        ];
    alerts.push({
      id,
      event,
      headline: cleanText(p.headline),
      severity: oneOf(SEVERITIES, p.severity),
      urgency: oneOf(URGENCIES, p.urgency),
      certainty: oneOf(CERTAINTIES, p.certainty),
      onset: isoTime(p.onset) ?? isoTime(p.effective),
      ends: isoTime(p.ends),
      expires: isoTime(p.expires),
      areaDesc: cleanText(p.areaDesc),
      senderName: cleanText(p.senderName, 120),
      zones,
      polygons: polygons.length ? polygons : null,
    });
  }
  return { updatedAt: Number.isFinite(updatedAt) ? updatedAt : null, alerts };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test src/data/severeWeatherNws.test.mjs`
Expected: PASS, 4 tests.

- [ ] **Step 7: Commit**

```bash
git add src/data/fixtures/severe-weather server/providers/severe-weather/geometry.js server/providers/severe-weather/nws.js src/data/severeWeatherNws.test.mjs
git commit -m "feat(severe-weather): zone simplification and NWS alert normalization" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: GDACS event and cyclone normalization

**Files:**
- Create: `server/providers/severe-weather/gdacs.js`
- Test: `src/data/severeWeatherGdacs.test.mjs`

**Interfaces:**
- Consumes: `cleanPositions`, `simplifyGeometry` (Task 1).
- Produces:
  - `GDACS_EVENTS_URL`, `GDACS_CYCLONES_URL`;
  - `GDACS_EVENT_TYPES = { TC: 'Tropical cyclone', FL: 'Flood', DR: 'Drought', VO: 'Volcano', WF: 'Wildfire' }`;
  - `parseGdacsDate(text) → ms | null` (UTC);
  - `normalizeGdacsEvents(json) → GdacsEvent[] | null`;
  - `joinTrackSegments(segments) → lines`;
  - `normalizeGdacsCycloneShapes(json) → Map<eventId, { track, cone }>`;
  - `attachCycloneShapes(events, shapes) → GdacsEvent[]`.
  - `GdacsEvent = { id: 'TC-1001321', type, typeName, eventId, name, alertLevel, country, fromDate, toDate, lon, lat, reportUrl, track: Line[], cone: Polygon[] }`.

- [ ] **Step 1: Write the failing test**

```js
// src/data/severeWeatherGdacs.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GDACS_CYCLONES_URL,
  GDACS_EVENTS_URL,
  attachCycloneShapes,
  joinTrackSegments,
  normalizeGdacsCycloneShapes,
  normalizeGdacsEvents,
  parseGdacsDate,
} from '../../server/providers/severe-weather/gdacs.js';

const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`./fixtures/severe-weather/${name}`, import.meta.url),
      'utf8',
    ),
  );

test('the GDACS endpoints are the app event list and the cyclone map', () => {
  assert.equal(
    GDACS_EVENTS_URL,
    'https://www.gdacs.org/gdacsapi/api/events/geteventlist/EVENTS4APP',
  );
  assert.equal(
    GDACS_CYCLONES_URL,
    'https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP?eventtype=TC',
  );
  assert.equal(
    parseGdacsDate('2026-09-14T14:38:32'),
    Date.UTC(2026, 8, 14, 14, 38, 32),
  );
  assert.equal(parseGdacsDate('2026-09-14'), null);
  assert.equal(parseGdacsDate(null), null);
});

test('GDACS events exclude earthquakes and carry UTC dates, alert level and the report link', () => {
  const events = normalizeGdacsEvents(fixture('gdacs-events4app.json'));
  assert.deepEqual(
    events.map((event) => event.id),
    [
      'TC-1001320',
      'TC-1001321',
      'FL-1103888',
      'DR-1023877',
      'DR-1018431',
      'WF-1031964',
    ],
  );
  assert.deepEqual(events[4], {
    id: 'DR-1018431',
    type: 'DR',
    typeName: 'Drought',
    eventId: 1018431,
    name: 'Drought in Madagascar',
    alertLevel: 'Orange',
    country: 'Madagascar',
    fromDate: Date.UTC(2025, 10, 21),
    toDate: Date.UTC(2026, 8, 14, 14, 38, 32),
    lon: 47.017,
    lat: -19.34,
    reportUrl:
      'https://www.gdacs.org/report.aspx?eventid=1018431&episodeid=14&eventtype=DR',
    track: [],
    cone: [],
  });
  assert.equal(events[0].country, null, 'an off-shore cyclone has no country');
  assert.equal(normalizeGdacsEvents({ features: 'x' }), null);
  const odd = normalizeGdacsEvents({
    features: [
      {
        geometry: { type: 'Point', coordinates: [1, 2] },
        properties: {
          eventtype: 'VO',
          eventid: 7,
          name: 'Etna',
          alertlevel: 'Purple',
        },
      },
      {
        geometry: { type: 'Point', coordinates: [1, 2] },
        properties: {
          eventtype: 'VO',
          eventid: 8,
          name: 'Etna',
          alertlevel: 'Red',
          fromdate: '2026-09-14',
          url: { report: 'https://evil.example/report' },
        },
      },
      {
        geometry: { type: 'Point', coordinates: [500, 2] },
        properties: { eventtype: 'FL', eventid: 9, alertlevel: 'Red' },
      },
    ],
  });
  assert.deepEqual(
    odd.map((event) => [event.id, event.fromDate, event.reportUrl]),
    [['VO-8', null, null]],
  );
});

test('cyclone tracks are joined across out-of-order segments and cones are simplified', () => {
  const shapes = normalizeGdacsCycloneShapes(fixture('gdacs-map-tc.json'));
  assert.deepEqual([...shapes.keys()], [1001321]);
  const { track, cone } = shapes.get(1001321);
  assert.equal(track.length, 1, 'ten segments form one line');
  assert.equal(track[0].length, 11);
  assert.deepEqual(track[0][0], [-117.2, 17.2]);
  assert.deepEqual(track[0].at(-1), [-137, 15.2]);
  assert.equal(cone.length, 1);
  assert.ok(
    cone[0][0].length >= 4 && cone[0][0].length < 210,
    `${cone[0][0].length} cone positions`,
  );
  assert.deepEqual(
    joinTrackSegments([
      [
        [0, 0],
        [1, 1],
      ],
      [
        [5, 5],
        [6, 6],
      ],
      [
        [-1, -1],
        [0, 0],
      ],
    ]),
    [
      [
        [-1, -1],
        [0, 0],
        [1, 1],
      ],
      [
        [5, 5],
        [6, 6],
      ],
    ],
  );
  const events = attachCycloneShapes(
    normalizeGdacsEvents(fixture('gdacs-events4app.json')),
    shapes,
  );
  assert.equal(events[1].track.length, 1);
  assert.equal(events[1].cone.length, 1);
  assert.deepEqual(
    events[0].track,
    [],
    'NORBERT has no shapes in this fixture',
  );
  assert.equal(normalizeGdacsCycloneShapes(null).size, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/data/severeWeatherGdacs.test.mjs`
Expected: FAIL with `Cannot find module` for `server/providers/severe-weather/gdacs.js`.

- [ ] **Step 3: Write the implementation**

```js
// server/providers/severe-weather/gdacs.js
import { cleanPositions, simplifyGeometry } from './geometry.js';

export const GDACS_EVENTS_URL =
  'https://www.gdacs.org/gdacsapi/api/events/geteventlist/EVENTS4APP';
export const GDACS_CYCLONES_URL =
  'https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP?eventtype=TC';
/** Earthquakes (EQ) are deliberately absent: the app already has a USGS Earthquakes layer. */
export const GDACS_EVENT_TYPES = Object.freeze({
  TC: 'Tropical cyclone',
  FL: 'Flood',
  DR: 'Drought',
  VO: 'Volcano',
  WF: 'Wildfire',
});
const ALERT_LEVELS = Object.freeze(['Green', 'Orange', 'Red']);
const REPORT_URL =
  /^https:\/\/www\.gdacs\.org\/report\.aspx\?eventid=\d+&episodeid=\d+&eventtype=[A-Z]{2}$/;
const GDACS_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

/** GDACS list dates carry no offset; they are UTC. */
export function parseGdacsDate(value) {
  if (typeof value !== 'string' || !GDACS_DATE.test(value)) return null;
  const ms = Date.parse(`${value}Z`);
  return Number.isFinite(ms) ? ms : null;
}

const cleanText = (value, max = 160) => {
  const text =
    typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return text ? text.slice(0, max) : null;
};

/** EVENTS4APP → point events of the kept types, with the GDACS report link. */
export function normalizeGdacsEvents(json) {
  if (!json || !Array.isArray(json.features)) return null;
  const seen = new Set();
  const events = [];
  for (const feature of json.features) {
    const p = feature?.properties;
    const type = p?.eventtype;
    if (
      !Object.hasOwn(GDACS_EVENT_TYPES, type) ||
      !ALERT_LEVELS.includes(p.alertlevel)
    )
      continue;
    const eventId = Number(p.eventid);
    const [position] =
      feature.geometry?.type === 'Point'
        ? cleanPositions([feature.geometry.coordinates])
        : [];
    if (!Number.isSafeInteger(eventId) || !position) continue;
    const id = `${type}-${eventId}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const report = p.url?.report;
    events.push({
      id,
      type,
      typeName: GDACS_EVENT_TYPES[type],
      eventId,
      name: cleanText(p.name) ?? GDACS_EVENT_TYPES[type],
      alertLevel: p.alertlevel,
      country: cleanText(p.country),
      fromDate: parseGdacsDate(p.fromdate),
      toDate: parseGdacsDate(p.todate),
      lon: position[0],
      lat: position[1],
      reportUrl:
        typeof report === 'string' && REPORT_URL.test(report) ? report : null,
      track: [],
      cone: [],
    });
  }
  return events;
}

const sameNode = (a, b) => a[0] === b[0] && a[1] === b[1];

/** Join track segments that share endpoints; GDACS lists them out of order. */
export function joinTrackSegments(segments) {
  const pending = segments
    .map(cleanPositions)
    .filter((segment) => segment.length >= 2);
  const tracks = [];
  while (pending.length) {
    const track = pending.shift();
    let extended = true;
    while (extended) {
      extended = false;
      for (let i = 0; i < pending.length; i += 1) {
        const segment = pending[i];
        if (sameNode(track.at(-1), segment[0])) track.push(...segment.slice(1));
        else if (sameNode(segment.at(-1), track[0]))
          track.unshift(...segment.slice(0, -1));
        else continue;
        pending.splice(i, 1);
        extended = true;
        break;
      }
    }
    tracks.push(track);
  }
  return tracks;
}

/** MAP?eventtype=TC → per event id: the joined track lines and the simplified forecast cone. */
export function normalizeGdacsCycloneShapes(json) {
  const byEvent = new Map();
  if (!json || !Array.isArray(json.features)) return byEvent;
  for (const feature of json.features) {
    const p = feature?.properties;
    const eventId = Number(p?.eventid);
    if (p?.eventtype !== 'TC' || !Number.isSafeInteger(eventId)) continue;
    const entry = byEvent.get(eventId) ?? { segments: [], cone: [] };
    byEvent.set(eventId, entry);
    const line = /^Line_Line_(\d+)$/.exec(String(p.Class ?? ''));
    if (line && feature.geometry?.type === 'LineString') {
      entry.segments.push({
        index: Number(line[1]),
        coordinates: feature.geometry.coordinates,
      });
    } else if (p.Class === 'Poly_Cones') {
      entry.cone.push(...simplifyGeometry(feature.geometry));
    }
  }
  const shapes = new Map();
  for (const [eventId, entry] of byEvent) {
    const ordered = entry.segments
      .sort((a, b) => a.index - b.index)
      .map((segment) => segment.coordinates);
    const track = joinTrackSegments(ordered);
    if (track.length || entry.cone.length)
      shapes.set(eventId, { track, cone: entry.cone });
  }
  return shapes;
}

export function attachCycloneShapes(events, shapes) {
  return events.map((event) => {
    const shape = event.type === 'TC' ? shapes.get(event.eventId) : null;
    return shape ? { ...event, track: shape.track, cone: shape.cone } : event;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/data/severeWeatherGdacs.test.mjs`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add server/providers/severe-weather/gdacs.js src/data/severeWeatherGdacs.test.mjs
git commit -m "feat(severe-weather): GDACS events with cyclone tracks and cones" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Severe weather proxy, zone cache and plugin

**Files:**
- Create: `server/providers/severe-weather.js`
- Modify: `server/providers/local.js` (import, plugin entry, re-export)
- Test: `src/data/severeWeatherProxy.test.mjs`

**Interfaces:**
- Consumes:
  - Tasks 1 and 2;
  - `makeRateLimiter`, `clientKey` (`server/providers/common/rate-limit.js`);
  - `coalesceProxyRequest(inFlight, key, create) → { promise }` and `readResponseJsonCapped(response, maxBytes)` (`server/providers/common/http.js`).
- Produces:
  - `createSevereWeatherHandler({ fetchImpl, cacheDir, now, limiter, log, zoneConcurrency, zoneDeadlineMs }) → async (req, res)`, mounted at `/api/severe-weather` (the path must be `/`);
  - `severeWeatherProxy(options) → { name: 'severe-weather-proxy', configureServer, configurePreviewServer }`;
  - the exported constants `NWS_TTL_MS`, `GDACS_TTL_MS`, `STALE_MAX_MS`, `ZONE_TTL_MS`, `ZONE_BACKOFF_MS` and the rest.
  - Body: `{ generatedAt, nws: { status, updatedAt, alerts, zones: { [zoneKey]: Polygon[] }, unmappedAlerts }, gdacs: { status, updatedAt, events } }`, with `status` one of `ok`, `stale` or `unavailable`.

- [ ] **Step 1: Write the failing test**

```js
// src/data/severeWeatherProxy.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import createViteConfig from '../../vite.config.js';
import {
  GDACS_TTL_MS,
  NWS_TTL_MS,
  STALE_MAX_MS,
  ZONE_BACKOFF_MS,
  ZONE_TTL_MS,
  createSevereWeatherHandler,
} from '../../server/providers/severe-weather.js';

const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`./fixtures/severe-weather/${name}`, import.meta.url),
      'utf8',
    ),
  );
const ALERTS = fixture('nws-alerts-active.json');
const ZONES = fixture('nws-zones.json');
const EVENTS = fixture('gdacs-events4app.json');
const CYCLONES = fixture('gdacs-map-tc.json');
const ZONE_PREFIX = 'https://api.weather.gov/zones/';
const MINUTE = 60_000;

async function tempDir(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gev-severe-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** Answers every upstream from fixtures; `overrides` maps a URL substring to a Response factory. */
function upstream(overrides = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const href = String(url);
    calls.push({ href, headers: init?.headers ?? {} });
    for (const [match, answer] of Object.entries(overrides)) {
      if (href.includes(match)) return answer(href);
    }
    if (href === 'https://api.weather.gov/alerts/active')
      return Response.json(ALERTS);
    if (href.startsWith(ZONE_PREFIX)) {
      const zone = ZONES[href.slice(ZONE_PREFIX.length)];
      return zone ? Response.json(zone) : new Response('{}', { status: 404 });
    }
    if (href.endsWith('/EVENTS4APP')) return Response.json(EVENTS);
    if (href.endsWith('/MAP?eventtype=TC')) return Response.json(CYCLONES);
    throw new Error(`unexpected upstream ${href}`);
  };
  const count = (match) =>
    calls.filter((call) => call.href.includes(match)).length;
  return { fetchImpl, calls, count };
}

function invoke(handler, url = '/', method = 'GET') {
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
        resolve({
          status: this.status,
          headers: this.headers,
          json: () => JSON.parse(String(body)),
        });
      },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

function makeHandler(net, cacheDir, clock, extra = {}) {
  return createSevereWeatherHandler({
    fetchImpl: net.fetchImpl,
    cacheDir,
    now: () => clock.now,
    limiter: () => true,
    log: () => {},
    ...extra,
  });
}

test('one request merges NWS alerts with resolved zone shapes and GDACS events with cyclone shapes', async (t) => {
  const cacheDir = await tempDir(t);
  const net = upstream();
  const clock = { now: Date.now() };
  const response = await invoke(makeHandler(net, cacheDir, clock));
  assert.equal(response.status, 200);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  const body = response.json();
  assert.equal(body.generatedAt, clock.now);
  assert.equal(body.nws.status, 'ok');
  assert.equal(body.nws.updatedAt, Date.parse('2026-09-14T16:05:29+00:00'));
  assert.equal(body.nws.alerts.length, 6);
  assert.deepEqual(
    Object.keys(body.nws.zones).sort(),
    Object.keys(ZONES).sort(),
  );
  assert.equal(body.nws.unmappedAlerts, 0);
  assert.equal(
    net.count('/zones/county/MDC031'),
    0,
    "the Test Message's zone is never fetched",
  );
  assert.equal(net.count(ZONE_PREFIX), 9);
  for (const call of net.calls) {
    assert.equal(
      call.headers['User-Agent'],
      'CyclopsView/0.1 (+https://github.com/CaptPat/gods-eye-view)',
    );
  }
  assert.equal(body.gdacs.status, 'ok');
  assert.deepEqual(
    body.gdacs.events.map((event) => event.id),
    [
      'TC-1001320',
      'TC-1001321',
      'FL-1103888',
      'DR-1023877',
      'DR-1018431',
      'WF-1031964',
    ],
  );
  assert.equal(body.gdacs.events[1].track[0].length, 11);
  assert.equal((await readdir(path.join(cacheDir, 'zones'))).length, 9);
});

test('sources refresh on their own cadence; zone shapes come from memory, then disk, until 7 days old', async (t) => {
  const cacheDir = await tempDir(t);
  const net = upstream();
  const clock = { now: Date.now() };
  const handler = makeHandler(net, cacheDir, clock);
  await invoke(handler);
  await invoke(handler);
  assert.equal(
    net.count('/alerts/active'),
    1,
    'a second request inside five minutes reuses the snapshot',
  );

  clock.now += NWS_TTL_MS;
  await invoke(handler);
  assert.equal(net.count('/alerts/active'), 2);
  assert.equal(net.count('/EVENTS4APP'), 1, 'GDACS refreshes every 15 minutes');
  assert.equal(net.count(ZONE_PREFIX), 9, 'zone shapes are not refetched');
  clock.now += GDACS_TTL_MS;
  await invoke(handler);
  assert.equal(net.count('/EVENTS4APP'), 2);

  const coldNet = upstream();
  const cold = makeHandler(coldNet, cacheDir, clock);
  assert.equal(Object.keys((await invoke(cold)).json().nws.zones).length, 9);
  assert.equal(
    coldNet.count(ZONE_PREFIX),
    0,
    'a restarted proxy reads zone shapes from disk',
  );

  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * MINUTE);
  await utimes(
    path.join(cacheDir, 'zones', 'forecast_AKZ844.json'),
    eightDaysAgo,
    eightDaysAgo,
  );
  const agedNet = upstream();
  await invoke(makeHandler(agedNet, cacheDir, clock));
  assert.equal(agedNet.count(ZONE_PREFIX), 1);
  assert.equal(
    agedNet.count('/zones/forecast/AKZ844'),
    1,
    'only the expired shape is refetched',
  );
  assert.ok(ZONE_TTL_MS === 7 * 24 * 60 * MINUTE);
});

test('the zone cache prunes shapes older than 7 days on the first refresh', async (t) => {
  const cacheDir = await tempDir(t);
  await mkdir(path.join(cacheDir, 'zones'), { recursive: true });
  const old = path.join(cacheDir, 'zones', 'forecast_XXZ999.json');
  await writeFile(old, '[]');
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * MINUTE);
  await utimes(old, eightDaysAgo, eightDaysAgo);
  await invoke(makeHandler(upstream(), cacheDir, { now: Date.now() }));
  const names = await readdir(path.join(cacheDir, 'zones'));
  assert.equal(names.includes('forecast_XXZ999.json'), false);
  assert.equal(names.length, 9);
});

test('a 429 on a zone backs off the remaining zones and reports unmapped alerts until it clears', async (t) => {
  const cacheDir = await tempDir(t);
  let throttled = true;
  const net = upstream({
    '/zones/forecast/AKZ830': () =>
      throttled
        ? new Response('slow down', { status: 429 })
        : Response.json(ZONES['forecast/AKZ830']),
  });
  const clock = { now: Date.now() };
  const handler = makeHandler(net, cacheDir, clock, { zoneConcurrency: 1 });
  const first = (await invoke(handler)).json();
  assert.equal(
    net.count(ZONE_PREFIX),
    3,
    'AKZ843, AKZ844, then the throttled AKZ830 stops the queue',
  );
  assert.deepEqual(Object.keys(first.nws.zones).sort(), [
    'forecast/AKZ843',
    'forecast/AKZ844',
  ]);
  assert.equal(
    first.nws.unmappedAlerts,
    3,
    'Wind Advisory, Red Flag Warning and Heat Advisory have no shape yet',
  );
  assert.ok(
    ZONE_BACKOFF_MS < NWS_TTL_MS,
    'the backoff ends the round; the next refresh retries',
  );

  throttled = false;
  clock.now += NWS_TTL_MS;
  const later = (await invoke(handler)).json();
  assert.equal(later.nws.unmappedAlerts, 0);
  assert.equal(Object.keys(later.nws.zones).length, 9);
});

test('zone resolution stops at its deadline and leaves the rest for the next refresh', async (t) => {
  const net = upstream();
  const body = (
    await invoke(
      makeHandler(
        net,
        await tempDir(t),
        { now: Date.now() },
        { zoneDeadlineMs: 0 },
      ),
    )
  ).json();
  assert.equal(net.count(ZONE_PREFIX), 0);
  assert.deepEqual(body.nws.zones, {});
  assert.equal(
    body.nws.unmappedAlerts,
    5,
    'only the Special Weather Statement carries its own polygon',
  );
});

test('a failed source is served stale for an hour, then unavailable; both unavailable is 502', async (t) => {
  let nwsUp = true;
  let gdacsUp = true;
  const net = upstream({
    '/alerts/active': () =>
      nwsUp ? Response.json(ALERTS) : new Response('down', { status: 503 }),
    '/EVENTS4APP': () =>
      gdacsUp ? Response.json(EVENTS) : new Response('down', { status: 500 }),
  });
  const clock = { now: Date.now() };
  const handler = makeHandler(net, await tempDir(t), clock);
  await invoke(handler);

  nwsUp = false;
  clock.now += NWS_TTL_MS;
  const stale = (await invoke(handler)).json();
  assert.equal(stale.nws.status, 'stale');
  assert.equal(stale.nws.alerts.length, 6);
  assert.equal(stale.gdacs.status, 'ok');

  clock.now += STALE_MAX_MS;
  const expired = (await invoke(handler)).json();
  assert.equal(expired.nws.status, 'unavailable');
  assert.deepEqual(expired.nws.alerts, []);
  assert.equal(
    expired.gdacs.status,
    'ok',
    'GDACS refreshed on its own cadence',
  );

  gdacsUp = false;
  const cold = makeHandler(net, await tempDir(t), clock);
  const failed = await invoke(cold);
  assert.equal(failed.status, 502);
  assert.deepEqual(failed.json(), {
    error: 'Severe weather sources unavailable',
  });
});

test('GDACS events survive a cyclone-map failure without shapes', async (t) => {
  const net = upstream({
    '/MAP?eventtype=TC': () => new Response('down', { status: 500 }),
  });
  const body = (
    await invoke(makeHandler(net, await tempDir(t), { now: Date.now() }))
  ).json();
  assert.equal(body.gdacs.status, 'ok');
  assert.equal(body.gdacs.events.length, 6);
  assert.deepEqual(body.gdacs.events[1].track, []);
});

test('methods, paths, rate limits and plugin registration', async (t) => {
  const cacheDir = await tempDir(t);
  const handler = makeHandler(upstream(), cacheDir, { now: Date.now() });
  assert.equal((await invoke(handler, '/', 'POST')).status, 405);
  assert.equal((await invoke(handler, '/zones')).status, 404);
  const limited = createSevereWeatherHandler({
    fetchImpl: upstream().fetchImpl,
    cacheDir,
    limiter: () => false,
    log: () => {},
  });
  const refused = await invoke(limited);
  assert.equal(refused.status, 429);
  assert.equal(refused.headers['Retry-After'], '10');

  const plugin = createViteConfig({ mode: 'test' }).plugins.find(
    (p) => p.name === 'severe-weather-proxy',
  );
  assert.ok(plugin, 'severe-weather-proxy must be registered');
  const routes = new Map();
  plugin.configureServer({
    middlewares: { use: (route, fn) => routes.set(route, fn) },
  });
  assert.equal(typeof routes.get('/api/severe-weather'), 'function');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/data/severeWeatherProxy.test.mjs`
Expected: FAIL with `Cannot find module` for `server/providers/severe-weather.js`.

- [ ] **Step 3: Write the handler and plugin**

```js
// server/providers/severe-weather.js
import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { clientKey, makeRateLimiter } from './common/rate-limit.js';
import { coalesceProxyRequest, readResponseJsonCapped } from './common/http.js';
import { simplifyGeometry } from './severe-weather/geometry.js';
import {
  NWS_ALERTS_URL,
  normalizeNwsAlerts,
  zoneUrl,
} from './severe-weather/nws.js';
import {
  GDACS_CYCLONES_URL,
  GDACS_EVENTS_URL,
  attachCycloneShapes,
  normalizeGdacsCycloneShapes,
  normalizeGdacsEvents,
} from './severe-weather/gdacs.js';

export const SEVERE_WEATHER_CACHE_DIR = path.join(
  process.cwd(),
  '.gev-cache',
  'severe-weather',
);
export const NWS_TTL_MS = 5 * 60_000;
export const GDACS_TTL_MS = 15 * 60_000;
export const STALE_MAX_MS = 60 * 60_000;
export const ZONE_TTL_MS = 7 * 24 * 60 * 60_000;
export const ZONE_PRUNE_INTERVAL_MS = 60 * 60_000;
export const ZONE_BACKOFF_MS = 60_000;
export const ZONE_MISSING_TTL_MS = 60 * 60_000;
export const ZONE_CONCURRENCY = 4;
export const ZONE_DEADLINE_MS = 30_000;
export const UPSTREAM_TIMEOUT_MS = 20_000;
export const MAX_ALERTS_BYTES = 8 * 1024 * 1024;
export const MAX_ZONE_BYTES = 4 * 1024 * 1024;
export const MAX_GDACS_BYTES = 6 * 1024 * 1024;
const USER_AGENT =
  'CyclopsView/0.1 (+https://github.com/CaptPat/gods-eye-view)';
const UNAVAILABLE_ERROR = 'Severe weather sources unavailable';

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

export function createSevereWeatherHandler({
  fetchImpl = (...args) => fetch(...args),
  cacheDir = SEVERE_WEATHER_CACHE_DIR,
  now = Date.now,
  limiter = makeRateLimiter({ windowMs: 60_000, max: 30, globalMax: 120 }),
  log = (message) => console.warn(message),
  zoneConcurrency = ZONE_CONCURRENCY,
  zoneDeadlineMs = ZONE_DEADLINE_MS,
} = {}) {
  const inFlight = new Map();
  /** zone key → { polygons, fetchedAt } */
  const zoneMemory = new Map();
  const zoneMissingUntil = new Map();
  let zoneBackoffUntil = 0;
  let lastZonePruneAt = Number.NEGATIVE_INFINITY;
  const sources = {
    nws: {
      data: null,
      fetchedAt: null,
      checkedAt: Number.NEGATIVE_INFINITY,
      stale: false,
    },
    gdacs: {
      data: null,
      fetchedAt: null,
      checkedAt: Number.NEGATIVE_INFINITY,
      stale: false,
    },
  };

  async function fetchJson(url, maxBytes, accept) {
    const response = await fetchImpl(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: accept },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!response.ok) {
      void response.body?.cancel?.().catch(() => {});
      throw Object.assign(new Error(`upstream HTTP ${response.status}`), {
        status: response.status,
      });
    }
    return readResponseJsonCapped(response, maxBytes);
  }

  const zoneDir = () => path.join(cacheDir, 'zones');
  const zoneFile = (key) =>
    path.join(zoneDir(), `${key.replace('/', '_')}.json`);

  async function readZoneFromDisk(key) {
    try {
      const info = await stat(zoneFile(key));
      if (now() - info.mtimeMs > ZONE_TTL_MS) return null;
      const polygons = JSON.parse(await readFile(zoneFile(key), 'utf8'));
      return Array.isArray(polygons)
        ? { polygons, fetchedAt: info.mtimeMs }
        : null;
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
      throw error;
    }
  }

  async function fetchZone(key) {
    const zone = await fetchJson(
      zoneUrl(key),
      MAX_ZONE_BYTES,
      'application/geo+json',
    );
    const polygons = simplifyGeometry(zone?.geometry);
    await mkdir(zoneDir(), { recursive: true });
    await writeFile(zoneFile(key), JSON.stringify(polygons));
    return { polygons, fetchedAt: now() };
  }

  /** Memory, then disk, then api.weather.gov at `zoneConcurrency`, until the deadline or a 429/503. */
  async function resolveZones(keys) {
    const deadline = now() + zoneDeadlineMs;
    const queue = [];
    for (const key of keys) {
      const cached = zoneMemory.get(key);
      if (cached && now() - cached.fetchedAt <= ZONE_TTL_MS) continue;
      if ((zoneMissingUntil.get(key) ?? 0) > now()) continue;
      const fromDisk = await readZoneFromDisk(key);
      if (fromDisk) zoneMemory.set(key, fromDisk);
      else queue.push(key);
    }
    const worker = async () => {
      while (queue.length) {
        if (now() >= deadline || zoneBackoffUntil > now()) return;
        const key = queue.shift();
        try {
          zoneMemory.set(key, await fetchZone(key));
        } catch (error) {
          if (error.status === 404)
            zoneMissingUntil.set(key, now() + ZONE_MISSING_TTL_MS);
          if (error.status === 429 || error.status === 503)
            zoneBackoffUntil = now() + ZONE_BACKOFF_MS;
          log(`[severe-weather] zone ${key} failed: ${error.message}`);
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.max(1, zoneConcurrency) }, worker),
    );
  }

  /** At most hourly: forget and delete zone shapes older than ZONE_TTL_MS. */
  async function pruneZones() {
    if (now() - lastZonePruneAt < ZONE_PRUNE_INTERVAL_MS) return;
    lastZonePruneAt = now();
    for (const [key, entry] of zoneMemory) {
      if (now() - entry.fetchedAt > ZONE_TTL_MS) zoneMemory.delete(key);
    }
    let names = [];
    try {
      names = await readdir(zoneDir());
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    await Promise.all(
      names.map(async (name) => {
        const file = path.join(zoneDir(), name);
        try {
          const info = await stat(file);
          if (now() - info.mtimeMs > ZONE_TTL_MS)
            await rm(file, { force: true });
        } catch {
          // Another prune removed it first.
        }
      }),
    );
  }

  async function buildNws() {
    const normalized = normalizeNwsAlerts(
      await fetchJson(NWS_ALERTS_URL, MAX_ALERTS_BYTES, 'application/geo+json'),
    );
    if (!normalized) throw new Error('malformed NWS alerts');
    await resolveZones([
      ...new Set(normalized.alerts.flatMap((alert) => alert.zones)),
    ]);
    await pruneZones();
    const zones = {};
    let unmappedAlerts = 0;
    for (const alert of normalized.alerts) {
      let mapped = Boolean(alert.polygons);
      for (const key of alert.zones) {
        const entry = zoneMemory.get(key);
        if (!entry?.polygons.length) continue;
        zones[key] = entry.polygons;
        mapped = true;
      }
      if (!mapped) unmappedAlerts += 1;
    }
    return {
      updatedAt: normalized.updatedAt,
      alerts: normalized.alerts,
      zones,
      unmappedAlerts,
    };
  }

  async function buildGdacs() {
    const events = normalizeGdacsEvents(
      await fetchJson(GDACS_EVENTS_URL, MAX_GDACS_BYTES, 'application/json'),
    );
    if (!events) throw new Error('malformed GDACS events');
    if (!events.some((event) => event.type === 'TC'))
      return { updatedAt: now(), events };
    try {
      const shapes = normalizeGdacsCycloneShapes(
        await fetchJson(
          GDACS_CYCLONES_URL,
          MAX_GDACS_BYTES,
          'application/json',
        ),
      );
      return { updatedAt: now(), events: attachCycloneShapes(events, shapes) };
    } catch (error) {
      log(`[severe-weather] GDACS cyclone shapes failed: ${error.message}`);
      return { updatedAt: now(), events };
    }
  }

  /** Refresh one source at most once per TTL; keep the last good data as stale for STALE_MAX_MS. */
  async function refresh(name, ttlMs, build) {
    const state = sources[name];
    if (now() - state.checkedAt < ttlMs) return;
    try {
      const { promise } = coalesceProxyRequest(inFlight, name, build);
      state.data = await promise;
      state.fetchedAt = now();
      state.stale = false;
    } catch (error) {
      log(`[severe-weather] ${name} refresh failed: ${error.message}`);
      if (state.data && now() - state.fetchedAt <= STALE_MAX_MS) {
        state.stale = true;
      } else {
        state.data = null;
        state.fetchedAt = null;
        state.stale = false;
      }
    }
    state.checkedAt = now();
  }

  const statusOf = (state) =>
    !state.data ? 'unavailable' : state.stale ? 'stale' : 'ok';

  return async function handle(req, res) {
    try {
      if (req.method !== 'GET')
        return sendJson(res, 405, { error: 'method not allowed' });
      const url = new URL(req.url || '/', 'http://severe-weather.local');
      if (url.pathname !== '/')
        return sendJson(res, 404, { error: 'not found' });
      if (!limiter(clientKey(req))) {
        return sendJson(
          res,
          429,
          { error: 'rate limited' },
          { 'Retry-After': '10' },
        );
      }
      await Promise.all([
        refresh('nws', NWS_TTL_MS, buildNws),
        refresh('gdacs', GDACS_TTL_MS, buildGdacs),
      ]);
      const nws = sources.nws.data
        ? { status: statusOf(sources.nws), ...sources.nws.data }
        : {
            status: 'unavailable',
            updatedAt: null,
            alerts: [],
            zones: {},
            unmappedAlerts: 0,
          };
      const gdacs = sources.gdacs.data
        ? { status: statusOf(sources.gdacs), ...sources.gdacs.data }
        : { status: 'unavailable', updatedAt: null, events: [] };
      if (nws.status === 'unavailable' && gdacs.status === 'unavailable') {
        return sendJson(res, 502, { error: UNAVAILABLE_ERROR });
      }
      return sendJson(res, 200, { generatedAt: now(), nws, gdacs });
    } catch (error) {
      log(`[severe-weather] ${error?.message ?? error}`);
      return sendJson(res, 502, { error: UNAVAILABLE_ERROR });
    }
  };
}

export function severeWeatherProxy(options = {}) {
  const handler = createSevereWeatherHandler(options);
  const install = (server) => {
    server.middlewares.use('/api/severe-weather', handler);
  };
  return {
    name: 'severe-weather-proxy',
    configureServer: install,
    configurePreviewServer: install,
  };
}
```

- [ ] **Step 4: Register the plugin in `server/providers/local.js`**

Directly after `import { weatherReportProxy } from './weather-report.js';` add:

```js
import { severeWeatherProxy } from './severe-weather.js';
```

In `localProviderPlugins()`, directly before `    cctvProxy({ sourceRoot: defaultSourceRoot }),` add the line below. This keeps `keySetupEndpoint()` last.

```js
    severeWeatherProxy(),
```

Directly before the `export {` block that begins with `  CCTV_FRAME_FETCH_TIMEOUT_MS,` add:

```js
export {
  createSevereWeatherHandler,
  severeWeatherProxy,
} from './severe-weather.js';

```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test src/data/severeWeatherProxy.test.mjs src/data/severeWeatherNws.test.mjs src/data/severeWeatherGdacs.test.mjs`
Expected: PASS, 15 tests.

- [ ] **Step 6: Commit**

```bash
git add server/providers/severe-weather.js server/providers/local.js src/data/severeWeatherProxy.test.mjs
git commit -m "feat(severe-weather): caching proxy with zone shapes and stale serving" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Layer model — areas, cards and row status

**Files:**
- Create: `src/layers/severe-weather/model.js`
- Test: `src/layers/severe-weather/model.test.mjs`

**Interfaces:**
- Consumes:
  - `LayerPanel`, `layerFeedState` from `src/ui/layerPanel.js` (test only);
  - the proxy normalizers from Tasks 1 and 2 (test only, to build a realistic payload from the fixtures).
- Produces:
  - Constants: `SEVERE_WEATHER_LAYER_ID`, `SEVERE_WEATHER_OVERLAY_SOURCE_ID` (both `'severe-weather'`), `CARD_LINE_MAX = 44`, `MAX_RENDER_POSITIONS = 150000`, `NWS_CATEGORY_COLORS`, `GDACS_ALERT_COLORS`.
  - Ranking and parsing:
    - `nwsCategory(event)`, `nwsAlertRank(alert)`, `clampLine(text, max?)`;
    - `parseSevereWeatherPayload(body) → { nws: { status, alerts, zones, unmappedAlerts }, gdacs: { status, events } } | null`.
  - Areas:
    - `buildNwsAreas(nws) → Area[]`, where `Area = { key: 'zone:forecast/AKZ844' | 'alert:<id>', polygons, alerts (ranked), color }`, sorted lowest rank first;
    - `countAreaPositions(area)`;
    - `capAreasToBudget(areas, budget?) → { areas, dropped }`.
  - Formatting:
    - `formatAlertTime(iso) → { text, offset } | null`;
    - `formatAlertWindow(alert) → string | null`;
    - `formatGdacsDates(event) → string | null`;
    - `forecastPageUrl(lat, lon)`.
  - Cards: `buildNwsCard(area, { lat, lon })` and `buildGdacsCard(event)`, each returning `{ title, details, accent, link, source, label, properties }`.
  - `buildStats({ payload, lastUpdate, error, droppedAreas }) → stats`.

- [ ] **Step 1: Write the failing test**

```js
// src/layers/severe-weather/model.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LayerPanel, layerFeedState } from '../../ui/layerPanel.js';
import { simplifyGeometry } from '../../../server/providers/severe-weather/geometry.js';
import { normalizeNwsAlerts } from '../../../server/providers/severe-weather/nws.js';
import {
  attachCycloneShapes,
  normalizeGdacsCycloneShapes,
  normalizeGdacsEvents,
} from '../../../server/providers/severe-weather/gdacs.js';
import {
  CARD_LINE_MAX,
  GDACS_ALERT_COLORS,
  NWS_CATEGORY_COLORS,
  buildGdacsCard,
  buildNwsAreas,
  buildNwsCard,
  buildStats,
  capAreasToBudget,
  clampLine,
  forecastPageUrl,
  formatAlertTime,
  formatAlertWindow,
  formatGdacsDates,
  nwsAlertRank,
  nwsCategory,
  parseSevereWeatherPayload,
} from './model.js';

const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../../data/fixtures/severe-weather/${name}`, import.meta.url),
      'utf8',
    ),
  );

/** The proxy body for the recorded fixtures, built with the proxy's own normalizers. */
function fixturePayload() {
  const nws = normalizeNwsAlerts(fixture('nws-alerts-active.json'));
  const zones = Object.fromEntries(
    Object.entries(fixture('nws-zones.json')).map(([key, zone]) => [
      key,
      simplifyGeometry(zone.geometry),
    ]),
  );
  const events = attachCycloneShapes(
    normalizeGdacsEvents(fixture('gdacs-events4app.json')),
    normalizeGdacsCycloneShapes(fixture('gdacs-map-tc.json')),
  );
  return {
    generatedAt: 1,
    nws: {
      status: 'ok',
      updatedAt: nws.updatedAt,
      alerts: nws.alerts,
      zones,
      unmappedAlerts: 0,
    },
    gdacs: { status: 'ok', updatedAt: 1, events },
  };
}

const panel = { _timeAgo: LayerPanel.prototype._timeAgo };
const rowText = (stats) =>
  LayerPanel.prototype._buildMetaText.call(panel, {
    stats,
    enabled: true,
    lifecycleState: 'enabled',
    source: 'NWS · GDACS',
  });

test('NWS events map to warning, watch, advisory, statement and emergency colours and ranks', () => {
  assert.equal(nwsCategory('Tornado Warning'), 'warning');
  assert.equal(nwsCategory('Flood Watch'), 'watch');
  assert.equal(nwsCategory('Heat Advisory'), 'advisory');
  assert.equal(nwsCategory('Special Weather Statement'), 'statement');
  assert.equal(nwsCategory('Hydrologic Outlook'), 'statement');
  assert.equal(nwsCategory('Civil Emergency Message'), 'emergency');
  assert.deepEqual(NWS_CATEGORY_COLORS, {
    emergency: '#ff2d95',
    warning: '#ff3b30',
    watch: '#ff9500',
    advisory: '#ffcc00',
    statement: '#5ac8fa',
  });
  assert.deepEqual(GDACS_ALERT_COLORS, {
    Green: '#34c759',
    Orange: '#ff9500',
    Red: '#ff3b30',
  });
  assert.equal(nwsAlertRank({ event: 'Flood Watch', severity: 'Severe' }), 33);
  assert.ok(
    nwsAlertRank({ event: 'Red Flag Warning', severity: 'Minor' }) >
      nwsAlertRank({ event: 'Flood Watch', severity: 'Extreme' }),
  );
});

test('the payload parser keeps usable alerts and events and defaults missing shapes', () => {
  assert.equal(parseSevereWeatherPayload(null), null);
  assert.equal(parseSevereWeatherPayload({ nws: { alerts: [] } }), null);
  const parsed = parseSevereWeatherPayload({
    nws: {
      status: 'weird',
      alerts: [{ id: 'a', event: 'Heat Advisory' }, { id: 7 }],
      zones: null,
      unmappedAlerts: 2,
    },
    gdacs: {
      status: 'stale',
      events: [
        { id: 'FL-1', lon: 1, lat: 2 },
        { id: 'FL-2', lon: 'x', lat: 2 },
      ],
    },
  });
  assert.deepEqual(parsed, {
    nws: {
      status: 'unavailable',
      alerts: [{ id: 'a', event: 'Heat Advisory' }],
      zones: {},
      unmappedAlerts: 2,
    },
    gdacs: {
      status: 'stale',
      events: [{ id: 'FL-1', lon: 1, lat: 2, track: [], cone: [] }],
    },
  });
});

test('a zone shared by several alerts is one area coloured by its highest-ranked alert', () => {
  const payload = parseSevereWeatherPayload(fixturePayload());
  const areas = buildNwsAreas(payload.nws);
  assert.deepEqual(
    areas.map((area) => area.key),
    [
      'alert:urn:oid:2.49.0.1.840.0.a8cf6ef01a03c20165689da85615d4de7004b983.001.1',
      'zone:forecast/AKZ830',
      'zone:forecast/AKZ851',
      'zone:forecast/AKZ852',
      'zone:forecast/OKZ068',
      'zone:forecast/AKZ843',
      'zone:forecast/AKZ844',
      'zone:fire/NEZ434',
      'zone:fire/NEZ435',
      'zone:fire/NEZ436',
    ],
  );
  const fairbanks = areas.find((area) => area.key === 'zone:forecast/AKZ844');
  assert.deepEqual(
    fairbanks.alerts.map((alert) => alert.event),
    ['Flood Watch', 'Dense Fog Advisory'],
  );
  assert.equal(fairbanks.color, '#ff9500');
  assert.equal(areas[0].color, '#5ac8fa');
  assert.equal(areas.at(-1).color, '#ff3b30');
  assert.deepEqual(
    buildNwsAreas({
      alerts: [{ id: 'x', event: 'Wind Advisory', zones: ['forecast/NOPE'] }],
      zones: {},
    }),
    [],
    'a zone without a shape draws nothing',
  );
});

test('the position budget keeps the highest-ranked areas', () => {
  const square = [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ],
  ];
  const areas = ['low', 'mid', 'high'].map((key) => ({
    key,
    polygons: [square],
  }));
  assert.deepEqual(capAreasToBudget(areas, 10), {
    areas: [areas[1], areas[2]],
    dropped: 1,
  });
  assert.deepEqual(capAreasToBudget(areas, 100), { areas, dropped: 0 });
});

test('alert times read in the offset NWS wrote, from onset to the end of the hazard', () => {
  assert.deepEqual(formatAlertTime('2026-09-15T12:00:00-08:00'), {
    text: 'Sep 15 12:00',
    offset: 'UTC−8',
  });
  assert.deepEqual(formatAlertTime('2026-01-02T03:04:00+05:30'), {
    text: 'Jan 2 03:04',
    offset: 'UTC+5:30',
  });
  assert.deepEqual(formatAlertTime('2026-09-14T16:03:09+00:00'), {
    text: 'Sep 14 16:03',
    offset: 'UTC',
  });
  assert.equal(formatAlertTime('soon'), null);
  assert.equal(
    formatAlertWindow({
      onset: '2026-09-15T12:00:00-08:00',
      ends: '2026-09-19T16:00:00-08:00',
      expires: '2026-09-14T16:00:00-08:00',
    }),
    'Sep 15 12:00 – Sep 19 16:00 UTC−8',
    'ends, not the message expiry',
  );
  assert.equal(
    formatAlertWindow({
      onset: '2026-09-14T10:33:00-05:00',
      ends: null,
      expires: '2026-09-14T11:15:00-05:00',
    }),
    'Sep 14 10:33 – Sep 14 11:15 UTC−5',
  );
  assert.equal(
    formatAlertWindow({
      onset: '2026-09-14T10:33:00-05:00',
      ends: '2026-09-14T12:00:00-04:00',
    }),
    'Sep 14 10:33 UTC−5 – Sep 14 12:00 UTC−4',
  );
  assert.equal(
    formatAlertWindow({ onset: '2026-09-15T12:00:00-08:00' }),
    'From Sep 15 12:00 UTC−8',
  );
  assert.equal(
    formatAlertWindow({ expires: '2026-09-15T12:00:00-08:00' }),
    'Until Sep 15 12:00 UTC−8',
  );
  assert.equal(formatAlertWindow({}), null);
});

test('the NWS card shows event, headline, severity, urgency, certainty, times, area and the forecast link', () => {
  const areas = buildNwsAreas(parseSevereWeatherPayload(fixturePayload()).nws);
  const card = buildNwsCard(
    areas.find((area) => area.key === 'zone:forecast/AKZ844'),
    { lat: 64.8378, lon: -147.7164 },
  );
  assert.equal(card.title, 'Flood Watch');
  assert.deepEqual(card.details, [
    'Severe · Future · Possible',
    'Sep 15 12:00 – Sep 19 16:00 UTC−8',
    'Two Rivers; Fairbanks Metro Area',
    clampLine(
      'Flood Watch issued September 13 at 1:21PM AKDT until September 19 at 4:00PM AKDT by NWS Fairbanks AK',
    ),
    '+1 more: Dense Fog Advisory',
    'Open weather.gov forecast',
  ]);
  for (const line of card.details)
    assert.ok(line.length <= CARD_LINE_MAX, line);
  assert.ok(card.details[3].endsWith('…'));
  assert.equal(card.accent, '#ff9500');
  assert.equal(
    card.link,
    'https://forecast.weather.gov/MapClick.php?lat=64.8378&lon=-147.7164',
  );
  assert.equal(
    forecastPageUrl(1.5, -2),
    'https://forecast.weather.gov/MapClick.php?lat=1.5000&lon=-2.0000',
  );
  assert.equal(card.source, 'NWS');
  assert.deepEqual(card.properties.otherAlerts, ['Dense Fog Advisory']);
});

test('the GDACS card shows type, name, alert level, UTC dates and the report link', () => {
  const events = parseSevereWeatherPayload(fixturePayload()).gdacs.events;
  const card = buildGdacsCard(
    events.find((event) => event.id === 'DR-1018431'),
  );
  assert.deepEqual(card, {
    title: 'Drought in Madagascar',
    details: [
      'Orange alert · Drought',
      'Nov 21, 2025 – Sep 14, 2026 UTC',
      'Madagascar',
      'Open GDACS report',
    ],
    accent: '#ff9500',
    link: 'https://www.gdacs.org/report.aspx?eventid=1018431&episodeid=14&eventtype=DR',
    source: 'GDACS',
    label: 'Drought in Madagascar',
    properties: {
      type: 'Drought',
      alertLevel: 'Orange',
      country: 'Madagascar',
      fromDate: Date.UTC(2025, 10, 21),
      toDate: Date.UTC(2026, 8, 14, 14, 38, 32),
      reportUrl:
        'https://www.gdacs.org/report.aspx?eventid=1018431&episodeid=14&eventtype=DR',
    },
  });
  const brazil = buildGdacsCard(
    events.find((event) => event.id === 'DR-1023877'),
  );
  assert.ok(
    brazil.title.length <= CARD_LINE_MAX && brazil.details[2].endsWith('…'),
  );
  const bare = buildGdacsCard({
    ...events[0],
    reportUrl: null,
    fromDate: null,
  });
  assert.equal(bare.link, null);
  assert.equal(bare.details.includes('Open GDACS report'), false);
  assert.equal(
    formatGdacsDates({
      fromDate: Date.UTC(2026, 8, 14),
      toDate: Date.UTC(2026, 8, 14, 5),
    }),
    'Sep 14, 2026 UTC',
  );
  assert.equal(formatGdacsDates({}), null);
});

test('layer row text for every source state, as the Layers panel renders it', () => {
  const payload = parseSevereWeatherPayload(fixturePayload());
  const lastUpdate = Date.now() - 120_000;
  const ok = buildStats({ payload, lastUpdate });
  assert.deepEqual(ok, {
    status: 'ok',
    source: 'NWS 6 · GDACS 6',
    count: 12,
    lastUpdate,
  });
  assert.equal(rowText(ok), 'NWS 6 · GDACS 6 · 2m ago');
  assert.equal(layerFeedState(ok), 'nominal');

  const gdacsDown = buildStats({
    payload: { ...payload, gdacs: { status: 'unavailable', events: [] } },
    lastUpdate,
  });
  assert.equal(rowText(gdacsDown), 'NWS 6 · GDACS unavailable · 2m ago');
  assert.equal(layerFeedState(gdacsDown), 'degraded');
  assert.equal(
    gdacsDown.error,
    undefined,
    'one source down is not a failed refresh',
  );

  const nwsStale = buildStats({
    payload: { ...payload, nws: { ...payload.nws, status: 'stale' } },
    lastUpdate,
  });
  assert.equal(rowText(nwsStale), 'STALE · NWS 6 (stale) · GDACS 6 · 2m ago');

  const notes = buildStats({
    payload: { ...payload, nws: { ...payload.nws, unmappedAlerts: 2 } },
    lastUpdate,
    droppedAreas: 1,
  });
  assert.equal(
    rowText(notes),
    'NWS 6 (2 unmapped, 1 hidden) · GDACS 6 · 2m ago',
  );

  const refreshFailed = buildStats({ payload, lastUpdate, error: 'HTTP 502' });
  assert.equal(
    rowText(refreshFailed),
    'STALE · NWS 6 · GDACS 6 · Severe weather refresh failed',
  );

  const nothing = buildStats({ payload: null, error: 'HTTP 502' });
  assert.equal(
    rowText(nothing),
    'UNAVAILABLE · NWS · GDACS · Severe weather sources unavailable',
  );
  assert.equal(rowText(buildStats({ payload: null })), 'NWS · GDACS · never');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/layers/severe-weather/model.test.mjs`
Expected: FAIL with `Cannot find module` for `./model.js`.

- [ ] **Step 3: Write the implementation**

```js
// src/layers/severe-weather/model.js
export const SEVERE_WEATHER_LAYER_ID = 'severe-weather';
export const SEVERE_WEATHER_OVERLAY_SOURCE_ID = 'severe-weather';
/** Card lines stay short enough for a 400 px wide viewport. */
export const CARD_LINE_MAX = 44;
/** Upper bound on drawn NWS polygon positions; a quiet day measured 32,853. */
export const MAX_RENDER_POSITIONS = 150_000;
/** Conventional warning / watch / advisory colours. */
export const NWS_CATEGORY_COLORS = Object.freeze({
  emergency: '#ff2d95',
  warning: '#ff3b30',
  watch: '#ff9500',
  advisory: '#ffcc00',
  statement: '#5ac8fa',
});
/** GDACS alert-level colours. */
export const GDACS_ALERT_COLORS = Object.freeze({
  Green: '#34c759',
  Orange: '#ff9500',
  Red: '#ff3b30',
});
const CATEGORY_RANK = Object.freeze({
  emergency: 5,
  warning: 4,
  watch: 3,
  advisory: 2,
  statement: 1,
});
const SEVERITY_RANK = Object.freeze({
  Extreme: 4,
  Severe: 3,
  Moderate: 2,
  Minor: 1,
  Unknown: 0,
});
const SOURCE_STATUSES = Object.freeze(['ok', 'stale', 'unavailable']);
const MONTHS = Object.freeze([
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]);

export function nwsCategory(event) {
  const name = String(event ?? '');
  if (/\bEmergency\b/i.test(name)) return 'emergency';
  if (/\bWarning\b/i.test(name)) return 'warning';
  if (/\bWatch\b/i.test(name)) return 'watch';
  if (/\bAdvisory\b/i.test(name)) return 'advisory';
  return 'statement';
}

export function nwsAlertRank(alert) {
  return (
    CATEGORY_RANK[nwsCategory(alert?.event)] * 10 +
    (SEVERITY_RANK[alert?.severity] ?? 0)
  );
}

export function clampLine(value, max = CARD_LINE_MAX) {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Validate the `/api/severe-weather` body; null when it is not usable. */
export function parseSevereWeatherPayload(payload) {
  const nws = payload?.nws;
  const gdacs = payload?.gdacs;
  if (!Array.isArray(nws?.alerts) || !Array.isArray(gdacs?.events)) return null;
  const statusOf = (value) =>
    SOURCE_STATUSES.includes(value) ? value : 'unavailable';
  return {
    nws: {
      status: statusOf(nws.status),
      alerts: nws.alerts.filter(
        (alert) =>
          typeof alert?.id === 'string' && typeof alert.event === 'string',
      ),
      zones: nws.zones && typeof nws.zones === 'object' ? nws.zones : {},
      unmappedAlerts: Number.isInteger(nws.unmappedAlerts)
        ? nws.unmappedAlerts
        : 0,
    },
    gdacs: {
      status: statusOf(gdacs.status),
      events: gdacs.events
        .filter(
          (event) =>
            typeof event?.id === 'string' &&
            Number.isFinite(event.lon) &&
            Number.isFinite(event.lat),
        )
        .map((event) => ({
          ...event,
          track: Array.isArray(event.track) ? event.track : [],
          cone: Array.isArray(event.cone) ? event.cone : [],
        })),
    },
  };
}

/**
 * One drawable area per alert polygon or per forecast zone. A zone shared by
 * several alerts is drawn once, coloured by its highest-ranked alert.
 * Sorted lowest rank first, so the most severe areas are added last.
 */
export function buildNwsAreas(nws) {
  const areas = new Map();
  const add = (key, polygons, alert) => {
    if (!Array.isArray(polygons) || polygons.length === 0) return;
    const area = areas.get(key) ?? { key, polygons, alerts: [] };
    area.alerts.push(alert);
    areas.set(key, area);
  };
  for (const alert of nws.alerts) {
    if (alert.polygons) add(`alert:${alert.id}`, alert.polygons, alert);
    else
      for (const zone of alert.zones ?? [])
        add(`zone:${zone}`, nws.zones[zone], alert);
  }
  return [...areas.values()]
    .map((area) => {
      const alerts = [...area.alerts].sort(
        (a, b) =>
          nwsAlertRank(b) - nwsAlertRank(a) || a.event.localeCompare(b.event),
      );
      return {
        ...area,
        alerts,
        color: NWS_CATEGORY_COLORS[nwsCategory(alerts[0].event)],
      };
    })
    .sort(
      (a, b) =>
        nwsAlertRank(a.alerts[0]) - nwsAlertRank(b.alerts[0]) ||
        a.key.localeCompare(b.key),
    );
}

export function countAreaPositions(area) {
  let count = 0;
  for (const polygon of area.polygons)
    for (const ring of polygon) count += ring.length;
  return count;
}

/** Keep the highest-ranked areas within the position budget. */
export function capAreasToBudget(areas, budget = MAX_RENDER_POSITIONS) {
  const kept = [];
  let used = 0;
  let dropped = 0;
  for (let i = areas.length - 1; i >= 0; i -= 1) {
    const size = countAreaPositions(areas[i]);
    if (used + size > budget) {
      dropped += 1;
      continue;
    }
    used += size;
    kept.unshift(areas[i]);
  }
  return { areas: kept, dropped };
}

function formatOffset(zone) {
  if (zone === 'Z' || zone === '+00:00' || zone === '-00:00') return 'UTC';
  const sign = zone.startsWith('-') ? '−' : '+';
  const hours = Number(zone.slice(1, 3));
  const minutes = zone.slice(4, 6);
  return `UTC${sign}${hours}${minutes === '00' ? '' : `:${minutes}`}`;
}

/** `2026-09-15T12:00:00-08:00` → `{ text: 'Sep 15 12:00', offset: 'UTC−8' }`, in the offset NWS wrote. */
export function formatAlertTime(iso) {
  const match =
    /^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?(Z|[+-]\d{2}:\d{2})$/.exec(
      String(iso ?? ''),
    );
  if (!match) return null;
  const [, month, day, hour, minute, zone] = match;
  return {
    text: `${MONTHS[Number(month) - 1]} ${Number(day)} ${hour}:${minute}`,
    offset: formatOffset(zone),
  };
}

/** Onset to end of the hazard (`ends`, else the message `expires`), in the alert area's local time. */
export function formatAlertWindow(alert) {
  const start = formatAlertTime(alert?.onset);
  const end = formatAlertTime(alert?.ends ?? alert?.expires);
  if (start && end) {
    return start.offset === end.offset
      ? `${start.text} – ${end.text} ${end.offset}`
      : `${start.text} ${start.offset} – ${end.text} ${end.offset}`;
  }
  if (start) return `From ${start.text} ${start.offset}`;
  if (end) return `Until ${end.text} ${end.offset}`;
  return null;
}

/** weather.gov's point forecast page lists every active alert for that spot. */
export function forecastPageUrl(lat, lon) {
  return `https://forecast.weather.gov/MapClick.php?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;
}

export function buildNwsCard(area, { lat, lon }) {
  const [alert, ...others] = area.alerts;
  const details = [
    clampLine(`${alert.severity} · ${alert.urgency} · ${alert.certainty}`),
  ];
  const window = formatAlertWindow(alert);
  if (window) details.push(clampLine(window));
  if (alert.areaDesc) details.push(clampLine(alert.areaDesc));
  if (alert.headline) details.push(clampLine(alert.headline));
  if (others.length)
    details.push(
      clampLine(
        `+${others.length} more: ${others.map((other) => other.event).join(', ')}`,
      ),
    );
  details.push('Open weather.gov forecast');
  return {
    title: clampLine(alert.event),
    details,
    accent: area.color,
    link: forecastPageUrl(lat, lon),
    source: 'NWS',
    label: alert.event,
    properties: {
      event: alert.event,
      headline: alert.headline,
      severity: alert.severity,
      urgency: alert.urgency,
      certainty: alert.certainty,
      onset: alert.onset,
      ends: alert.ends,
      expires: alert.expires,
      areaDesc: alert.areaDesc,
      senderName: alert.senderName,
      otherAlerts: others.map((other) => other.event),
    },
  };
}

function formatUtcDate(ms) {
  const date = new Date(ms);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

export function formatGdacsDates(event) {
  const from = Number.isFinite(event?.fromDate)
    ? formatUtcDate(event.fromDate)
    : null;
  const to = Number.isFinite(event?.toDate)
    ? formatUtcDate(event.toDate)
    : null;
  if (from && to) return from === to ? `${from} UTC` : `${from} – ${to} UTC`;
  if (from) return `From ${from} UTC`;
  if (to) return `Until ${to} UTC`;
  return null;
}

export function buildGdacsCard(event) {
  const details = [`${event.alertLevel} alert · ${event.typeName}`];
  const dates = formatGdacsDates(event);
  if (dates) details.push(dates);
  if (event.country) details.push(clampLine(event.country));
  if (event.reportUrl) details.push('Open GDACS report');
  return {
    title: clampLine(event.name),
    details,
    accent: GDACS_ALERT_COLORS[event.alertLevel] ?? GDACS_ALERT_COLORS.Green,
    link: event.reportUrl ?? null,
    source: 'GDACS',
    label: event.name,
    properties: {
      type: event.typeName,
      alertLevel: event.alertLevel,
      country: event.country ?? null,
      fromDate: event.fromDate ?? null,
      toDate: event.toDate ?? null,
      reportUrl: event.reportUrl ?? null,
    },
  };
}

/** Layer row stats; `layerPanel._buildMetaText` renders them (see the model test). */
export function buildStats({
  payload,
  lastUpdate = null,
  error = null,
  droppedAreas = 0,
}) {
  if (!payload) {
    return error
      ? {
          status: 'unavailable',
          source: 'NWS · GDACS',
          error: 'Severe weather sources unavailable',
        }
      : { status: 'ok', source: 'NWS · GDACS', count: 0, lastUpdate: null };
  }
  const part = (label, source, count, notes = []) => {
    if (source.status === 'unavailable') return `${label} unavailable`;
    const detail = source.status === 'stale' ? [...notes, 'stale'] : notes;
    return detail.length
      ? `${label} ${count} (${detail.join(', ')})`
      : `${label} ${count}`;
  };
  const nwsNotes = [];
  if (payload.nws.unmappedAlerts > 0)
    nwsNotes.push(`${payload.nws.unmappedAlerts} unmapped`);
  if (droppedAreas > 0) nwsNotes.push(`${droppedAreas} hidden`);
  const nwsCount = payload.nws.alerts.length;
  const gdacsCount = payload.gdacs.events.length;
  const stats = {
    status: 'ok',
    source: `${part('NWS', payload.nws, nwsCount, nwsNotes)} · ${part('GDACS', payload.gdacs, gdacsCount)}`,
    count: nwsCount + gdacsCount,
    lastUpdate,
  };
  if (error)
    return { ...stats, stale: true, error: 'Severe weather refresh failed' };
  if (payload.nws.status === 'stale' || payload.gdacs.status === 'stale')
    return { ...stats, stale: true };
  if (
    payload.nws.status === 'unavailable' ||
    payload.gdacs.status === 'unavailable'
  ) {
    return { ...stats, degraded: true };
  }
  return stats;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/layers/severe-weather/model.test.mjs`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/layers/severe-weather/model.js src/layers/severe-weather/model.test.mjs
git commit -m "feat(severe-weather): alert areas, cards and layer row status" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Cesium rendering with a bounded ready pump

**Files:**
- Create: `src/layers/severe-weather/rendering.js`
- Test: `src/layers/severe-weather/rendering.test.mjs`

**Interfaces:**
- Consumes:
  - `GDACS_ALERT_COLORS`, `countAreaPositions` (Task 4);
  - `viewer.dataSources.add/remove`;
  - `viewer.dataSourceDisplay.getBoundingSphere(entity, false, result) → BoundingSphereState`.
- Produces:
  - `NWS_FILL_ALPHA = 0.22`, `CONE_FILL_ALPHA = 0.14`, `READY_POLL_MS = 250`, `READY_POLL_LIMIT = 40`;
  - `isSevereWeatherPickId(id) → boolean` (the `severe-weather:` prefix);
  - `createSevereWeatherRendering(viewer, { requestRender, timers }) → { dataSource, render({ areas, events }) → boolean, targetFor(picked) → { kind: 'nws' | 'gdacs', key } | null, setSelected('nws:<area key>' | 'gdacs:<event id>' | null), setVisible(boolean), clear(), destroy() }`.

- [ ] **Step 1: Write the failing test**

```js
// src/layers/severe-weather/rendering.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  CONE_FILL_ALPHA,
  NWS_FILL_ALPHA,
  READY_POLL_LIMIT,
  READY_POLL_MS,
  createSevereWeatherRendering,
  isSevereWeatherPickId,
} from './rendering.js';

const T = Cesium.JulianDate.now();
const ring = (lon, lat, size = 1) => [
  [lon, lat],
  [lon + size, lat],
  [lon + size, lat + size],
  [lon, lat + size],
  [lon, lat],
];
const AREAS = [
  {
    key: 'zone:forecast/AKZ844',
    color: '#ff9500',
    polygons: [[ring(-148, 64)]],
    alerts: [],
  },
  {
    key: 'alert:urn:x',
    color: '#5ac8fa',
    polygons: [[ring(-95, 41), ring(-94.8, 41.2, 0.2)], [ring(-90, 41)]],
    alerts: [],
  },
];
const EVENTS = [
  {
    id: 'TC-1001321',
    alertLevel: 'Green',
    lon: -119.7,
    lat: 16.3,
    track: [
      [
        [-117.2, 17.2],
        [-118.3, 17],
        [-119.7, 16.3],
      ],
    ],
    cone: [[ring(-125, 14, 4)]],
  },
  {
    id: 'DR-1018431',
    alertLevel: 'Orange',
    lon: 47.017,
    lat: -19.34,
    track: [],
    cone: [],
  },
];

function fakeViewer() {
  const state = { pending: false };
  const sources = [];
  return {
    state,
    sources,
    dataSources: {
      add(source) {
        sources.push(source);
        return Promise.resolve(source);
      },
      remove(source) {
        const index = sources.indexOf(source);
        if (index >= 0) sources.splice(index, 1);
        return index >= 0;
      },
    },
    dataSourceDisplay: {
      getBoundingSphere: () =>
        state.pending
          ? Cesium.BoundingSphereState.PENDING
          : Cesium.BoundingSphereState.DONE,
    },
  };
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
      pending = pending.filter((entry) => entry !== timer);
    },
    count: () => pending.length,
    runNext() {
      const timer = pending.shift();
      timer.fn();
      return timer.ms;
    },
  };
}

function harness() {
  const viewer = fakeViewer();
  const timers = fakeTimers();
  const renders = [];
  const rendering = createSevereWeatherRendering(viewer, {
    requestRender: (reason) => renders.push(reason),
    timers,
  });
  const entity = (id) => rendering.dataSource.entities.getById(id);
  return { viewer, timers, renders, rendering, entity };
}

const colorOf = (property) =>
  property.getValue(T).color ?? property.getValue(T);

test('NWS areas become ground fills with outlines; GDACS events become points, tracks and cones', () => {
  const { viewer, rendering, renders, entity } = harness();
  assert.equal(viewer.sources.length, 1);
  assert.equal(rendering.render({ areas: AREAS, events: EVENTS }), true);
  assert.equal(rendering.dataSource.entities.values.length, 11);

  const fill = entity('severe-weather:nws:zone:forecast/AKZ844:0');
  assert.equal(
    fill.polygon.height,
    undefined,
    'no height: Cesium clamps the fill to the ground',
  );
  assert.equal(
    fill.polygon.classificationType.getValue(T),
    Cesium.ClassificationType.BOTH,
  );
  assert.ok(
    fill.polygon.material.color
      .getValue(T)
      .equals(
        Cesium.Color.fromCssColorString('#ff9500').withAlpha(NWS_FILL_ALPHA),
      ),
  );
  const outline = entity('severe-weather:nws:zone:forecast/AKZ844:0:outline');
  assert.equal(outline.polyline.clampToGround.getValue(T), true);
  assert.equal(outline.polyline.width.getValue(T), 2);
  assert.equal(
    entity('severe-weather:nws:alert:urn:x:0').polygon.hierarchy.getValue(T)
      .holes.length,
    1,
  );
  assert.ok(
    entity('severe-weather:nws:alert:urn:x:1'),
    'a second polygon of the same alert',
  );

  const drought = entity('severe-weather:gdacs:DR-1018431');
  assert.equal(
    drought.point.heightReference.getValue(T),
    Cesium.HeightReference.CLAMP_TO_GROUND,
  );
  assert.equal(
    drought.point.disableDepthTestDistance.getValue(T),
    Number.POSITIVE_INFINITY,
  );
  assert.ok(
    drought.point.color
      .getValue(T)
      .equals(Cesium.Color.fromCssColorString('#ff9500')),
  );
  assert.equal(
    entity('severe-weather:gdacs:TC-1001321:track:0').polyline.width.getValue(
      T,
    ),
    3,
  );
  assert.ok(
    colorOf(
      entity('severe-weather:gdacs:TC-1001321:cone:0').polygon.material,
    ).equals(
      Cesium.Color.fromCssColorString('#34c759').withAlpha(CONE_FILL_ALPHA),
    ),
  );

  assert.deepEqual(rendering.targetFor({ id: fill }), {
    kind: 'nws',
    key: 'zone:forecast/AKZ844',
  });
  assert.deepEqual(rendering.targetFor({ id: outline }), {
    kind: 'nws',
    key: 'zone:forecast/AKZ844',
  });
  assert.deepEqual(
    rendering.targetFor({ id: 'severe-weather:gdacs:TC-1001321:track:0' }),
    { kind: 'gdacs', key: 'TC-1001321' },
  );
  assert.equal(
    rendering.targetFor({ id: new Cesium.Entity({ id: 'flight:abc' }) }),
    null,
  );
  assert.equal(rendering.targetFor(undefined), null);
  assert.equal(isSevereWeatherPickId('severe-weather:gdacs:DR-1018431'), true);
  assert.equal(isSevereWeatherPickId('flight:abc'), false);
  assert.ok(renders.includes('severe-weather-render'));
});

test('an unchanged drawn set is not rebuilt; a changed one is', () => {
  const { rendering, entity } = harness();
  rendering.render({ areas: AREAS, events: EVENTS });
  const before = entity('severe-weather:gdacs:DR-1018431');
  assert.equal(rendering.render({ areas: AREAS, events: EVENTS }), false);
  assert.equal(entity('severe-weather:gdacs:DR-1018431'), before);
  assert.equal(
    rendering.render({
      areas: AREAS,
      events: [EVENTS[0], { ...EVENTS[1], alertLevel: 'Red' }],
    }),
    true,
  );
  assert.notEqual(entity('severe-weather:gdacs:DR-1018431'), before);
});

test('selection turns the chosen outlines, track and point white and requests a render', () => {
  const { rendering, renders, entity } = harness();
  rendering.render({ areas: AREAS, events: EVENTS });
  rendering.setSelected('gdacs:TC-1001321');
  assert.ok(renders.includes('severe-weather-selection'));
  const track = entity('severe-weather:gdacs:TC-1001321:track:0');
  assert.equal(track.polyline.width.getValue(T), 5);
  assert.ok(colorOf(track.polyline.material).equals(Cesium.Color.WHITE));
  assert.equal(
    entity('severe-weather:gdacs:TC-1001321').point.pixelSize.getValue(T),
    15,
  );
  assert.equal(
    entity(
      'severe-weather:nws:zone:forecast/AKZ844:0:outline',
    ).polyline.width.getValue(T),
    2,
    'others unchanged',
  );

  rendering.setSelected('nws:zone:forecast/AKZ844');
  assert.equal(track.polyline.width.getValue(T), 3);
  assert.equal(
    entity(
      'severe-weather:nws:zone:forecast/AKZ844:0:outline',
    ).polyline.width.getValue(T),
    4,
  );
  rendering.render({ areas: AREAS, events: [EVENTS[1]] });
  assert.equal(
    entity(
      'severe-weather:nws:zone:forecast/AKZ844:0:outline',
    ).polyline.width.getValue(T),
    4,
    'a rebuild keeps the highlight',
  );
  rendering.setSelected(null);
  assert.equal(
    entity(
      'severe-weather:nws:zone:forecast/AKZ844:0:outline',
    ).polyline.width.getValue(T),
    2,
  );
});

test('frames are requested while new ground geometry is pending, and the pump is bounded', () => {
  const { viewer, timers, renders, rendering } = harness();
  viewer.state.pending = true;
  rendering.render({ areas: AREAS, events: EVENTS });
  assert.equal(timers.count(), 1);
  for (let i = 0; i < 3; i += 1) assert.equal(timers.runNext(), READY_POLL_MS);
  assert.equal(
    renders.filter((reason) => reason === 'severe-weather-geometry').length,
    3,
  );
  viewer.state.pending = false;
  timers.runNext();
  assert.equal(timers.count(), 0, 'ready geometry stops the pump');

  rendering.setSelected('gdacs:DR-1018431');
  viewer.state.pending = true;
  let ticks = 0;
  while (timers.count()) {
    timers.runNext();
    ticks += 1;
  }
  assert.equal(ticks, READY_POLL_LIMIT);
});

test('visibility, clear and destroy', () => {
  const { viewer, timers, renders, rendering } = harness();
  rendering.render({ areas: AREAS, events: EVENTS });
  rendering.setVisible(false);
  assert.equal(rendering.dataSource.show, false);
  assert.ok(renders.includes('severe-weather-visibility'));
  rendering.clear();
  assert.equal(rendering.dataSource.entities.values.length, 0);
  assert.equal(timers.count(), 0);
  assert.equal(
    rendering.targetFor({ id: 'severe-weather:gdacs:DR-1018431' }),
    null,
  );
  assert.equal(
    rendering.render({ areas: AREAS, events: EVENTS }),
    true,
    'clear forgets the signature',
  );
  rendering.destroy();
  assert.equal(viewer.sources.length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/layers/severe-weather/rendering.test.mjs`
Expected: FAIL with `Cannot find module` for `./rendering.js`.

- [ ] **Step 3: Write the implementation**

```js
// src/layers/severe-weather/rendering.js
import * as Cesium from 'cesium';
import { GDACS_ALERT_COLORS, countAreaPositions } from './model.js';

export const NWS_FILL_ALPHA = 0.22;
export const CONE_FILL_ALPHA = 0.14;
export const READY_POLL_MS = 250;
export const READY_POLL_LIMIT = 40;
const ENTITY_PREFIX = 'severe-weather:';

export function isSevereWeatherPickId(id) {
  return typeof id === 'string' && id.startsWith(ENTITY_PREFIX);
}

const positionsOf = (ring) => Cesium.Cartesian3.fromDegreesArray(ring.flat());
const hierarchyOf = ([outer, ...holes]) =>
  new Cesium.PolygonHierarchy(
    positionsOf(outer),
    holes.map((ring) => new Cesium.PolygonHierarchy(positionsOf(ring))),
  );

/**
 * Ground-clamped NWS areas (fill plus outline), GDACS points, cyclone tracks
 * and cones, in one CustomDataSource. Every scene change requests a render:
 * the app idles in Cesium's requestRenderMode.
 */
export function createSevereWeatherRendering(
  viewer,
  {
    requestRender = () => {},
    timers = {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (timer) => clearTimeout(timer),
    },
  } = {},
) {
  const dataSource = new Cesium.CustomDataSource('severe-weather');
  viewer.dataSources.add(dataSource);
  /** entity id → { kind: 'nws' | 'gdacs', key } */
  const targets = new Map();
  /** selection key → [(selected) => void] */
  const highlighters = new Map();
  let signature = null;
  let selectedKey = null;
  let pollTimer = null;
  let polls = 0;

  function addHighlighter(selectionKey, apply) {
    const list = highlighters.get(selectionKey) ?? [];
    list.push(apply);
    highlighters.set(selectionKey, list);
  }

  function addLine(id, positions, color, width, selectionKey, target) {
    const entity = dataSource.entities.add({
      id,
      polyline: {
        positions: positionsOf(positions),
        width,
        material: color,
        clampToGround: true,
        classificationType: Cesium.ClassificationType.BOTH,
      },
    });
    targets.set(id, target);
    addHighlighter(selectionKey, (selected) => {
      entity.polyline.width = selected ? width + 2 : width;
      entity.polyline.material = selected ? Cesium.Color.WHITE : color;
    });
  }

  function addFill(id, polygon, color, target) {
    dataSource.entities.add({
      id,
      polygon: {
        hierarchy: hierarchyOf(polygon),
        material: color,
        classificationType: Cesium.ClassificationType.BOTH,
      },
    });
    targets.set(id, target);
  }

  function addArea(area) {
    const color = Cesium.Color.fromCssColorString(area.color);
    const selectionKey = `nws:${area.key}`;
    const target = { kind: 'nws', key: area.key };
    area.polygons.forEach((polygon, index) => {
      const id = `${ENTITY_PREFIX}nws:${area.key}:${index}`;
      addFill(id, polygon, color.withAlpha(NWS_FILL_ALPHA), target);
      addLine(`${id}:outline`, polygon[0], color, 2, selectionKey, target);
    });
  }

  function addEvent(event) {
    const color = Cesium.Color.fromCssColorString(
      GDACS_ALERT_COLORS[event.alertLevel] ?? GDACS_ALERT_COLORS.Green,
    );
    const selectionKey = `gdacs:${event.id}`;
    const target = { kind: 'gdacs', key: event.id };
    const base = `${ENTITY_PREFIX}gdacs:${event.id}`;
    event.cone.forEach((polygon, index) => {
      addFill(
        `${base}:cone:${index}`,
        polygon,
        color.withAlpha(CONE_FILL_ALPHA),
        target,
      );
      addLine(
        `${base}:cone:${index}:outline`,
        polygon[0],
        color,
        1.5,
        selectionKey,
        target,
      );
    });
    event.track.forEach((line, index) => {
      addLine(`${base}:track:${index}`, line, color, 3, selectionKey, target);
    });
    const point = dataSource.entities.add({
      id: base,
      position: Cesium.Cartesian3.fromDegrees(event.lon, event.lat),
      point: {
        pixelSize: 11,
        color,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    targets.set(base, target);
    addHighlighter(selectionKey, (selected) => {
      point.point.pixelSize = selected ? 15 : 11;
      point.point.outlineColor = selected
        ? Cesium.Color.WHITE
        : Cesium.Color.BLACK;
    });
  }

  function applyHighlight() {
    for (const [key, list] of highlighters)
      for (const apply of list) apply(key === selectedKey);
  }

  /** Whether Cesium is still building the newest ground geometry (sampled at both ends of the collection). */
  function isPending() {
    const display = viewer.dataSourceDisplay;
    const entities = dataSource.entities.values;
    if (
      typeof display?.getBoundingSphere !== 'function' ||
      entities.length === 0
    )
      return false;
    const scratch = new Cesium.BoundingSphere();
    return [entities[0], entities[entities.length - 1]].some(
      (entity) =>
        display.getBoundingSphere(entity, false, scratch) ===
        Cesium.BoundingSphereState.PENDING,
    );
  }

  function stopReadyPump() {
    if (pollTimer !== null) timers.clearTimeout(pollTimer);
    pollTimer = null;
  }

  /** Primitives only build while frames render, so ask for frames until the geometry is ready (bounded). */
  function startReadyPump() {
    stopReadyPump();
    polls = 0;
    const tick = () => {
      pollTimer = null;
      requestRender('severe-weather-geometry');
      polls += 1;
      if (polls < READY_POLL_LIMIT && isPending())
        pollTimer = timers.setTimeout(tick, READY_POLL_MS);
    };
    pollTimer = timers.setTimeout(tick, READY_POLL_MS);
  }

  function clear() {
    stopReadyPump();
    signature = null;
    selectedKey = null;
    targets.clear();
    highlighters.clear();
    dataSource.entities.removeAll();
    requestRender('severe-weather-clear');
  }

  return {
    dataSource,

    /** Rebuild only when the drawn set changed; returns whether it rebuilt. */
    render({ areas, events }) {
      const next = JSON.stringify([
        areas.map((area) => [area.key, area.color, countAreaPositions(area)]),
        events.map((event) => [
          event.id,
          event.alertLevel,
          event.lon,
          event.lat,
          event.track.length,
          event.cone.length,
        ]),
      ]);
      if (next === signature) return false;
      signature = next;
      dataSource.entities.suspendEvents();
      dataSource.entities.removeAll();
      targets.clear();
      highlighters.clear();
      for (const area of areas) addArea(area);
      for (const event of events) addEvent(event);
      applyHighlight();
      dataSource.entities.resumeEvents();
      requestRender('severe-weather-render');
      startReadyPump();
      return true;
    },

    targetFor(picked) {
      const id =
        picked?.id instanceof Cesium.Entity ? picked.id.id : picked?.id;
      return typeof id === 'string' ? (targets.get(id) ?? null) : null;
    },

    /** `nws:<area key>`, `gdacs:<event id>` or null. */
    setSelected(key) {
      if (key === selectedKey) return;
      selectedKey = key;
      applyHighlight();
      requestRender('severe-weather-selection');
      startReadyPump();
    },

    setVisible(visible) {
      dataSource.show = Boolean(visible);
      requestRender('severe-weather-visibility');
    },

    clear,

    destroy() {
      clear();
      viewer.dataSources.remove(dataSource, true);
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/layers/severe-weather/rendering.test.mjs`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/layers/severe-weather/rendering.js src/layers/severe-weather/rendering.test.mjs
git commit -m "feat(severe-weather): ground-clamped alert areas, events and ready pump" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Selection card and context publication

**Files:**
- Create: `src/layers/severe-weather/selection.js`
- Test: `src/layers/severe-weather/selection.test.mjs`

**Interfaces:**
- Consumes:
  - Task 4: `buildNwsCard`, `buildGdacsCard`, and the ids.
  - Task 5: `isSevereWeatherPickId`, and a rendering with `targetFor` and `setSelected`.
  - Injected services, matching FIRMS:
    - `overlayHost { setEntries, setVisible, clearSource, hitTest(x, y, { sourceId }) }`;
    - `context { registerEntityContext, selectEntityContext, clearSelectedEntityContextForLayer, removeEntityContextsForLayer }`;
    - `picking { resolvePickId, isOwnedByOtherLayer, registerPickOwner, unregisterPickOwner }`;
    - `pickGround(viewer, windowPosition) → { lat, lon } | null` (`src/weatherReport/groundPick.js`);
    - `openLink(url)`;
    - `screenSpaceEventHandlerFactory(viewer)`;
    - `getData() → { areas, events }`.
- Produces: `createSevereWeatherSelection(services) → { install(), uninstall(), select(target, anchor), clear(), refresh(), selected() }`.

- [ ] **Step 1: Write the failing test**

```js
// src/layers/severe-weather/selection.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createSevereWeatherSelection } from './selection.js';

const FLOOD_WATCH = {
  id: 'a1',
  event: 'Flood Watch',
  severity: 'Severe',
  urgency: 'Future',
  certainty: 'Possible',
  onset: '2026-09-15T12:00:00-08:00',
  ends: '2026-09-19T16:00:00-08:00',
  expires: '2026-09-14T16:00:00-08:00',
  areaDesc: 'Two Rivers; Fairbanks Metro Area',
  headline: null,
  senderName: 'NWS Fairbanks AK',
};
const FOG = {
  ...FLOOD_WATCH,
  id: 'a2',
  event: 'Dense Fog Advisory',
  severity: 'Moderate',
  urgency: 'Expected',
  certainty: 'Likely',
};
const DROUGHT = {
  id: 'DR-1018431',
  typeName: 'Drought',
  name: 'Drought in Madagascar',
  alertLevel: 'Orange',
  country: 'Madagascar',
  fromDate: Date.UTC(2025, 10, 21),
  toDate: Date.UTC(2026, 8, 14, 14, 38, 32),
  lon: 47.017,
  lat: -19.34,
  reportUrl:
    'https://www.gdacs.org/report.aspx?eventid=1018431&episodeid=14&eventtype=DR',
  track: [],
  cone: [],
};
const FAIRBANKS_ID = 'severe-weather:nws:zone:forecast/AKZ844:0';
const DROUGHT_ID = 'severe-weather:gdacs:DR-1018431';

function harness() {
  const calls = [];
  const data = {
    areas: [
      {
        key: 'zone:forecast/AKZ844',
        color: '#ff9500',
        polygons: [],
        alerts: [FLOOD_WATCH, FOG],
      },
    ],
    events: [DROUGHT],
  };
  const targets = new Map([
    [FAIRBANKS_ID, { kind: 'nws', key: 'zone:forecast/AKZ844' }],
    [DROUGHT_ID, { kind: 'gdacs', key: 'DR-1018431' }],
  ]);
  let action = null;
  let destroyed = 0;
  let picked = null;
  let hit = null;
  const records = new Map();
  const owners = new Map();
  const opened = [];
  const selection = createSevereWeatherSelection({
    viewer: { scene: { pick: () => picked } },
    rendering: {
      targetFor: (value) => targets.get(value?.id) ?? null,
      setSelected: (key) => calls.push(['highlight', key]),
    },
    overlayHost: {
      setVisible: (...args) => calls.push(['visible', ...args]),
      setEntries: (...args) => calls.push(['entries', ...args]),
      clearSource: (...args) => calls.push(['clearSource', ...args]),
      hitTest: (x, y, options) =>
        options?.sourceId === 'severe-weather' ? hit : null,
    },
    context: {
      registerEntityContext: (entity, metadata) => {
        entity.__gevContextId = metadata.id;
        records.set(metadata.id, { ...metadata, entity });
      },
      selectEntityContext: (entity) =>
        calls.push(['selectContext', entity.__gevContextId]),
      clearSelectedEntityContextForLayer: (layerId) =>
        calls.push(['clearContext', layerId]),
      removeEntityContextsForLayer: (layerId) =>
        calls.push(['removeContexts', layerId]),
    },
    picking: {
      resolvePickId: (value) =>
        typeof value?.id === 'string' ? value.id : null,
      isOwnedByOtherLayer: (layerId, id) =>
        [...owners].some(
          ([owner, predicate]) => owner !== layerId && predicate(id),
        ),
      registerPickOwner: (layerId, predicate) => owners.set(layerId, predicate),
      unregisterPickOwner: (layerId) => owners.delete(layerId),
    },
    pickGround: () => ({ lat: 64.8378, lon: -147.7164 }),
    openLink: (url) => opened.push(url),
    screenSpaceEventHandlerFactory: () => ({
      setInputAction(fn, type) {
        action = fn;
        calls.push(['input', type]);
      },
      destroy() {
        destroyed += 1;
      },
    }),
    getData: () => data,
  });
  selection.install();
  return {
    selection,
    calls,
    data,
    records,
    owners,
    opened,
    click: () => action({ position: new Cesium.Cartesian2(10, 20) }),
    pick: (id) => {
      picked = id === null ? null : { id };
    },
    hit: (value) => {
      hit = value;
    },
    destroyed: () => destroyed,
    entries: () => calls.filter(([name]) => name === 'entries'),
    count: (name) => calls.filter(([entry]) => entry === name).length,
  };
}

test('clicking an NWS area pins the top alert card at the clicked ground and publishes the context', () => {
  const h = harness();
  assert.deepEqual(h.calls[0], [
    'input',
    Cesium.ScreenSpaceEventType.LEFT_CLICK,
  ]);
  assert.equal(h.owners.get('severe-weather')('severe-weather:gdacs:x'), true);
  h.pick(FAIRBANKS_ID);
  h.click();
  const [, sourceId, [entry], options] = h.entries().at(-1);
  assert.equal(sourceId, 'severe-weather');
  assert.deepEqual(options, {
    cohortLimit: 1,
    collisionCapacity: 1,
    moving: false,
  });
  assert.equal(entry.id, 'selected:nws:zone:forecast/AKZ844');
  assert.equal(entry.variant, 'card');
  assert.equal(entry.selected, true);
  assert.equal(entry.interactive, true);
  assert.equal(entry.title, 'Flood Watch');
  assert.equal(entry.accent, '#ff9500');
  assert.deepEqual(entry.details, [
    'Severe · Future · Possible',
    'Sep 15 12:00 – Sep 19 16:00 UTC−8',
    'Two Rivers; Fairbanks Metro Area',
    '+1 more: Dense Fog Advisory',
    'Open weather.gov forecast',
  ]);
  assert.ok(
    Cesium.Cartesian3.equalsEpsilon(
      entry.position,
      Cesium.Cartesian3.fromDegrees(-147.7164, 64.8378),
      1e-6,
    ),
  );
  const record = h.records.get('severe-weather:nws:zone:forecast/AKZ844');
  assert.equal(record.layerId, 'severe-weather');
  assert.equal(record.layerName, 'Severe Weather');
  assert.equal(record.source, 'NWS');
  assert.equal(record.label, 'Flood Watch');
  assert.equal(record.latitude, 64.8378);
  assert.ok(
    h.calls.some(
      ([name, id]) =>
        name === 'selectContext' &&
        id === 'severe-weather:nws:zone:forecast/AKZ844',
    ),
  );
  assert.deepEqual(h.calls.filter(([name]) => name === 'highlight').at(-1), [
    'highlight',
    'nws:zone:forecast/AKZ844',
  ]);
});

test('clicking the card, or activating it from the keyboard mirror, opens its link', () => {
  const h = harness();
  h.pick(FAIRBANKS_ID);
  h.click();
  h.hit({
    sourceId: 'severe-weather',
    entryId: 'selected:nws:zone:forecast/AKZ844',
  });
  h.click();
  assert.deepEqual(h.opened, [
    'https://forecast.weather.gov/MapClick.php?lat=64.8378&lon=-147.7164',
  ]);
  const [, , [entry]] = h.entries().at(-1);
  assert.equal(entry.activate(), true);
  assert.equal(h.opened.length, 2);
});

test('a GDACS event card anchors at the event and links to the GDACS report', () => {
  const h = harness();
  h.pick(DROUGHT_ID);
  h.click();
  const [, , [entry]] = h.entries().at(-1);
  assert.equal(entry.title, 'Drought in Madagascar');
  assert.deepEqual(entry.details, [
    'Orange alert · Drought',
    'Nov 21, 2025 – Sep 14, 2026 UTC',
    'Madagascar',
    'Open GDACS report',
  ]);
  assert.ok(
    Cesium.Cartesian3.equalsEpsilon(
      entry.position,
      Cesium.Cartesian3.fromDegrees(47.017, -19.34),
      1e-6,
    ),
  );
  entry.activate();
  assert.deepEqual(h.opened, [DROUGHT.reportUrl]);
  assert.equal(
    h.records.get('severe-weather:gdacs:DR-1018431').source,
    'GDACS',
  );
});

test('a pick owned by another layer keeps the card; an empty click clears it', () => {
  const h = harness();
  h.owners.set('flights', (id) => id.startsWith('flight:'));
  h.pick(FAIRBANKS_ID);
  h.click();
  h.pick('flight:abc123');
  h.click();
  assert.equal(h.count('clearSource'), 0);
  h.pick(null);
  h.click();
  assert.equal(h.count('clearSource'), 1);
  assert.ok(
    h.calls.some(
      ([name, id]) => name === 'clearContext' && id === 'severe-weather',
    ),
  );
  assert.ok(
    h.calls.some(
      ([name, id]) => name === 'removeContexts' && id === 'severe-weather',
    ),
  );
  assert.deepEqual(h.calls.filter(([name]) => name === 'highlight').at(-1), [
    'highlight',
    null,
  ]);
  assert.equal(h.selection.selected(), null);
  h.click();
  assert.equal(h.count('clearSource'), 1, 'clearing twice is a no-op');
});

test('a refresh keeps the card current without re-announcing, and drops it when its area is gone', () => {
  const h = harness();
  h.pick(FAIRBANKS_ID);
  h.click();
  h.data.areas[0] = { ...h.data.areas[0], alerts: [FOG] };
  h.selection.refresh();
  assert.equal(h.entries().at(-1)[2][0].title, 'Dense Fog Advisory');
  assert.equal(h.count('selectContext'), 1);
  h.data.areas = [];
  h.selection.refresh();
  assert.equal(h.count('clearSource'), 1);
  assert.equal(h.selection.selected(), null);

  h.selection.uninstall();
  assert.equal(h.destroyed(), 1);
  assert.equal(h.owners.has('severe-weather'), false);
  assert.deepEqual(h.calls.at(-1), ['visible', 'severe-weather', false]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/layers/severe-weather/selection.test.mjs`
Expected: FAIL with `Cannot find module` for `./selection.js`.

- [ ] **Step 3: Write the implementation**

```js
// src/layers/severe-weather/selection.js
import * as Cesium from 'cesium';
import {
  SEVERE_WEATHER_LAYER_ID as LAYER_ID,
  SEVERE_WEATHER_OVERLAY_SOURCE_ID as SOURCE_ID,
  buildGdacsCard,
  buildNwsCard,
} from './model.js';
import { isSevereWeatherPickId } from './rendering.js';

const LAYER_NAME = 'Severe Weather';
const CARD_SOURCE_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 1,
  moving: false,
});

/**
 * Click an alert area or event to pin one selected card (the FIRMS selected-card
 * pattern) and publish it to the shared context store. Clicking the card opens
 * its link; clicking empty globe clears it.
 */
export function createSevereWeatherSelection({
  viewer,
  rendering,
  overlayHost,
  context,
  picking,
  pickGround,
  openLink,
  screenSpaceEventHandlerFactory,
  getData,
}) {
  let handler = null;
  /** { kind: 'nws' | 'gdacs', key, lat, lon } */
  let selected = null;

  function cardFor(selection) {
    if (!selection) return null;
    const data = getData();
    if (selection.kind === 'nws') {
      const area = data.areas.find(
        (candidate) => candidate.key === selection.key,
      );
      return area ? buildNwsCard(area, selection) : null;
    }
    const event = data.events.find(
      (candidate) => candidate.id === selection.key,
    );
    return event ? buildGdacsCard(event) : null;
  }

  function publish(card, { announce }) {
    const position = Cesium.Cartesian3.fromDegrees(selected.lon, selected.lat);
    const { link } = card;
    overlayHost.setVisible(SOURCE_ID, true);
    overlayHost.setEntries(
      SOURCE_ID,
      [
        {
          id: `selected:${selected.kind}:${selected.key}`,
          position,
          variant: 'card',
          title: card.title,
          details: card.details,
          accent: card.accent,
          selected: true,
          priority: Number.MAX_SAFE_INTEGER,
          collisionGroup: 'ambient-card',
          interactive: Boolean(link),
          accessibilityLabel: link ? `Open details for ${card.title}` : '',
          activate: link
            ? () => {
                openLink(link);
                return true;
              }
            : undefined,
          edgeFade: 'keyhole',
          horizonCull: true,
          terrainOcclusion: false,
          gapPx: 14,
          placement: 'above',
        },
      ],
      CARD_SOURCE_OPTIONS,
    );
    const carrier = { show: true, __localBaseCartesian: position };
    context.registerEntityContext(carrier, {
      id: `${LAYER_ID}:${selected.kind}:${selected.key}`,
      layerId: LAYER_ID,
      layerName: LAYER_NAME,
      source: card.source,
      label: card.label,
      latitude: selected.lat,
      longitude: selected.lon,
      properties: card.properties,
    });
    if (announce) context.selectEntityContext(carrier);
    rendering.setSelected(`${selected.kind}:${selected.key}`);
  }

  function clear() {
    if (!selected) return;
    selected = null;
    overlayHost.clearSource(SOURCE_ID);
    context.clearSelectedEntityContextForLayer(LAYER_ID);
    context.removeEntityContextsForLayer(LAYER_ID);
    rendering.setSelected(null);
  }

  function select(target, anchor) {
    selected = {
      kind: target.kind,
      key: target.key,
      lat: anchor.lat,
      lon: anchor.lon,
    };
    const card = cardFor(selected);
    if (!card) {
      clear();
      return false;
    }
    publish(card, { announce: true });
    return true;
  }

  function eventAnchor(id) {
    const event = getData().events.find((candidate) => candidate.id === id);
    return event ? { lat: event.lat, lon: event.lon } : null;
  }

  function onClick(click) {
    const position = click?.position;
    if (!position) return;
    if (
      selected &&
      overlayHost.hitTest?.(position.x, position.y, { sourceId: SOURCE_ID })
    ) {
      const card = cardFor(selected);
      if (card?.link) openLink(card.link);
      return;
    }
    const picked = viewer.scene.pick(position);
    const target = rendering.targetFor(picked);
    if (target) {
      const anchor =
        target.kind === 'gdacs'
          ? eventAnchor(target.key)
          : pickGround(viewer, position);
      if (anchor) select(target, anchor);
      return;
    }
    const pickedId = picked ? picking.resolvePickId(picked) : null;
    // A pick owned by a sibling layer is not empty space: leave the card alone.
    if (pickedId && picking.isOwnedByOtherLayer(LAYER_ID, pickedId)) return;
    clear();
  }

  return {
    install() {
      if (handler) return;
      handler = screenSpaceEventHandlerFactory(viewer);
      handler.setInputAction(onClick, Cesium.ScreenSpaceEventType.LEFT_CLICK);
      picking.registerPickOwner(LAYER_ID, isSevereWeatherPickId);
    },

    uninstall() {
      clear();
      handler?.destroy();
      handler = null;
      picking.unregisterPickOwner(LAYER_ID);
      overlayHost.setVisible(SOURCE_ID, false);
    },

    select,
    clear,

    /** After new data: keep the card current without re-announcing, or drop it when its alert or event is gone. */
    refresh() {
      if (!selected) return;
      const card = cardFor(selected);
      if (!card) clear();
      else publish(card, { announce: false });
    },

    selected: () => (selected ? { ...selected } : null),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/layers/severe-weather/selection.test.mjs`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/layers/severe-weather/selection.js src/layers/severe-weather/selection.test.mjs
git commit -m "feat(severe-weather): selected alert card with links and context" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Layer lifecycle, application services and credits

**Files:**
- Create: `src/layers/severe-weather/index.js`, `src/data/severeWeather.js`
- Modify: `src/data/dataCredits.js` (two credits)
- Test: `src/layers/severe-weather/index.test.mjs`

**Interfaces:**
- Consumes:
  - Tasks 4–6;
  - `registerDynamicCredit(viewer, credit)` (`src/data/dataCredits.js`);
  - `governorRequestRender` (`src/renderGovernor.js`);
  - the context store (`src/data/contextStore.js`) and pick registry (`src/data/pickRegistry.js`);
  - `setOverlayEntries`, `setOverlaySourceVisible`, `clearOverlaySource`, `hitTestWorldOverlay` (`src/overlays/worldOverlay.js`);
  - `pickGround` (`src/weatherReport/groundPick.js`).
  - Manager contract: `init(viewer)`, `enable(viewer)`, `disable(viewer)`, `update(viewer, { signal })` on enable and every `updateInterval`, `destroy(viewer)`, `getStats()`.
- Produces:
  - `REFRESH_MS = 300000`, `SEVERE_WEATHER_ENDPOINT = '/api/severe-weather'`;
  - `createSevereWeatherLayer({ fetchImpl, overlayHost, context, picking, pickGround, openLink, requestRender, registerCredit, credits, isVisible, now, timers, createRendering, screenSpaceEventHandlerFactory }) → layer`;
  - `src/data/severeWeather.js`: `createSevereWeatherLayer(options)` with the application services, plus the default instance;
  - `NWS_ALERTS_CREDIT`, `GDACS_CREDIT`.

- [ ] **Step 1: Write the failing test**

```js
// src/layers/severe-weather/index.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Cesium from 'cesium';
import {
  REFRESH_MS,
  SEVERE_WEATHER_ENDPOINT,
  createSevereWeatherLayer,
} from './index.js';
import defaultLayer from '../../data/severeWeather.js';
import { GDACS_CREDIT, NWS_ALERTS_CREDIT } from '../../data/dataCredits.js';
import { simplifyGeometry } from '../../../server/providers/severe-weather/geometry.js';
import { normalizeNwsAlerts } from '../../../server/providers/severe-weather/nws.js';
import {
  attachCycloneShapes,
  normalizeGdacsCycloneShapes,
  normalizeGdacsEvents,
} from '../../../server/providers/severe-weather/gdacs.js';

const T = Date.UTC(2026, 8, 14, 16, 10);
const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../../data/fixtures/severe-weather/${name}`, import.meta.url),
      'utf8',
    ),
  );

function fixturePayload() {
  const nws = normalizeNwsAlerts(fixture('nws-alerts-active.json'));
  const zones = Object.fromEntries(
    Object.entries(fixture('nws-zones.json')).map(([key, zone]) => [
      key,
      simplifyGeometry(zone.geometry),
    ]),
  );
  const events = attachCycloneShapes(
    normalizeGdacsEvents(fixture('gdacs-events4app.json')),
    normalizeGdacsCycloneShapes(fixture('gdacs-map-tc.json')),
  );
  return {
    generatedAt: T,
    nws: {
      status: 'ok',
      updatedAt: nws.updatedAt,
      alerts: nws.alerts,
      zones,
      unmappedAlerts: 0,
    },
    gdacs: { status: 'ok', updatedAt: T, events },
  };
}

function harness({ answer = () => Response.json(fixturePayload()) } = {}) {
  const calls = [];
  const requests = [];
  const renders = [];
  const credited = [];
  let action = null;
  const state = { visible: true, answer };
  const rendering = {
    render: (data) => renders.push(data),
    targetFor: (picked) =>
      picked?.id === 'fairbanks'
        ? { kind: 'nws', key: 'zone:forecast/AKZ844' }
        : null,
    setSelected: (key) => calls.push(['highlight', key]),
    setVisible: (visible) => calls.push(['renderVisible', visible]),
    clear: () => calls.push(['renderClear']),
    destroy: () => calls.push(['renderDestroy']),
  };
  const layer = createSevereWeatherLayer({
    fetchImpl: async (url, init) => {
      requests.push(url);
      if (init?.signal?.aborted)
        throw new DOMException('aborted', 'AbortError');
      return state.answer();
    },
    overlayHost: {
      setVisible: (...args) => calls.push(['visible', ...args]),
      setEntries: (...args) => calls.push(['entries', ...args]),
      clearSource: (...args) => calls.push(['clearSource', ...args]),
      hitTest: () => null,
    },
    context: {
      registerEntityContext: (entity, metadata) => {
        entity.__gevContextId = metadata.id;
      },
      selectEntityContext: () => {},
      clearSelectedEntityContextForLayer: () => {},
      removeEntityContextsForLayer: () => {},
    },
    picking: {
      resolvePickId: () => null,
      isOwnedByOtherLayer: () => false,
      registerPickOwner: (id) => calls.push(['pickOwner', id]),
      unregisterPickOwner: (id) => calls.push(['pickOwnerRemoved', id]),
    },
    pickGround: () => ({ lat: 64.8378, lon: -147.7164 }),
    registerCredit: (_viewer, credit) => credited.push(credit.key),
    credits: [{ key: 'nws' }, { key: 'gdacs' }],
    isVisible: () => state.visible,
    now: () => T,
    createRendering: (viewer, options) => {
      calls.push(['createRendering', typeof options.requestRender]);
      return rendering;
    },
    screenSpaceEventHandlerFactory: () => ({
      setInputAction(fn) {
        action = fn;
      },
      destroy() {
        calls.push(['handlerDestroyed']);
      },
    }),
  });
  const viewer = { scene: { pick: () => ({ id: 'fairbanks' }) } };
  return {
    layer,
    viewer,
    state,
    calls,
    requests,
    renders,
    credited,
    click: () => action({ position: new Cesium.Cartesian2(5, 5) }),
    count: (name) => calls.filter(([entry]) => entry === name).length,
  };
}

async function enabled(h) {
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  return h.layer.update(h.viewer, {});
}

test('the layer identifies itself, refreshes every five minutes and credits both sources', () => {
  const { layer } = harness();
  assert.equal(layer.id, 'severe-weather');
  assert.equal(layer.name, 'Severe Weather');
  assert.equal(layer.icon, '⚠️');
  assert.equal(layer.updateInterval, REFRESH_MS);
  assert.equal(REFRESH_MS, 300_000);
  assert.equal(SEVERE_WEATHER_ENDPOINT, '/api/severe-weather');
  assert.equal(defaultLayer.id, 'severe-weather');
  assert.equal(
    NWS_ALERTS_CREDIT.html,
    'US weather alerts: <a href="https://www.weather.gov/" target="_blank" rel="noopener">National Weather Service</a> (NOAA, public domain)',
  );
  assert.equal(
    GDACS_CREDIT.html,
    'Global disaster alerts: <a href="https://www.gdacs.org/" target="_blank" rel="noopener">GDACS</a>, European Commission JRC and UN OCHA (indicative, not official warnings)',
  );
  assert.throws(() => createSevereWeatherLayer({}), /requires overlay/);
});

test('enabling credits the sources, installs the click handler and draws the fetched alerts and events', async () => {
  const h = harness();
  assert.equal(await enabled(h), true);
  assert.deepEqual(h.credited, ['nws', 'gdacs']);
  assert.deepEqual(h.calls.slice(0, 3), [
    ['createRendering', 'function'],
    ['renderVisible', false],
    ['renderVisible', true],
  ]);
  assert.equal(h.count('pickOwner'), 1);
  assert.deepEqual(h.requests, ['/api/severe-weather']);
  const drawn = h.renders.at(-1);
  assert.equal(drawn.areas.length, 10);
  assert.equal(drawn.events.length, 6);
  assert.equal(drawn.droppedAreas, 0);
  assert.deepEqual(h.layer.getStats(), {
    status: 'ok',
    source: 'NWS 6 · GDACS 6',
    count: 12,
    lastUpdate: T,
  });
});

test('a hidden tab skips refreshes; a failed refresh keeps the drawing and reports it; no data is unavailable', async () => {
  const h = harness();
  await enabled(h);
  h.state.visible = false;
  assert.equal(await h.layer.update(h.viewer, {}), true);
  assert.equal(h.requests.length, 1);

  h.state.visible = true;
  h.state.answer = () =>
    Response.json(
      { error: 'Severe weather sources unavailable' },
      { status: 502 },
    );
  assert.equal(
    await h.layer.update(h.viewer, {}),
    true,
    'handled: the manager reads stats.error',
  );
  assert.equal(h.renders.length, 1);
  assert.deepEqual(h.layer.getStats(), {
    status: 'ok',
    source: 'NWS 6 · GDACS 6',
    count: 12,
    lastUpdate: T,
    stale: true,
    error: 'Severe weather refresh failed',
  });

  const cold = harness({
    answer: () => Response.json({ error: 'down' }, { status: 502 }),
  });
  await enabled(cold);
  assert.deepEqual(cold.layer.getStats(), {
    status: 'unavailable',
    source: 'NWS · GDACS',
    error: 'Severe weather sources unavailable',
  });

  const aborted = new AbortController();
  aborted.abort();
  assert.equal(
    await h.layer.update(h.viewer, { signal: aborted.signal }),
    false,
    'only a manager abort is a failure',
  );
});

test('new data refreshes the selected card, and drops it when its alert has ended', async () => {
  const h = harness();
  await enabled(h);
  h.click();
  assert.equal(
    h.calls.filter(([name]) => name === 'entries').at(-1)[2][0].title,
    'Flood Watch',
  );
  const quiet = fixturePayload();
  quiet.nws.alerts = quiet.nws.alerts.filter(
    (alert) =>
      alert.event !== 'Flood Watch' && alert.event !== 'Dense Fog Advisory',
  );
  h.state.answer = () => Response.json(quiet);
  await h.layer.update(h.viewer, {});
  assert.equal(h.count('clearSource'), 1);
  assert.deepEqual(h.calls.filter(([name]) => name === 'highlight').at(-1), [
    'highlight',
    null,
  ]);
});

test('disable releases drawings, selection and data; destroy releases the rendering', async () => {
  const h = harness();
  await enabled(h);
  h.layer.disable(h.viewer);
  assert.equal(h.count('renderClear'), 1);
  assert.equal(h.count('handlerDestroyed'), 1);
  assert.equal(h.count('pickOwnerRemoved'), 1);
  assert.deepEqual(h.layer.getStats(), {
    status: 'ok',
    source: 'NWS · GDACS',
    count: 0,
    lastUpdate: null,
  });
  assert.equal(
    await h.layer.update(h.viewer, {}),
    false,
    'a disabled layer does not refresh',
  );
  h.layer.destroy(h.viewer);
  assert.equal(h.count('renderDestroy'), 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/layers/severe-weather/index.test.mjs`
Expected: FAIL with `Cannot find module` for `./index.js`.

- [ ] **Step 3: Add the credits**

In `src/data/dataCredits.js`, directly before the line `/** Registered when the first Natural Earth region outline resolves (public`, add:

```js
export const NWS_ALERTS_CREDIT = Object.freeze({
  key: 'nws-alerts',
  html: 'US weather alerts: <a href="https://www.weather.gov/" target="_blank" rel="noopener">National Weather Service</a> (NOAA, public domain)',
});

export const GDACS_CREDIT = Object.freeze({
  key: 'gdacs',
  html: 'Global disaster alerts: <a href="https://www.gdacs.org/" target="_blank" rel="noopener">GDACS</a>, European Commission JRC and UN OCHA (indicative, not official warnings)',
});

```

- [ ] **Step 4: Write the layer**

```js
// src/layers/severe-weather/index.js
import * as Cesium from 'cesium';
import {
  SEVERE_WEATHER_LAYER_ID,
  buildNwsAreas,
  buildStats,
  capAreasToBudget,
  parseSevereWeatherPayload,
} from './model.js';
import { createSevereWeatherRendering } from './rendering.js';
import { createSevereWeatherSelection } from './selection.js';

export * from './model.js';
export {
  createSevereWeatherRendering,
  isSevereWeatherPickId,
} from './rendering.js';
export { createSevereWeatherSelection } from './selection.js';

export const REFRESH_MS = 5 * 60_000;
export const SEVERE_WEATHER_ENDPOINT = '/api/severe-weather';
const EMPTY_DATA = Object.freeze({ areas: [], events: [], droppedAreas: 0 });

/** NWS active alerts (US) and GDACS events (global) as one on/off data layer. */
export function createSevereWeatherLayer({
  fetchImpl = (...args) => fetch(...args),
  overlayHost,
  context,
  picking,
  pickGround,
  openLink = (url) => globalThis.window?.open?.(url, '_blank', 'noopener'),
  requestRender = () => {},
  registerCredit = () => false,
  credits = [],
  isVisible = () => globalThis.document?.visibilityState !== 'hidden',
  now = Date.now,
  timers,
  createRendering = createSevereWeatherRendering,
  screenSpaceEventHandlerFactory = (viewer) =>
    new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas),
} = {}) {
  if (
    !overlayHost ||
    !context ||
    !picking ||
    typeof pickGround !== 'function'
  ) {
    throw new TypeError(
      'Severe weather requires overlay, context, picking and ground-pick services',
    );
  }
  let viewer = null;
  let rendering = null;
  let selection = null;
  let enabled = false;
  let payload = null;
  let data = EMPTY_DATA;
  let lastUpdate = null;
  let error = null;
  let request = null;

  function draw() {
    const { areas, dropped } = capAreasToBudget(buildNwsAreas(payload.nws));
    data = { areas, events: payload.gdacs.events, droppedAreas: dropped };
    rendering.render(data);
    selection.refresh();
  }

  const layer = {
    id: SEVERE_WEATHER_LAYER_ID,
    name: 'Severe Weather',
    icon: '⚠️',
    source: 'NWS · GDACS',
    updateInterval: REFRESH_MS,

    init(nextViewer) {
      if (viewer)
        throw new Error('Severe weather layer is already initialized');
      viewer = nextViewer;
      rendering = createRendering(
        nextViewer,
        timers ? { requestRender, timers } : { requestRender },
      );
      rendering.setVisible(false);
      selection = createSevereWeatherSelection({
        viewer: nextViewer,
        rendering,
        overlayHost,
        context,
        picking,
        pickGround,
        openLink,
        screenSpaceEventHandlerFactory,
        getData: () => data,
      });
    },

    enable(nextViewer) {
      enabled = true;
      for (const credit of credits) registerCredit(nextViewer, credit);
      rendering?.setVisible(true);
      selection?.install();
    },

    /** Release every entity: a hidden data source still costs a visualizer walk each frame. */
    disable() {
      enabled = false;
      request?.abort();
      request = null;
      selection?.uninstall();
      rendering?.clear();
      rendering?.setVisible(false);
      payload = null;
      data = EMPTY_DATA;
      lastUpdate = null;
      error = null;
    },

    /**
     * Resolves false only when the manager's own signal aborted. Handled
     * failures resolve true and surface through getStats().error, which the
     * manager reads as the refresh failure.
     */
    async update(_viewer, { signal } = {}) {
      if (!enabled || !rendering) return false;
      if (payload && !isVisible()) return true;
      request?.abort();
      const controller = new AbortController();
      request = controller;
      const onAbort = () => controller.abort();
      if (signal?.aborted) controller.abort();
      else signal?.addEventListener?.('abort', onAbort, { once: true });
      try {
        const response = await fetchImpl(SEVERE_WEATHER_ENDPOINT, {
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error(`severe weather HTTP ${response.status}`);
        const parsed = parseSevereWeatherPayload(await response.json());
        if (!parsed) throw new Error('malformed severe weather payload');
        if (!enabled || request !== controller) return true;
        payload = parsed;
        error = null;
        lastUpdate = now();
        draw();
        return true;
      } catch (failure) {
        if (signal?.aborted) return false;
        if (controller.signal.aborted || !enabled) return true;
        error = failure?.message || String(failure);
        return true;
      } finally {
        signal?.removeEventListener?.('abort', onAbort);
        if (request === controller) request = null;
      }
    },

    destroy() {
      layer.disable();
      rendering?.destroy();
      rendering = null;
      selection = null;
      viewer = null;
    },

    getStats() {
      return buildStats({
        payload,
        lastUpdate,
        error,
        droppedAreas: data.droppedAreas,
      });
    },
  };

  return layer;
}
```

- [ ] **Step 5: Write the application wrapper**

```js
// src/data/severeWeather.js
import { createSevereWeatherLayer as createLayer } from '../layers/severe-weather/index.js';
import {
  GDACS_CREDIT,
  NWS_ALERTS_CREDIT,
  registerDynamicCredit,
} from './dataCredits.js';
import { governorRequestRender } from '../renderGovernor.js';
import {
  clearSelectedEntityContextForLayer,
  registerEntityContext,
  removeEntityContextsForLayer,
  selectEntityContext,
} from './contextStore.js';
import {
  isOwnedByOtherLayer,
  registerPickOwner,
  resolvePickId,
  unregisterPickOwner,
} from './pickRegistry.js';
import {
  clearOverlaySource,
  hitTestWorldOverlay,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import { pickGround } from '../weatherReport/groundPick.js';

export * from '../layers/severe-weather/index.js';

/** Wire the application's overlay host, context store, pick registry, render governor and credits. */
export function createSevereWeatherLayer(options = {}) {
  return createLayer({
    overlayHost: {
      setEntries: setOverlayEntries,
      setVisible: setOverlaySourceVisible,
      clearSource: clearOverlaySource,
      hitTest: hitTestWorldOverlay,
    },
    context: {
      registerEntityContext,
      selectEntityContext,
      clearSelectedEntityContextForLayer,
      removeEntityContextsForLayer,
    },
    picking: {
      resolvePickId,
      isOwnedByOtherLayer,
      registerPickOwner,
      unregisterPickOwner,
    },
    pickGround,
    requestRender: governorRequestRender,
    registerCredit: registerDynamicCredit,
    credits: [NWS_ALERTS_CREDIT, GDACS_CREDIT],
    ...options,
  });
}

export default createSevereWeatherLayer();
```

- [ ] **Step 6: Run the layer tests to verify they pass**

Run: `node --test src/layers/severe-weather/index.test.mjs src/layers/severe-weather/model.test.mjs src/layers/severe-weather/rendering.test.mjs src/layers/severe-weather/selection.test.mjs`
Expected: PASS, 23 tests.

- [ ] **Step 7: Commit**

```bash
git add src/layers/severe-weather/index.js src/layers/severe-weather/index.test.mjs src/data/severeWeather.js src/data/dataCredits.js
git commit -m "feat(severe-weather): data layer lifecycle, services and credits" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Registration, share token, package wiring, docs, CI parity and smoke

**Files:**
- Modify:
  - `src/data/layerState.js`, `src/data/layerState.test.mjs`, `src/app/data.js`;
  - `package.json`, `scripts/package-boundaries.json`, `scripts/format-scope.json`;
  - `DATA_SOURCES.md`, `CHANGELOG.md`.

**Interfaces:**
- Consumes:
  - Task 7: the default export of `src/data/severeWeather.js`;
  - Task 3: `severeWeatherProxy()`, already registered;
  - `finalizeRegistrations(LAYER_STATE_REGISTRY)` in `src/app/data.js`, which requires a registry entry for every registered layer.
- Produces: the layer in the running app, share token `v`, documentation and a green CI-parity run.

Out of scope, as for the radar: the voice/OpenAI tool layer enums (`server/providers/openai/tools.js`, `src/voice/gevActions.js`).

- [ ] **Step 1: Write the failing registry test**

In `src/data/layerState.test.mjs`, in the test `'production registry is exact, canonical, and rejects incomplete contracts'`, **raise both expected counts by one from their current value.** They are `18` at `6462f0a`; if sub-projects 3 and 4 have merged, they are already higher. For example, at `6462f0a`:

```js
  assert.equal(REGISTERED_LAYER_IDS.length, 19);
  assert.equal(new Set(REGISTERED_LAYER_IDS).size, 19);
```

Append this test at the end of the file:

```js
test('severe weather is an enabled-only layer on share token v', () => {
  const state = createDefaultLayerState();
  assert.equal(Object.hasOwn(state.options, 'severe-weather'), false, 'no options');
  state.enabledLayerIds = ['severe-weather'];
  const params = encodeLayerStateParams(new URLSearchParams('v=2'), state);
  assert.equal(params.get('l'), 'v');
  assert.equal(String(params.get('lo') || '').split('_').some((entry) => entry.startsWith('v.')), false);
  assert.deepEqual(decodeLayerStateParams(new URLSearchParams('v=2&l=v')).enabledLayerIds, ['severe-weather']);
});
```

Run: `node --test src/data/layerState.test.mjs`
Expected: FAIL. The count is one short, and `params.get('l')` is `''` because token `v` is unknown.

- [ ] **Step 2: Add the registry entry**

In `src/data/layerState.js` `LAYER_STATE_REGISTRY`, directly after the `satellites` entry, add the line below. That keeps ids sorted, and token `v` is pre-assigned to this layer.

```js
  Object.freeze({ id: 'severe-weather', token: 'v', disposition: 'enabled-only' }),
```

Run: `node --test src/data/layerState.test.mjs`
Expected: PASS (the whole file).

- [ ] **Step 3: Register the layer**

In `src/app/data.js`, directly after `import earthquakesLayer from '../data/earthquakes.js';` add:

```js
import severeWeatherLayer from '../data/severeWeather.js';
```

Directly after `  dataManager.register(earthquakesLayer);` add:

```js
  dataManager.register(severeWeatherLayer);
```

- [ ] **Step 4: Package exports**

In `package.json` `exports`, directly after the entry

```json
    "./server/providers/weather-report": {
      "node": "./server/providers/weather-report.js"
    },
```

add:

```json
    "./server/providers/severe-weather": {
      "node": "./server/providers/severe-weather.js"
    },
```

and directly after `    "./weather-report": "./src/weatherReport/index.js",` add:

```json
    "./layers/severe-weather": "./src/layers/severe-weather/index.js",
```

- [ ] **Step 5: Boundary groups**

In `scripts/package-boundaries.json`:

1. Directly after the closing `},` of the `"weather-report-provider"` group, add:

```json
  "severe-weather-provider": {
    "runtime": "node",
    "exports": ["./server/providers/severe-weather"],
    "modules": [
      "server/providers/severe-weather.js",
      "server/providers/severe-weather/gdacs.js",
      "server/providers/severe-weather/geometry.js",
      "server/providers/severe-weather/nws.js",
      "server/providers/common/rate-limit.js",
      "server/providers/common/http.js"
    ],
    "external": []
  },
```

2. Directly after the closing `},` of the `"weather-report"` group, add:

```json
  "severe-weather-layer": {
    "exports": ["./layers/severe-weather"],
    "modules": [
      "src/layers/severe-weather/index.js",
      "src/layers/severe-weather/model.js",
      "src/layers/severe-weather/rendering.js",
      "src/layers/severe-weather/selection.js"
    ],
    "external": ["cesium"]
  },
```

3. In the `"application-components"` group's sorted `modules`, add `"src/data/severeWeather.js",` directly after `"src/data/scenePick.js",`. Add these directly after `"src/layers/satellites/tracking.js",`:

```json
      "src/layers/severe-weather/index.js",
      "src/layers/severe-weather/model.js",
      "src/layers/severe-weather/rendering.js",
      "src/layers/severe-weather/selection.js",
```

If an earlier sub-project inserted sorted entries between those anchors, place these entries in sorted order.

Run: `npm run check:boundaries`
Expected: exit 0, with these lines among the output (the application-components module count is whatever it was plus 5):

```text
Checked severe-weather-provider: 1 exports, 6 owned modules.
Checked severe-weather-layer: 1 exports, 4 owned modules.
```

If it reports `imports an unowned module`, the named file is a real import. Add it to that group's `modules` only if it is a shared helper, never another layer's module.

- [ ] **Step 6: Formatting scope**

Append these entries at the end of the JSON array in `scripts/format-scope.json`, adding a comma to the previous last entry:

```json
  "server/providers/severe-weather.js",
  "server/providers/severe-weather/gdacs.js",
  "server/providers/severe-weather/geometry.js",
  "server/providers/severe-weather/nws.js",
  "src/data/severeWeather.js",
  "src/data/severeWeatherGdacs.test.mjs",
  "src/data/severeWeatherNws.test.mjs",
  "src/data/severeWeatherProxy.test.mjs",
  "src/layers/severe-weather/index.js",
  "src/layers/severe-weather/index.test.mjs",
  "src/layers/severe-weather/model.js",
  "src/layers/severe-weather/model.test.mjs",
  "src/layers/severe-weather/rendering.js",
  "src/layers/severe-weather/rendering.test.mjs",
  "src/layers/severe-weather/selection.js",
  "src/layers/severe-weather/selection.test.mjs"
```

Run: `npm run format`, then `npm run format:check`
Expected: the check exits 0. The new files were written already formatted, so `git diff --stat` should show no formatter changes to them.

- [ ] **Step 7: Documentation**

In `DATA_SOURCES.md`, in the live-sources table, directly after the `**Iowa Environmental Mesonet**` row, add:

```markdown
| **National Weather Service** active alerts (`api.weather.gov/alerts/active`) and forecast, county and fire zone shapes (`api.weather.gov/zones/…`) | Severe Weather layer: US warnings, watches, advisories and statements drawn over their zones | U.S. Government public domain; [api.weather.gov usage](https://www.weather.gov/documentation/services-web-api): identifying User-Agent, undisclosed rate limit (retry after about 5 s). Alerts cached 5 minutes; zone shapes simplified and cached 7 days under `.gev-cache/severe-weather/` | "US weather alerts: National Weather Service (NOAA, public domain)", registered when the layer is first enabled |
| **GDACS** — Global Disaster Alert and Coordination System (`gdacs.org/gdacsapi` EVENTS4APP and cyclone MAP) | Severe Weather layer: tropical cyclones (track and forecast cone), floods, droughts, volcanoes and wildfires worldwide; GDACS earthquakes are excluded | [GDACS disclaimer and terms of use](https://www.gdacs.org/About/termofuse.aspx): European Commission JRC and UN OCHA; provided "as is", indicative, not a substitute for official alerts. Cached 15 minutes | "Global disaster alerts: GDACS, European Commission JRC and UN OCHA (indicative, not official warnings)", registered when the layer is first enabled |
```

At the top of `CHANGELOG.md`, directly under `# Changelog` and its blank line, add:

```markdown
## Severe weather layer (fork)

- Add a Severe Weather layer: National Weather Service active alerts across the US, drawn over
  their forecast, county and fire zones and coloured as warning, watch, advisory or statement,
  plus GDACS tropical cyclones (track and forecast cone), floods, droughts, volcanoes and
  wildfires worldwide. GDACS earthquakes are left to the Earthquakes layer.
- Click an area or event for a card with its details; click the card to open the weather.gov
  forecast page for that spot or the GDACS report.
- Served by a new `/api/severe-weather` proxy: alerts cached 5 minutes, GDACS 15 minutes, zone
  shapes simplified and kept on disk for 7 days; a failed source's last data is kept for an hour.
  The layer row reports each source's count and any stale or unavailable source. Share token `v`.

```

- [ ] **Step 8: Run the full CI-parity sequence**

Run each in order, stopping at the first failure:

```bash
npm run format:check
npm run check:boundaries
npm test
npm run build
```

Expected: all four exit 0. `npm test` discovers every `src/**/*.test.mjs`. In the planner's validation at `6462f0a` it reported 3,555 tests, 3,548 passed, 0 failed and 7 skipped.

- [ ] **Step 9: Smoke-check the proxy once against the live sources**

This makes one NWS alerts request, the GDACS requests, and at most one request per zone not yet on disk: 959 zones, about 12 s, on a cold cache. Do not repeat it; api.weather.gov asks for restraint. Do not open the app in a browser, because that would consume a limited AISStream connection.

1. Start the dev server in the background with `npx vite --port 5199 --strictPort`.
2. Run:

```bash
curl -s --max-time 90 http://localhost:5199/api/severe-weather | node -e "let s='';process.stdin.on('data',(c)=>s+=c).on('end',()=>{const j=JSON.parse(s);console.log(JSON.stringify({nws:[j.nws.status,j.nws.alerts.length,Object.keys(j.nws.zones).length,j.nws.unmappedAlerts],gdacs:[j.gdacs.status,j.gdacs.events.length,j.gdacs.events.some((e)=>e.type==='EQ')]}))})"
ls .gev-cache/severe-weather/zones | wc -l
```

Expected:
- `nws` is `["ok", <alerts>, <zones>, <unmapped>]`, where alerts and zones are in the hundreds and `unmapped` is 0. It may be above 0 only if api.weather.gov throttled the cold fetch; then a second request after 5 minutes resolves the rest.
- `gdacs` is `["ok", <events>, false]`.
- The zone count on disk equals the `zones` number or more.

3. Stop the dev server by its port listener: the backgrounded job's PID is not the listener. In PowerShell run `netstat -ano | findstr :5199`, then `taskkill /PID <pid> /F`. Confirm that `curl -s http://localhost:5199/` fails with "connection refused".

- [ ] **Step 10: Commit**

```bash
git add src/data/layerState.js src/data/layerState.test.mjs src/app/data.js package.json scripts/package-boundaries.json scripts/format-scope.json DATA_SOURCES.md CHANGELOG.md
git status --short
git commit -m "feat(severe-weather): register the layer, share token, boundaries and docs" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

Check `git status --short` before committing. Stage only files this plan changed, plus any formatting reflow `npm run format` made to them. Never stage `.gev-cache/`.
