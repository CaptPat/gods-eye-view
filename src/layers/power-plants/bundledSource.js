// WRI Global Power Plant Database v1.3.0 (CC BY 4.0), trimmed by
// `node scripts/build-csv-layers.mjs`. A literal URL so Vite emits the asset.
export const POWER_PLANTS_SNAPSHOT_URL = new URL(
  '../../data/local_data/power_plants/power-plants.json',
  import.meta.url,
).href;
