import { fetchRegionalJson } from './http.js';
import { normalizeRegionalPlace } from '../../../src/data/regionalModel.js';

const NOMINATIM_REVERSE_ENDPOINT =
  'https://nominatim.openstreetmap.org/reverse';

/** Identifies this client to Nominatim, as its usage policy requires. */
const NOMINATIM_HEADERS = Object.freeze({
  'User-Agent':
    'GodsEyeView/0.1 (+https://github.com/bilawalsidhu/gods-eye-view)',
  Referer: 'https://github.com/bilawalsidhu/gods-eye-view',
});

/**
 * Build a request queue that serializes requests and starts them at least
 * 1.1 s apart (Nominatim's usage policy: at most one request per second).
 * @returns {<T>(request: () => Promise<T>) => Promise<T>}
 */
function createNominatimScheduler() {
  let queue = Promise.resolve();
  let lastRequestAt = 0;
  return function schedule(request) {
    const task = queue.then(async () => {
      const waitMs = Math.max(0, 1100 - (Date.now() - lastRequestAt));
      if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
      lastRequestAt = Date.now();
      return request();
    });
    queue = task.catch(() => null);
    return task;
  };
}

/**
 * Run one request on the shared public-Nominatim queue. The usage policy
 * applies to this whole client — the regional briefing's reverse lookups and
 * place searches together — not to each route.
 */
const scheduleNominatim = createNominatimScheduler();

/**
 * Construct the serialized Nominatim reverse adapter with a trusted endpoint.
 * The public endpoint shares the process-wide queue; a configured endpoint
 * gets its own.
 */
export function createRegionalPlaceProvider({
  endpoint = NOMINATIM_REVERSE_ENDPOINT,
  requestJson = fetchRegionalJson,
} = {}) {
  const schedule =
    endpoint === NOMINATIM_REVERSE_ENDPOINT
      ? scheduleNominatim
      : createNominatimScheduler();
  return function fetchRegionalPlace(point) {
    return schedule(async () => {
      const params = new URLSearchParams({
        format: 'jsonv2',
        lat: point.latitude.toFixed(5),
        lon: point.longitude.toFixed(5),
        zoom: '10',
        addressdetails: '1',
        'accept-language': 'en',
      });
      const payload = await requestJson(`${endpoint}?${params}`, {
        headers: NOMINATIM_HEADERS,
      });
      return normalizeRegionalPlace(payload);
    });
  };
}

export const fetchRegionalPlace = createRegionalPlaceProvider();

export { NOMINATIM_HEADERS, scheduleNominatim };
