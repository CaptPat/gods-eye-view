// Wikidata snapshots (CC0-1.0). Rebuild with `node scripts/build-wikidata-layers.mjs heritage`.
// Each URL is a literal so Vite emits the asset.
export const HERITAGE_SNAPSHOT_URLS = Object.freeze({
  worldHeritage: new URL(
    '../../data/local_data/heritage/world-heritage.json',
    import.meta.url,
  ).href,
  forts: new URL(
    '../../data/local_data/heritage/forts-castles.json',
    import.meta.url,
  ).href,
  parks: new URL(
    '../../data/local_data/heritage/parks-monuments.json',
    import.meta.url,
  ).href,
});
