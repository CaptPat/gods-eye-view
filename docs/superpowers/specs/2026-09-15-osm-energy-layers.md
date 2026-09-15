# Transmission Lines and Oil & Gas layers

Two Energy-group layers drawn from live OpenStreetMap data. Nothing is bundled; each view is fetched through the existing `/api/overpass` proxy.

## Why live, not a snapshot

Mapped power lines and pipelines cover millions of ways. On the NAS Overpass instance, a 1°×1° box around Austin returned 1,832 power elements (1.6 MB), and a 2°×2° box around Houston returned 6,440 pipeline, well and platform elements (10.9 MB). A global snapshot would be far too large to bundle, so the layers load only what a small view needs.

## Shared package: `src/layers/osm-infrastructure`

- **`query.js`**
  - `viewBoxFromRectangle(rect, maxDegrees)` rejects views that are too large, invalid, or cross the antimeridian.
  - `snapViewBox` snaps outward to a 0.05° grid, so nearby views share one proxy cache entry.
  - `buildOverpassQuery(selectors, box, cap)` bounds every selector by the box, as the proxy sanitizer requires, and requests `out tags geom <cap>`.
- **`elements.js`**
  - `normalizeOsmElements` turns ways the line classifier accepts into lines with `[lon, lat]` positions, thinned to 400 vertices.
  - Nodes, and ways or relations the point classifier accepts, become points at their vertex mean or bounds centre.
  - Feature ids are `<type>/<id>`, the same form openstreetmap.org URLs use.
- **`source.js`**
  - Sends the query as a POST form body.
  - A `STALE` cache header marks the answer stale.
  - Proxy statuses 429, 504 and other errors become readable messages. An Overpass `remark` or a malformed `elements` array counts as an incomplete answer.
- **`rendering.js`**
  - Draws one `CustomDataSource` of ground-clamped polylines and depth-test-free points.
  - Points have no `heightReference`, following the severe-weather lesson.
  - It rebuilds only when the feature set changes, highlights the selection, and keeps requesting frames until ground geometry is built.
- **`layer.js`**
  - The camera's `moveEnd` event triggers a load after 500 ms.
  - The view box is centred on the ground point at screen centre, and its half-width equals the camera's range.
  - A view that is too large reports `zoom-in` guidance.
  - A view inside the last box reuses its features for 10 minutes. A settle inside a box already in flight waits for that request.
  - When the element count reaches the cap, the layer reports a coverage notice.
  - Failures keep the features already drawn.
  - Clicking a feature pins a selected card. A line card anchors at the clicked ground point, a point card at the point, and the card opens openstreetmap.org.
  - Legend rows count features by style colour.

## Layers

| Layer | Token | Max view | Cap | Selectors |
| --- | --- | --- | --- | --- |
| Transmission Lines | `L` | 1.5° | 2,500 | `way[power~line\|minor_line\|cable]`, `nwr[power~substation\|plant]` |
| Oil & Gas | `G` | 1° | 3,000 | `way[man_made=pipeline][substance!~water-like]`, `node[man_made=petroleum_well]`, `nwr[man_made=offshore_platform]`, `nwr[industrial~refinery\|oil\|gas]` |

- **Transmission Lines** styles lines by the highest voltage in the `;`-separated `voltage` tag:

  | Voltage | Colour | Width |
  | --- | --- | --- |
  | ≥500 kV | `#ff006e` | 4 |
  | ≥220 kV | `#fb5607` | 3 |
  | ≥110 kV | `#ffbe0b` | 2.5 |
  | ≥33 kV | `#8ecae6` | 2 |
  | Lower or unknown | `#adb5bd` | 1.5 |

  Substations and plants are points. Cards give voltage, circuits, kind, operator, plant source and output.
- **Oil & Gas** classifies pipeline substance, checking oil before gas so `gasoline` counts as oil:

  | Substance | Colour |
  | --- | --- |
  | Gas | `#ffb703` |
  | Oil and fuels | `#8338ec` |
  | Other or unknown | `#adb5bd` |

  Wells, platforms, refineries and oil and gas works are points. Cards give substance, location, diameter and operator.

## Attribution

`OSM_INFRASTRUCTURE_CREDIT` reads "© OpenStreetMap contributors (ODbL 1.0), via Overpass". It is registered when either layer is first enabled.

## Not in scope

- Oil and gas fields and reserves: the GEM extraction tracker download sits behind a form.
- EIA pipeline and BOEM platform datasets.
- Sea ice.

These remain follow-ups.
