# Weather overlays fixtures

Recorded 2026-09-14 (about 16:00-16:30 UTC) while designing the Weather Overlays layer (now Air Quality)
(`docs/superpowers/specs/2026-09-14-weather-overlays-design.md`). Used only by the
`src/data/weatherOverlays*.test.mjs` tests; never served to the app. No API key appears in any
file or URL below.

- `google-air-quality-tile.png`: Google Air Quality `US_AQI` heatmap tile z16 over Houston
  (a single-colour 856-byte tile). Recorded with the fork's key; the key is not stored.
- `google-pollen-tile.png`: Google Pollen `GRASS_UPI` heatmap tile z16 over Houston
  (single colour, 914 bytes).
- `google-invalid-map-type.json`: the HTTP 400 body Google returns for an unknown map type.
- `google-no-key.json`: the HTTP 403 body Google returns when no key is sent.
