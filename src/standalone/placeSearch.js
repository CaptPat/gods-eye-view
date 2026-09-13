import {
  createPlaceSearch,
  createGoogleGeocoder,
  createNominatimGeocoder,
} from '../search/index.js';

/**
 * Google first when configured, then keyless Nominatim through the local
 * /api/geocode/search route; transport stays local to setup.
 *
 * Photon (createPhotonGeocoder) stays available but is not composed here:
 * measured 2026-09-13 from an Austin view, it placed Dubai in Kenya and the
 * Eiffel Tower in Alberta, while the same queries through Nominatim resolved.
 */
export function createStandalonePlaceSearch({
  resolveApiKey,
  fetchImpl = (...args) => fetch(...args),
  signal,
} = {}) {
  return createPlaceSearch({
    signal,
    providers: [
      createGoogleGeocoder({
        request(query, { bias, signal }) {
          const key = resolveApiKey?.();
          if (!key) return null;
          const url = new URL(
            'https://maps.googleapis.com/maps/api/geocode/json',
          );
          url.searchParams.set('address', query);
          url.searchParams.set('key', key);
          if (bias) url.searchParams.set('bounds', bias);
          return fetchImpl(url.toString(), { signal });
        },
      }),
      createNominatimGeocoder({ fetchImpl }),
    ],
  });
}
