// OurAirports (public domain), trimmed by `node scripts/build-csv-layers.mjs`.
// A literal URL so Vite emits the asset.
export const AIRPORTS_SNAPSHOT_URL = new URL(
  '../../data/local_data/airports/airports.json',
  import.meta.url,
).href;
