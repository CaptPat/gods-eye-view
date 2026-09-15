# Power plants snapshot

`power-plants.json` is a trimmed copy of the
[WRI Global Power Plant Database](https://datasets.wri.org/dataset/globalpowerplantdatabase) v1.3.0,
used under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Attribution: World Resources
Institute, *Global Power Plant Database*.

- **Rows:** every plant except hydro, which is excluded because dams already have their own layer.
- **Format:** compact `{ source, license, retrievedAt, fields, rows }`.
- **Fields:** id, name, primary fuel, capacity (MW), latitude, longitude (4 decimals), country,
  commissioning year, owner.
- **Age:** the database was last released in 2021, so newer plants are missing.

Rebuild with:

```sh
node scripts/build-csv-layers.mjs
```
