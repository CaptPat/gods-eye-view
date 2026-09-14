import { createGeospatialServices } from './geospatial.js';
import { createHttpGeospatialProvider } from './http.js';
import { createPlaceSearch } from './placeSearch.js';
import { createGoogleGeocoder } from './google.js';
import { createNominatimGeocoder } from './nominatim.js';

/**
 * Google first when configured, then keyless Nominatim through the local
 * /api/geocode/search route; transport stays local to setup.
 *
 * Photon (createPhotonGeocoder) stays available but is not composed here:
 * measured 2026-09-13 from an Austin view, it placed Dubai in Kenya and the
 * Eiffel Tower in Alberta, while the same queries through Nominatim resolved.
 */
export function createDefaultPlaceSearch({
  resolveApiKey,
  fetchImpl = (...args) => fetch(...args),
  signal,
  endpoints = {},
  providers = {},
} = {}) {
  const forward = createPlaceSearch({
    signal,
    providers: providers.geocode || [
      createGoogleGeocoder({
        request(query, { bias, signal }) {
          const key = resolveApiKey?.();
          if (!key) return null;
          const url = new URL(
            endpoints.geocode ||
              'https://maps.googleapis.com/maps/api/geocode/json',
          );
          url.searchParams.set('address', query);
          url.searchParams.set('key', key);
          if (bias) url.searchParams.set('bounds', bias);
          return fetchImpl(url.toString(), { signal });
        },
      }),
      createNominatimGeocoder({ fetchImpl, endpoint: endpoints.nominatim }),
    ],
  });
  return {
    ...forward,
    ...createGeospatialServices({
      signal,
      providers: {
        ...createHttpGeospatialProvider({
          fetchImpl,
          resolveApiKey,
          endpoints,
        }),
        ...providers,
      },
    }),
  };
}

// Compatibility for direct module callers. Application composition supplies its own instance.
export const defaultGeospatial = createDefaultPlaceSearch({
  resolveApiKey: () => globalThis.window?.__GOOGLE_MAPS_API_KEY__,
});
