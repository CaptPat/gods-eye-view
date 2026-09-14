import { boundsToViewbox } from '../geocodeOsm.js';
import { normalizeGooglePlace } from './google.js';

/**
 * Keyless place search through the local /api/geocode/search route (Nominatim).
 *
 * The route answers in Google's geocode structure, so the Google normalizer
 * reads it. An OpenStreetMap result has no address_components, so the name the
 * annotation resolver matches OSM features on is the label's first segment.
 */
export function createNominatimGeocoder({
  fetchImpl = (...args) => fetch(...args),
  endpoint = '/api/geocode/search',
} = {}) {
  return {
    async geocode(query, { bias = null, signal } = {}) {
      signal?.throwIfAborted();
      try {
        const params = new URLSearchParams({ q: query });
        const viewbox = boundsToViewbox(bias);
        if (viewbox) params.set('viewbox', viewbox);
        const response = await fetchImpl(`${endpoint}?${params}`, {
          signal,
        });
        signal?.throwIfAborted();
        if (!response?.ok) return { place: null, answered: false };
        const data = await response.json();
        signal?.throwIfAborted();
        if (data?.status === 'ZERO_RESULTS')
          return { place: null, answered: true };
        const place =
          data?.status === 'OK'
            ? normalizeGooglePlace(data.results?.[0])
            : null;
        if (!place) return { place: null, answered: false };
        return {
          place: {
            ...place,
            name: place.name || place.label.split(',')[0].trim(),
          },
          answered: true,
        };
      } catch {
        signal?.throwIfAborted();
        return { place: null, answered: false };
      }
    },
  };
}
