// d3-celestial catalogue (BSD-3-Clause, see LICENSE-d3-celestial.txt), trimmed by
// `node scripts/build-night-sky.mjs`. Each URL is a literal so Vite emits the asset.
export const NIGHT_SKY_DATA_URLS = Object.freeze({
  stars: new URL('../../data/local_data/night_sky/stars.json', import.meta.url)
    .href,
  names: new URL(
    '../../data/local_data/night_sky/star-names.json',
    import.meta.url,
  ).href,
  constellations: new URL(
    '../../data/local_data/night_sky/constellations.json',
    import.meta.url,
  ).href,
});

async function readJson(fetchImpl, url, signal) {
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
  return response.json();
}

/** Stars, named stars and constellation figures; throws on HTTP failure or abort. */
export async function loadNightSkyCatalogue({
  fetchImpl = (...args) => fetch(...args),
  signal,
} = {}) {
  const [stars, names, constellations] = await Promise.all([
    readJson(fetchImpl, NIGHT_SKY_DATA_URLS.stars, signal),
    readJson(fetchImpl, NIGHT_SKY_DATA_URLS.names, signal),
    readJson(fetchImpl, NIGHT_SKY_DATA_URLS.constellations, signal),
  ]);
  signal?.throwIfAborted();
  return { stars, names, constellations };
}
