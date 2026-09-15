/** Read one bundled JSON asset, preferring the HTTP cache; throws on HTTP failure or abort. */
export async function loadBundledJson(
  url,
  { fetchImpl = (...args) => fetch(...args), signal } = {},
) {
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
