# Airports snapshot

`airports.json` is a trimmed copy of [OurAirports](https://ourairports.com/data/) `airports.csv`, which is
released to the public domain.

- **Rows:** large and medium airports only.
- **Format:** compact `{ source, license, retrievedAt, fields, rows }`.
- **Fields:** ident, size, name, ICAO code, IATA code, latitude, longitude (4 decimals), elevation (ft),
  municipality, ISO country, scheduled service, Wikipedia link.

Rebuild with:

```sh
node scripts/build-csv-layers.mjs
```
