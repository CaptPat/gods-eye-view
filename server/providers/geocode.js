import { makeRateLimiter, clientKey } from './common/rate-limit.js';
import { coalesceProxyRequest } from './common/http.js';
import { fetchRegionalJson } from './regional/http.js';
import { NOMINATIM_HEADERS, scheduleNominatim } from './regional/place.js';
import { osmHitToGoogleResult } from '../../src/geocodeOsm.js';

const GEOCODE_SEARCH_CACHE_MS = 10 * 60_000;
const GEOCODE_SEARCH_MAX_CACHE = 200;
const GEOCODE_SEARCH_MAX_QUERY = 200;
const _geocodeSearchCache = new Map();
const _geocodeSearchInFlight = new Map();
const _geocodeSearchRateLimiter = makeRateLimiter({
  windowMs: 60_000,
  max: 30,
  globalMax: 90,
});

/**
 * A Nominatim viewbox "west,south,east,north", or null when malformed.
 * @param {string|null|undefined} raw
 * @returns {string|null}
 */
function validGeocodeViewbox(raw) {
  const parts = String(raw || '')
    .split(',')
    .map((part) => part.trim());
  if (parts.length !== 4 || parts.some((part) => part === '')) return null;
  const [west, south, east, north] = parts.map(Number);
  if (![west, south, east, north].every(Number.isFinite)) return null;
  if (
    Math.abs(south) > 90 ||
    Math.abs(north) > 90 ||
    Math.abs(west) > 180 ||
    Math.abs(east) > 180
  )
    return null;
  return parts.join(',');
}

/**
 * Vite plugin: GET /api/geocode/search?q=<place>&viewbox=<west,south,east,north>
 *
 * The keyless place provider behind Google (src/search/nominatim.js). Asked from
 * the server so requests carry an identifying User-Agent and share the
 * one-per-second Nominatim queue with the regional briefing. `accept-language=en`
 * keeps labels readable (Dubai otherwise comes back in Arabic), and the viewbox
 * biases ranking toward the current view without excluding elsewhere — without
 * it "6th Street Austin" resolves to Sealy, in Austin County. Results are
 * reshaped into Google's geocode structure. An outage is a 502 UNAVAILABLE and
 * is never cached; only a definitive miss is ZERO_RESULTS.
 * @returns {import('vite').Plugin}
 */
function geocodeSearchProxy() {
  async function search(query, viewbox) {
    const params = new URLSearchParams({
      q: query,
      format: 'jsonv2',
      limit: '1',
      'accept-language': 'en',
    });
    if (viewbox) {
      params.set('viewbox', viewbox);
      params.set('bounded', '0');
    }
    const hits = await scheduleNominatim(() =>
      fetchRegionalJson(`https://nominatim.openstreetmap.org/search?${params}`, {
        headers: NOMINATIM_HEADERS,
      }),
    );
    const result = Array.isArray(hits)
      ? hits.map(osmHitToGoogleResult).find(Boolean)
      : null;
    return result
      ? { status: 'OK', source: 'openstreetmap', results: [result] }
      : { status: 'ZERO_RESULTS', source: 'openstreetmap', results: [] };
  }

  function install(middlewares) {
    middlewares.use('/api/geocode/search', async (req, res) => {
      const send = (statusCode, body, headers = {}) => {
        res.writeHead(statusCode, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          ...headers,
        });
        res.end(JSON.stringify(body));
      };
      if (req.method !== 'GET') {
        send(405, {
          status: 'INVALID_REQUEST',
          source: 'openstreetmap',
          results: [],
          error: 'Method Not Allowed',
        });
        return;
      }
      if (!_geocodeSearchRateLimiter(clientKey(req))) {
        send(
          429,
          {
            status: 'UNAVAILABLE',
            source: 'openstreetmap',
            results: [],
            error: 'Rate limit exceeded',
          },
          { 'Retry-After': '10' },
        );
        return;
      }
      const url = new URL(req.url || '', 'http://localhost');
      const query = String(url.searchParams.get('q') || '').trim();
      if (!query || query.length > GEOCODE_SEARCH_MAX_QUERY) {
        send(400, {
          status: 'INVALID_REQUEST',
          source: 'openstreetmap',
          results: [],
          error: 'A place name is required',
        });
        return;
      }
      const viewbox = validGeocodeViewbox(url.searchParams.get('viewbox'));
      const key = `${query.toLowerCase()}|${viewbox || ''}`;
      const cached = _geocodeSearchCache.get(key);
      if (cached && Date.now() - cached.cachedAt <= GEOCODE_SEARCH_CACHE_MS) {
        send(200, cached.payload, { 'X-Geocode-Search': 'HIT' });
        return;
      }
      try {
        const request = coalesceProxyRequest(_geocodeSearchInFlight, key, () =>
          search(query, viewbox),
        );
        const payload = await request.promise;
        _geocodeSearchCache.set(key, { payload, cachedAt: Date.now() });
        while (_geocodeSearchCache.size > GEOCODE_SEARCH_MAX_CACHE) {
          _geocodeSearchCache.delete(_geocodeSearchCache.keys().next().value);
        }
        send(200, payload, { 'X-Geocode-Search': 'MISS' });
      } catch (error) {
        console.warn('[Geocode search]', error?.message || error);
        send(502, {
          status: 'UNAVAILABLE',
          source: 'openstreetmap',
          results: [],
        });
      }
    });
  }

  return {
    name: 'geocode-search-proxy',
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}

export { geocodeSearchProxy, validGeocodeViewbox };
