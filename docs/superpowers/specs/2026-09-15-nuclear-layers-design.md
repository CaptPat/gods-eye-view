# Nuclear layers: power plants, waste sites, accidents — design

Status: in progress (2026-09-15)
Fork: CaptPat/gods-eye-view (Cyclops View). Fork-only work; nothing is proposed upstream.

## Place in the infrastructure and heritage work

This is the first of the point-catalogue waves that the layer-capacity change (`5713b20`, 62 share-link
layers) makes room for:

1. **Nuclear** (this document): Nuclear Power Plants, Nuclear Waste Sites, Nuclear Accidents.
2. **Power Plants** (WRI Global Power Plant Database, no hydro) and **Airports** (OurAirports).
3. **Historic Sites & Forts** and **National Parks & Monuments** (Wikidata).
4. **Transmission Lines** and **Oil & Gas** from OpenStreetMap through the NAS Overpass instance.
5. EIA pipelines, BOEM platforms, and GEM oil and gas fields.
6. Sea ice.

## Layers

| Layer id | Name | Token | Records (measured 2026-09-15) |
|---|---|---|---|
| `nuclear-power-plants` | Nuclear Power Plants | `6` | 379 located Wikidata nuclear power plants |
| `nuclear-waste-sites` | Nuclear Waste Sites | `7` | 65 located radioactive-waste and deep geological repositories |
| `nuclear-accidents` | Nuclear Accidents | `8` | 48 located nuclear accidents and disasters |

All three join a new "Energy" group in the Layers panel. Digit tokens go first, because they cannot be
case-folded.

## Sources

Every record comes from a Wikidata SPARQL query. Wikidata is CC0, so the results are bundled as
snapshots under `src/data/local_data/nuclear/`, rebuilt by `scripts/build-wikidata-layers.mjs`.

**Nuclear power plants.** Items of class "nuclear power plant" (P31) that have a coordinate (P625).
- Coverage: 266 have a state of use (P5817), 256 an installed capacity (P2109), 241 an operator (P137),
  285 a service entry or inception date (P729/P571), 104 a retirement date (P730/P576) and 329 an
  English Wikipedia article.
- A plant often has several values for a property, one per unit or era: Chernobyl has several rows.
  States are kept as a list, capacity takes the maximum, the start year the earliest and the end year
  the latest.

**Waste sites.** Classes "radioactive waste repository" and "deep geological repository". An item
without its own coordinate falls back to the coordinates of its location (P276) or administrative
area (P131), and is marked approximate.

**Accidents.** Classes "nuclear accident" and "nuclear disaster".
- Fields: date (P585/P580), deaths (P1120) and the International Nuclear Event Scale (P2127) as an item
  labelled "INES level N event".
- 13 items carry INES: Chernobyl and Fukushima Daiichi at 7, Kyshtym at 6, Windscale and Three Mile
  Island at 5.

## Shared normaliser

`src/layers/wikidata-points/normalize.js` merges bindings per item. It keeps an item only if it has
an English label that is not a bare QID and a location, preferring the item's own coordinate over its
place. Each field is declared as text, number, year or list, with a first, minimum or maximum pick.
The UFO Incidents normaliser predates it and keeps its own code for now.

## Presentation

Every layer uses `src/layers/catalog-points`.

**Power plants**
- Colour by derived status: operating yellow, under construction cyan, planned purple, decommissioned
  grey, cancelled dark grey.
- A retirement year means decommissioned, unless the plant is still marked in use.
- Size by capacity.
- The card gives status and MW, operator, service years and country.

**Waste sites**
- Violet points.
- The card gives the kind, country and description.

**Accidents**
- Colour and size by INES level, from 3 (amber) to 7 (red). Accidents without a level are orange.
- The card gives INES and date, deaths and description.

Cards open English Wikipedia, or Wikidata when there is no article.
