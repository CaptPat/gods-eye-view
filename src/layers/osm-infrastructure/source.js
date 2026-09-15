export const OVERPASS_URL = '/api/overpass';

function refusalMessage(status) {
  if (status === 429) return 'Overpass rate-limited';
  if (status === 504) return 'Overpass timed out';
  return 'Overpass temporarily unavailable';
}

/**
 * POST Overpass QL to the shared proxy. Resolves `{ elements, stale }`, where
 * stale means the proxy answered from its fallback cache; refusals and
 * incomplete answers (an Overpass `remark`) throw readable errors.
 */
export function createOsmInfrastructureSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    async fetch(query, signal) {
      signal?.throwIfAborted();
      const response = await fetchImpl(OVERPASS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal,
      });
      signal?.throwIfAborted();
      if (!response.ok) throw new Error(refusalMessage(response.status));
      const body = await response.json();
      signal?.throwIfAborted();
      if (!Array.isArray(body?.elements) || body.remark)
        throw new Error('Overpass answer incomplete — zoom in');
      return {
        elements: body.elements,
        stale: response.headers?.get?.('x-overpass-cache') === 'STALE',
      };
    },
  };
}
