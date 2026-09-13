# Test fixtures

- `tomtom-flow-austin-12-935-1686.pbf` — one real TomTom traffic-flow vector
  tile (Mapbox Vector Tile protobuf, layer `"Traffic flow"`), downtown Austin
  z12 x935 y1686, captured 2026-07-16 from
  `api.tomtom.com/traffic/map/4/tile/flow/relative/12/935/1686.pbf`
  (22,980 bytes). Used ONLY by `src/data/flowTiles.test.mjs` to pin MVT
  decoding offline — it is a point-in-time congestion snapshot, not a bundled
  data layer, and is never served to the app. © TomTom.
- `nominatim-search.json` — real Nominatim search responses
  (`nominatim.openstreetmap.org/search`, `format=jsonv2`, `limit=1`,
  `accept-language=en`), captured 2026-09-13 for ten queries covering every
  camera-framing category: a country, a state, a city, an emirate, a suburb, a
  street with and without an Austin view bias, a park, a mountain range and a
  landmark. Used ONLY by `src/geocodeOsm.test.mjs` and
  `src/geocodeSearchProxy.test.mjs` to pin the OpenStreetMap geocode fallback
  offline — it is never served to the app. © OpenStreetMap contributors,
  ODbL 1.0.
