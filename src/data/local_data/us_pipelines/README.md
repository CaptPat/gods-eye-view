# US pipelines snapshot

`us-pipelines.json` combines two public-domain U.S. Government sources.

The [EIA U.S. Energy Atlas](https://atlas.eia.gov/) provides three pipeline layers:

- natural gas interstate and intrastate pipelines;
- crude oil trunk pipelines;
- hydrocarbon gas liquids pipelines.

The offshore data joins two sources:

- **Geometry:** offshore pipeline segments from the BOEM/BSEE map service.
- **Attributes:** the [BSEE Data Center](https://www.data.bsee.gov/Main/Pipeline.aspx) Pipeline Masters file and company list.

Attribution: U.S. Energy Information Administration; Bureau of Ocean Energy Management; Bureau of Safety and Environmental Enforcement.

- **Rows (September 2026):** 20,999 lines with 64,951 vertices in total:
  - interstate gas: 8,031
  - intrastate gas: 9,156
  - HGL: 127
  - crude trunk: 233
  - offshore gas: 1,510
  - offshore oil: 1,942
- **Simplification:**
  - EIA geometry is simplified to 0.02° and offshore geometry to 0.005°.
  - Positions are rounded to 0.001°.
  - Connected segments with identical attributes are chained into one line. Junctions stay as breaks.
- **Offshore filter:** only segments that are active (`ACT`) or out of service (`OUT`), and that carry an oil or gas product. Abandoned, removed and proposed segments are excluded. So are water, chemical, umbilical, cable, casing, service and tow lines.
- **Format:** compact `{ source, license, retrievedAt, fields, rows }`. Fields are id, kind, name, operator, route, product, size (inches), status and positions (flat `[lon, lat, …]`).

Rebuild with:

```sh
node scripts/build-us-pipelines.mjs
```
