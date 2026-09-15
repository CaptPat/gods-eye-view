// Wikidata snapshot (CC0-1.0). Rebuild with `node scripts/build-ufo-incidents.mjs`.
export const UFO_SNAPSHOT_URL = new URL(
  '../../data/local_data/ufo_incidents/ufo-incidents.json',
  import.meta.url,
).href;

/** Read the bundled UFO incidents snapshot; throws on HTTP failure or abort. */
export async function loadUfoSnapshot({
  fetchImpl = (...args) => fetch(...args),
  signal,
} = {}) {
  signal?.throwIfAborted();
  const response = await fetchImpl(UFO_SNAPSHOT_URL, {
    signal,
    cache: 'force-cache',
  });
  if (!response.ok) {
    try {
      await response.body?.cancel();
    } catch {
      /* best effort */
    }
    throw new Error(`HTTP ${response.status} for ${UFO_SNAPSHOT_URL}`);
  }
  const json = await response.json();
  signal?.throwIfAborted();
  return json;
}
