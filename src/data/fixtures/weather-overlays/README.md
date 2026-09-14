# Weather overlays fixtures

Recorded 2026-09-14 (about 16:00-16:30 UTC) while designing the Weather Overlays layer
(`docs/superpowers/specs/2026-09-14-weather-overlays-design.md`). Used only by the
`src/data/weatherOverlays*.test.mjs` tests; never served to the app. No API key appears in any
file or URL below.

- `gmgsi-capabilities.xml`: NOAA nowCOAST satellite WMS 1.3.0 capabilities
  (`https://nowcoast.noaa.gov/geoserver/satellite/ows?service=WMS&request=GetCapabilities&version=1.3.0`),
  trimmed to the one `global_longwave_imagery_mosaic` layer. Its time dimension lists
  10:00-15:00 UTC hourly. U.S. Government work.
- `gmgsi-longwave-tile.png`: one 256 x 256 GetMap tile of that layer at 15:00 UTC, EPSG:3857 web
  mercator tile z9/x121/y212 (Galveston Bay), 6,271 bytes, 8-bit gray+alpha.
- `gfs-tmp2m-30deg.csv`: PacIOOS ERDDAP `ncep_global.csvp`, `tmp2m` (kelvin) at
  2026-09-14T15:00:00Z with a stride of 60 (a 30° grid: 7 latitudes x 12 longitudes, 84 rows).
  NOAA NCEP GFS; free use and redistribution per the dataset licence.
- `google-air-quality-tile.png`: Google Air Quality `US_AQI` heatmap tile z16 over Houston
  (a single-colour 856-byte tile). Recorded with the fork's key; the key is not stored.
- `google-pollen-tile.png`: Google Pollen `GRASS_UPI` heatmap tile z16 over Houston
  (single colour, 914 bytes).
- `google-invalid-map-type.json`: the HTTP 400 body Google returns for an unknown map type.
- `google-no-key.json`: the HTTP 403 body Google returns when no key is sent.
