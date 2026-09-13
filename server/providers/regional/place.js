import { fetchRegionalJson } from './http.js';
import { normalizeRegionalPlace } from '../../../src/data/regionalBrief.js';

/** Identifies this client to Nominatim, as its usage policy requires. */
const NOMINATIM_HEADERS = Object.freeze({
  'User-Agent':
    'GodsEyeView/0.1 (+https://github.com/bilawalsidhu/gods-eye-view)',
  Referer: 'https://github.com/bilawalsidhu/gods-eye-view',
});

let _nominatimQueue = Promise.resolve();

let _nominatimLastRequestAt = 0;

/**
 * Run one Nominatim request on the shared queue. Requests are serialized and
 * started at least 1.1 s apart, because Nominatim's usage policy (at most one
 * request per second) applies to this whole client — the regional briefing's
 * reverse lookups and place searches together — not to each route.
 * @template T
 * @param {() => Promise<T>} request
 * @returns {Promise<T>}
 */
function scheduleNominatim(request) {
  const task = _nominatimQueue.then(async () => {
    const waitMs = Math.max(0, 1100 - (Date.now() - _nominatimLastRequestAt));
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
    _nominatimLastRequestAt = Date.now();
    return request();
  });
  _nominatimQueue = task.catch(() => null);
  return task;
}

function fetchRegionalPlace(point) {
  return scheduleNominatim(async () => {
    const params = new URLSearchParams({
      format: 'jsonv2',
      lat: point.latitude.toFixed(5),
      lon: point.longitude.toFixed(5),
      zoom: '10',
      addressdetails: '1',
      'accept-language': 'en',
    });
    const payload = await fetchRegionalJson(
      `https://nominatim.openstreetmap.org/reverse?${params}`,
      { headers: NOMINATIM_HEADERS },
    );
    return normalizeRegionalPlace(payload);
  });
}

export { NOMINATIM_HEADERS, fetchRegionalPlace, scheduleNominatim };
