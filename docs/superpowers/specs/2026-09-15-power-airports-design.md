# Power Plants and Airports — design

Status: in progress (2026-09-15)
Fork: CaptPat/gods-eye-view (Cyclops View). Fork-only work; nothing is proposed upstream.

This is wave 2 of the infrastructure and heritage work (see `2026-09-15-nuclear-layers-design.md`).

## Layers

| Layer id | Name | Token | Records | Group |
|---|---|---|---|---|
| `power-plants` | Power Plants | `9` | 27,780 non-hydro plants | Energy |
| `airports` | Airports | `0` | 5,280 large and medium airports | Infrastructure |

These take the last two digit tokens. Later layers use uppercase letters.

## Sources

### WRI Global Power Plant Database v1.3.0

- **Licence:** CC BY 4.0.
- **Download:** `output_database/global_power_plant_database.csv` from `wri/global-power-plant-database`,
  34,936 rows.
- **Filter:** hydro (7,156) is excluded; dams already have a layer.
- **Fuels kept:** Solar 10,664, Wind 5,344, Gas 3,998, Coal 2,330, Oil 2,320, Biomass 1,430, Waste 1,068,
  Nuclear 195, Geothermal 189, Storage 135, and a handful of other fuels.
- **Fields kept:** id, name, primary fuel, capacity (MW), latitude, longitude, country, commissioning year,
  owner.
- **Size:** 2.8 MB of JSON (0.77 MB gzipped), fetched only when the layer is enabled.
- **Age:** the database was last released in 2021.

### OurAirports

- **Licence:** public domain.
- **Download:** `airports.csv`, 86,080 rows.
- **Filter:** large (1,174) and medium (4,106) airports only.
- **Code coverage:** 4,747 have an ICAO code, 4,569 an IATA code, and 3,269 have scheduled service.
- **Fields kept:** ident, size, name, ICAO, IATA, latitude, longitude, elevation (ft), municipality,
  country, scheduled service, Wikipedia link.
- **Size:** 494 KB (181 KB gzipped).

## Build

`scripts/build-csv-layers.mjs` downloads both CSVs and writes compact snapshots under
`src/data/local_data/power_plants/` and `src/data/local_data/airports/`:
`{ source, license, retrievedAt, fields, rows }`.

The parsing and trimming are pure and tested:
- `src/layers/csv-points/csv.js` is an RFC 4180 CSV parser;
- the `normalize*` functions live in each layer's `source.js`.

## Presentation

Both layers use `src/layers/catalog-points`.

**Power plants.**
- Colour by primary fuel: coal grey, gas orange, oil purple, nuclear yellow, wind cyan, solar pale yellow,
  biomass green, and so on.
- Size by capacity: 3 px at 1 MW, 1.5 px more per tenfold, capped at 10.
- The card gives fuel and MW, owner, commissioning year and country.
- The card has no link, because the database has no per-plant page.

**Airports.**
- Large airports white at 7 px, medium pale blue at 5 px.
- The card gives the ICAO and IATA codes, size and scheduled service, city, country and elevation.
- It links to Wikipedia when OurAirports has an article, and to the airport's OurAirports page otherwise.

Airports have ICAO and IATA location codes. Radio call signs belong to airlines and are not part of this
layer.
