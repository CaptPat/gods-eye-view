// EIA U.S. Energy Atlas pipelines and BSEE offshore pipeline segments (U.S.
// Government works, public domain), simplified and joined by
// `node scripts/build-us-pipelines.mjs`. A literal URL so Vite emits the asset.
export const US_PIPELINES_SNAPSHOT_URL = new URL(
  '../../data/local_data/us_pipelines/us-pipelines.json',
  import.meta.url,
).href;
