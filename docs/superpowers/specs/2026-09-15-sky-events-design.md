# Sky events: aurora, day and night, meteor showers — design

Status: in progress (2026-09-15)
Fork: CaptPat/gods-eye-view (Cyclops View). Fork-only work; nothing is proposed upstream.

## Place in the celestial work

This is celestial sub-project 2 of 3:

1. **Strange things.** UFO Incidents and Fireballs. Built and merged at `96552cb`.
2. **Sky events** (this document). These are layers placed on the Earth and driven by the sky.
3. **Night sky.** Stars, constellations, planets and deep-sky objects drawn on the sky dome.

The share-link layer list holds at most 32 layers, and 25 are used after sub-project 1. This
sub-project adds three layers, using tokens `1`, `2` and `3`. Sub-project 3 will add a single
Night Sky layer with options.

## Layers

| Layer id | Name | Token | Source | Refresh |
|---|---|---|---|---|
| `aurora-forecast` | Aurora Forecast | `1` | NOAA SWPC OVATION through `/api/aurora` | Proxy caches 5 min; layer checks every 5 min |
| `day-night` | Day & Night | `2` | Computed locally (Cesium Simon1994 Sun and Moon) | Every 2 min |
| `meteor-showers` | Meteor Showers | `3` | Bundled IMO working-list table (2026 dates) | Positions recomputed every 2 min |

All three go in the Layers panel's "Sky" group.

## Sources (measured 2026-09-15)

### NOAA SWPC OVATION aurora

`GET https://services.swpc.noaa.gov/json/ovation_aurora_latest.json`

- The response is HTTP 200, 918 KB, `Access-Control-Allow-Origin: *`, `Cache-Control: max-age=60`.
- It has the keys `Observation Time`, `Forecast Time`, `Data Format` (`"[Longitude, Latitude, Aurora]"`),
  `type` (`MultiPoint`) and `coordinates`.
- `coordinates` holds 65,160 triplets: longitude 0–359 (outer loop) × latitude −90…90 (inner),
  on a 1° grid. The value is aurora probability in percent.
- At 11:39Z, during quiet conditions, the maximum was 12%. Cells at 10% or more lay between 68–72°N and 53–60°S.

### Meteor showers

The IMO site was offline after a cyberattack, so its table was not fetched directly. Wikipedia's "List of meteor
showers" reproduces the IMO working list with 2026 dates: activity window, peak, radiant RA (hours) and
Dec, speed, ZHR and parent body. The layer bundles the 37 established showers; the antihelion source is
excluded because its radiant varies. Twenty-five showers link to their own English Wikipedia article (checked
with HTTP 200; both Taurid branches share "Taurids", and the October Draconids use "Draconids"). The
rest link to the list page.

## Rendering

**Grid bands** (`src/layers/grid-bands`) are shared by Aurora and Day & Night.

- **Why rectangles.** A value grid becomes run-length rectangles: consecutive cells in a latitude row at the
  same level merge into one rectangle.
  - Runs are capped at 90° of longitude and split at the antimeridian.
  - This avoids Cesium polygons that surround a pole or span more than 180°, which the auroral oval
    and the night hemisphere both do.
- **How they are drawn.** Rectangles are entities with `classificationType: BOTH`, as the severe-weather
  fills are. They drape on both the globe and the photoreal 3D tiles.
- **Why entities.** Constructing a `GroundPrimitive` directly works under Node, but its terrain-height
  initialisation later rejects without a scene.

**Aurora.**
- The server turns the grid into bands at 5, 10, 30 and 50%, coloured from pale green up to magenta.
- The client draws the bands.
- The row shows the peak probability and the forecast time.

**Day & Night.**
- Every 2 minutes the layer computes where the Sun is overhead: Simon1994 inertial position,
  then the TEME-to-pseudo-fixed rotation. ICRF-to-fixed is avoided because it starts an
  asynchronous IAU 2006 XYS data fetch; the ~0.4° it would gain is below the 1° band cell.
- A 1° grid classifies each cell by solar altitude: civil twilight (0 to −6°), nautical (−6 to −12°),
  astronomical (−12 to −18°) and night (below −18°). Alpha darkens with each step.
- Two labelled points mark where the Sun and the Moon are overhead. The Moon's label gives its
  illuminated fraction and whether it is waxing or waning.

**Meteor Showers.**
- The layer uses the catalog-points layer.
- Each shower active today (the activity window may wrap past New Year) gets one point directly below
  its radiant. Latitude is the radiant's Dec. Longitude is RA × 15 minus GMST.
- The card shows the peak, ZHR, speed, activity window, parent body and the latitudes that see the
  radiant at least 30° high.

## Testing

Each module is written test-first:
- pure band building (antimeridian split, pole clamp, run cap);
- the OVATION normalizer and `/api/aurora` handler (cache, stale fallback, 502);
- aurora band colours;
- solar altitude classification and subsolar and sublunar points (June 2026 solstice declination);
- GMST and sub-radiant positions (J2000 reference);
- active-window wrap;
- shower cards;
- layer lifecycles, using the catalog-points and severe-weather harness patterns.

Full CI parity runs before merge.
