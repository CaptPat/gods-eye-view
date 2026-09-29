import {
  OVERPASS_MAX_RESPONSE_BYTES,
<<<<<<< HEAD
=======
  resolveOverpassUpstreams,
>>>>>>> e7707d9a0f34d9fbffc300023c319f95caa5be30
  OVERPASS_USER_AGENT,
  OVERPASS_TIMEOUT_MS,
  overpassUpstreams,
} from './constants.js';
import { readResponseTextCapped } from '../common/http.js';
import { simplifyOverpassPayloadBody } from './geometry.js';

/**
 * Detect whether an Overpass API response body indicates rate-limiting.
 *
 * Checks for known rate-limit phrases in the body text regardless of
 * HTTP status code, since some mirrors return 200 with an error payload.
 *
 * @param {string} bodyText - Upstream response body.
 * @returns {boolean} True if the body looks rate-limited.
 */
function overpassLooksRateLimited(bodyText) {
  const text = String(bodyText || '').toLowerCase();
  return (
    text.includes('rate_limited') ||
    text.includes('quota of your ip address') ||
    text.includes('dispatcher_client::request_read_and_idx::rate_limited') ||
    text.includes('too many requests')
  );
}

/**
 * Detect an Overpass HTTP-200 body that is actually a runtime FAILURE (server-side
 * timeout / out-of-memory) via its `remark`. These are transient upstream failures,
 * not authoritative empty results, so they must not be returned or cached.
 */
function overpassLooksRuntimeError(bodyText) {
  const text = String(bodyText || '').toLowerCase();
  return (
    text.includes('runtime error') ||
    text.includes('timed out') ||
    text.includes('out of memory')
  );
}

/**
 * True only for an upstream response that is actually Overpass data.
 *
 * The proxy caches on this and serves stale on its negation, so the two
 * decisions cannot drift apart: a payload that is not data must never be
 * written to the cache and must always be eligible for a stale replacement.
 * @param {{status: number, rateLimited?: boolean, runtimeError?: boolean}} payload
 * @returns {boolean}
 */
function overpassPayloadIsData(payload) {
  const status = Number(payload?.status);
  return (
    Number.isFinite(status) &&
    status >= 200 &&
    status < 300 &&
    !payload.rateLimited &&
    !payload.runtimeError
  );
}

const cooldowns = new Map();

/** A stable, non-retryable capability response shared by every Overpass route. */
export function overpassNotConfigured() {
  return {
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({
      error: 'Detailed OpenStreetMap queries are not configured',
      code: 'OVERPASS_NOT_CONFIGURED',
      retryable: false,
    }),
  };
}

/** Honor Retry-After dates/seconds; absent values use bounded exponential backoff. */
function retryDelay(value, failures, now) {
  const seconds = Number(value);
  const explicit =
    value && Number.isFinite(seconds)
      ? seconds * 1000
      : Date.parse(value) - now;
  return Number.isFinite(explicit)
    ? Math.max(1000, explicit)
    : Math.min(300_000, 30_000 * 2 ** Math.min(failures, 4));
}

function refusal(status, retryAfterMs) {
  return {
    status,
    contentType: 'application/json',
    rateLimited: status === 429 || status === 406,
    retryAfterMs,
    body: JSON.stringify({
      error: 'Configured Overpass upstream unavailable',
      code: 'OVERPASS_UNAVAILABLE',
      retryable: true,
      retryAfterMs,
    }),
  };
}

/**
<<<<<<< HEAD
 * Number of elements in a JSON Overpass body, or null when the body is not a
 * JSON element list (e.g. an XML `out` format).
 * @param {{body?: string}|null} payload
 * @returns {number|null}
 */
function overpassElementCount(payload) {
  const body = payload?.body;
  if (typeof body !== 'string' || !body) return null;
  try {
    const parsed = JSON.parse(body);
    return Array.isArray(parsed?.elements) ? parsed.elements.length : null;
  } catch {
    return null;
  }
}

/**
 * Whether a data payload may be written to the week/month-long caches.
 *
 * An empty element list is not cached: a mirror with partial coverage answers a
 * valid query with `elements: []`, and caching that would keep a layer empty for
 * days after a complete instance comes back.
 * @param {{body?: string}} payload A payload overpassPayloadIsData accepted.
 * @param {string} cacheKey
 * @returns {boolean}
 */
function overpassPayloadIsCacheable(payload, cacheKey) {
  const count = overpassElementCount(payload);
  // Unknown shape (non-JSON body) — the old behaviour, cache it; emptiness was
  // never claimed.
  if (count === null) return true;
  // `cacheKey` is unused by this policy. It stays in the signature as the
  // documented extension point: isOverpassBoundaryQuery(cacheKey) separates
  // is_in / admin-relation pivots, whose empty answer is almost always a
  // coverage failure rather than the truth, from bbox tag queries, whose empty
  // answer usually is the truth.
  return count > 0;
}

/**
 * Try each mirror once, retaining response-size and per-mirror timeout caps.
 * Refusals and body-level failures rotate; total failure returns the last
 * rate-limit payload, otherwise the first refusal, or throws a network error.
 * @param {string} body URL-encoded Overpass QL query body.
 * @param {number} [maxResponseBytes] Endpoint-specific response cap.
 * @param {object} [options] Server-only endpoint and I/O overrides for tests.
 * @returns {Promise<{status:number,body:string,contentType:string,endpoint:string,rateLimited:boolean}>}
=======
 * Query only the configured chain with capped reads, timeouts and per-endpoint cooldowns.
 * Explicit endpoint/I/O overrides are server-only test seams. Empty data is valid.
>>>>>>> e7707d9a0f34d9fbffc300023c319f95caa5be30
 */
async function fetchOverpassPayload(
  body,
  maxResponseBytes = OVERPASS_MAX_RESPONSE_BYTES,
  {
<<<<<<< HEAD
    endpoints = overpassUpstreams(),
=======
    endpoints = resolveOverpassUpstreams(),
>>>>>>> e7707d9a0f34d9fbffc300023c319f95caa5be30
    fetchImpl = fetch,
    readBody = readResponseTextCapped,
    simplify = simplifyOverpassPayloadBody,
    now = Date.now,
  } = {},
) {
  if (!endpoints.length) return overpassNotConfigured();
  let failure = refusal(502, 30_000);
  for (const endpoint of endpoints) {
    const previous = cooldowns.get(endpoint);
    if (previous?.until > now()) {
      failure = refusal(previous.status, previous.until - now());
      continue;
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);
    try {
      const requestUrl = new URL(endpoint);
      const authorization =
        requestUrl.username || requestUrl.password
          ? 'Basic ' +
            Buffer.from(
              `${decodeURIComponent(requestUrl.username)}:${decodeURIComponent(requestUrl.password)}`,
            ).toString('base64')
          : null;
      requestUrl.username = '';
      requestUrl.password = '';
      const upstream = await fetchImpl(requestUrl.href, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': OVERPASS_USER_AGENT,
          ...(authorization ? { Authorization: authorization } : {}),
        },
        body,
        signal: controller.signal,
      });
      const responseBody = await readBody(upstream, maxResponseBytes);
      const rateLimited =
        upstream.status === 429 ||
        upstream.status === 406 ||
        overpassLooksRateLimited(responseBody);
      if (
        rateLimited ||
        upstream.status < 200 ||
        upstream.status >= 300 ||
        overpassLooksRuntimeError(responseBody)
      ) {
        const failures = (previous?.failures || 0) + 1;
        const delay = retryDelay(
          upstream.headers.get('retry-after'),
          failures - 1,
          now(),
        );
        const status = rateLimited
          ? upstream.status === 406
            ? 406
            : 429
          : 502;
        cooldowns.set(endpoint, { until: now() + delay, failures, status });
        while (cooldowns.size > 64)
          cooldowns.delete(cooldowns.keys().next().value);
        failure = refusal(status, delay);
        continue;
      }
      const parsed = JSON.parse(responseBody);
      if (!Array.isArray(parsed?.elements) || parsed.remark)
        throw new Error('Malformed Overpass response');
      cooldowns.delete(endpoint);
      return {
        status: upstream.status,
        body: simplify(responseBody),
        contentType: 'application/json',
        // Never retain a secret-bearing endpoint in cache or response metadata.
        endpoint: 'configured',
        rateLimited: false,
      };
    } catch {
      const failures = (previous?.failures || 0) + 1;
      const delay = retryDelay(null, failures - 1, now());
      cooldowns.set(endpoint, { until: now() + delay, failures, status: 502 });
      while (cooldowns.size > 64)
        cooldowns.delete(cooldowns.keys().next().value);
      failure = refusal(502, delay);
    } finally {
      clearTimeout(timeoutId);
    }
  }
  return failure;
}

export {
  overpassElementCount,
  overpassPayloadIsCacheable,
  overpassPayloadIsData,
  fetchOverpassPayload,
};
