// Wikidata snapshots (CC0-1.0). Rebuild with `node scripts/build-wikidata-layers.mjs`.
// Each URL is a literal so Vite emits the asset.
export const NUCLEAR_SNAPSHOT_URLS = Object.freeze({
  plants: new URL(
    '../../data/local_data/nuclear/nuclear-power-plants.json',
    import.meta.url,
  ).href,
  waste: new URL(
    '../../data/local_data/nuclear/nuclear-waste-sites.json',
    import.meta.url,
  ).href,
  accidents: new URL(
    '../../data/local_data/nuclear/nuclear-accidents.json',
    import.meta.url,
  ).href,
});

/** One bundled nuclear snapshot; throws on an unknown kind, HTTP failure or abort. */
export async function loadNuclearSnapshot(
  kind,
  { fetchImpl = (...args) => fetch(...args), signal } = {},
) {
  const url = NUCLEAR_SNAPSHOT_URLS[kind];
  if (!url) throw new TypeError(`Unknown nuclear snapshot: ${kind}`);
  signal?.throwIfAborted();
  const response = await fetchImpl(url, { signal, cache: 'force-cache' });
  if (!response.ok) {
    try {
      await response.body?.cancel();
    } catch {
      /* best effort */
    }
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  const json = await response.json();
  signal?.throwIfAborted();
  return json;
}
