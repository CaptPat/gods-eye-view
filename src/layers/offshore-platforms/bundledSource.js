// BSEE Data Center platform and company files (U.S. Government work, public
// domain), joined by `node scripts/build-bsee-platforms.mjs`. A literal URL so
// Vite emits the asset.
export const OFFSHORE_PLATFORMS_SNAPSHOT_URL = new URL(
  '../../data/local_data/offshore_platforms/offshore-platforms.json',
  import.meta.url,
).href;
