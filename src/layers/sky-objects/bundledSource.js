// d3-celestial Messier catalogue (BSD-3-Clause), trimmed by `node scripts/build-night-sky.mjs`.
export const SKY_OBJECTS_MESSIER_URL = new URL(
  '../../data/local_data/night_sky/messier.json',
  import.meta.url,
).href;

/** The 110 Messier rows; throws on HTTP failure or abort. */
export async function loadMessierCatalogue({
  fetchImpl = (...args) => fetch(...args),
  signal,
} = {}) {
  signal?.throwIfAborted();
  const response = await fetchImpl(SKY_OBJECTS_MESSIER_URL, {
    signal,
    cache: 'force-cache',
  });
  if (!response.ok) {
    try {
      await response.body?.cancel();
    } catch {
      /* best effort */
    }
    throw new Error(`HTTP ${response.status} for ${SKY_OBJECTS_MESSIER_URL}`);
  }
  const rows = await response.json();
  signal?.throwIfAborted();
  return rows;
}
