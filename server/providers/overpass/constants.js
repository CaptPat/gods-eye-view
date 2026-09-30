import path from 'node:path';

// ---------------------------------------------------------------------------
// Overpass API proxy constants and cache state
// ---------------------------------------------------------------------------
/** Stable application identity for operator-configured Overpass instances. */
const OVERPASS_USER_AGENT =
  'gods-eye-view/0.1 (+https://github.com/bilawalsidhu/gods-eye-view)';

/** Parse only operator-supplied HTTP(S) endpoints; private instances are allowed. */
function parseOverpassUpstreams(raw) {
  const endpoints = [];
  for (const token of String(raw || '').split(',')) {
    try {
      const url = new URL(token.trim());
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        !url.hostname ||
        url.hash
      )
        continue;
      if (!endpoints.includes(url.href)) endpoints.push(url.href);
    } catch {
      // Invalid configuration never becomes an upstream or appears in logs.
    }
  }
  return endpoints.slice(0, 8);
}

let upstreamMemo = { raw: null, endpoints: [] };

/** Resolve after environment loading. Public Overpass instances are not used by default. */
function resolveOverpassUpstreams() {
  const raw = process.env.OVERPASS_UPSTREAMS || '';
  if (upstreamMemo.raw !== raw)
    upstreamMemo = { raw, endpoints: parseOverpassUpstreams(raw) };
  return [...upstreamMemo.endpoints];
}

/**
 * TTL for FRESH cached Overpass responses (ms). Road geometry is static for
 * months — the original 45 s TTL forced a public-mirror round-trip on nearly
 * every viewport revisit and left nothing to serve when the mirrors 502
 * (field-test 2026-07-17: all three mirrors down during US morning peak =
 * "traffic takes forever to load"). 24 h in memory; the disk layer below
 * keeps 7 days and also survives dev-server restarts.
 */
const OVERPASS_CACHE_MS = 86_400_000;

/** Disk-cache TTL for Overpass responses (ms) — 7 days. */
const OVERPASS_DISK_TTL_MS = 7 * 86_400_000;

/**
 * Disk-cache TTL for BOUNDARY-class queries (is_in / admin-relation pivots) — 30
 * days. Admin boundaries change ≈never, and their pivots are the most expensive
 * queries the app issues (multi-MB coastline geometry, 10–25 s on public mirrors —
 * field test 2026-07-23: outline latency + the Sicily miss). Keeping them a month
 * means each boundary is fetched roughly once per machine, ever.
 */
const OVERPASS_BOUNDARY_DISK_TTL_MS = 30 * 86_400_000;

/** Disk-cache directory for Overpass responses. */
const OVERPASS_DISK_DIR = path.join(process.cwd(), '.gev-cache', 'overpass');

/** Per-upstream fetch timeout (ms). */
const OVERPASS_TIMEOUT_MS = 22000;

/** Max entries in the Overpass response cache (LRU-like, oldest evicted first). */
const OVERPASS_CACHE_MAX_ENTRIES = 120;

// --- Abuse guards shared by the Overpass + route proxies --------------------
/** Max accepted POST body for the Overpass proxy (Overpass QL queries are tiny). */
const OVERPASS_MAX_BODY_BYTES = 24 * 1024;

// 24 KB
/**
 * Hard cap on a single Overpass upstream response we will buffer into memory.
 * 32 MB (was 12 MB): a dense island/state admin boundary at full `out geom`
 * fidelity — Sicilia's Mediterranean coastline — can exceed 12 MB, and clipping
 * it read as a permanent "transient" failure (field test 2026-07-23, Sicily
 * never traced). The buffered payload is SIMPLIFIED server-side before it is
 * cached or sent (simplifyOverpassPayloadBody), so the raised cap does not
 * raise what clients receive or what the disk stores.
 */
const OVERPASS_MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

// 32 MB
/** Only payloads at least this large go through geometry simplification. */
const OVERPASS_SIMPLIFY_MIN_BYTES = 1_500_000;

/** Only per-element geometry arrays with at least this many points are simplified. */
const OVERPASS_SIMPLIFY_MIN_POINTS = 1200;

/**
 * Douglas-Peucker tolerance (degrees, ≈44 m of latitude). Region/state boundary
 * rings are drawn at regional camera scale and the client simplifies again for
 * draw, so ~44 m fidelity is invisible; building footprints never reach the
 * point threshold above and pass through untouched.
 */
const OVERPASS_SIMPLIFY_TOLERANCE_DEG = 0.0004;

/** Max concurrent in-flight upstream Overpass fetches across all distinct queries. */
const OVERPASS_MAX_CONCURRENT = 6;

/** Server-side timeout ceiling (seconds) we allow inside an Overpass QL query. */
const OVERPASS_MAX_QL_TIMEOUT = 30;

/** Max `around:` radius (m) — every app caller uses <= 1800 m. */
const OVERPASS_MAX_AROUND_M = 50000;

/** Max bbox span (degrees) — app bboxes are small viewport tiles. */
const OVERPASS_MAX_BBOX_DEG = 12;

/**
 * Every Overpass element-type specifier, including the combined shortcuts
 * (nwr/nw/nr/wr) and `rel`. Shared by the selector + area-element-deny regexes so
 * they can't drift (a missing shortcut like `wr` was an area-scan bypass).
 */
const OVERPASS_ELEMENT_TYPES = 'node|way|relation|nwr|nw|nr|wr|rel';

/** Element-selector (incl. `area`) whose statements must be individually bounded. */
const OVERPASS_SELECTOR_RE = new RegExp(
  `\\b(?:${OVERPASS_ELEMENT_TYPES}|area)\\b`,
);

/** An element selector bounded BY an area — the country-scan abuse shape. */
const OVERPASS_AREA_ELEMENT_RE = new RegExp(
  `\\b(?:${OVERPASS_ELEMENT_TYPES})\\s*\\(\\s*area\\b`,
  'i',
);

/** A single bbox 4-tuple `(s,w,n,e)` (non-global so it does not advance lastIndex). */
const OVERPASS_BBOX_RE =
  /\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\)/;

/**
 * True for a host whose traffic cannot leave the local network.
 * @param {string} hostname
 * @returns {boolean}
 */
function isPrivateOverpassHost(hostname) {
  if (hostname === 'localhost') return true;
  const quad = String(hostname).split('.').map(Number);
  if (
    quad.length !== 4 ||
    quad.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
  )
    return false;
  const [a, b] = quad;
  return (
    a === 127 ||
    a === 10 ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31)
  );
}

/**
 * Parse GEV_OVERPASS_UPSTREAMS into extra endpoints tried BEFORE the public
 * mirrors. Comma-separated absolute URLs.
 *
 * Kept out of source because a self-hosted endpoint is deployment config, not
 * code: a hard-coded `http://192.168.x.y` would publish the operator's internal
 * network layout to everyone who clones the repository.
 *
 * Plaintext is admitted only for a private address, where the request never
 * leaves the LAN. An Overpass query carries the operator's viewport, so http://
 * to a routable host would put that on the wire in clear text — such an entry is
 * dropped rather than honoured, and the caller is told why.
 * @param {string|undefined} raw Comma-separated URLs.
 * @param {(message: string) => void} [warn] Sink for rejection notices.
 * @returns {string[]} Accepted endpoints, in the given order.
 */
function parseOverpassUpstreamsEnv(raw, warn = () => {}) {
  if (!raw || typeof raw !== 'string') return [];
  const accepted = [];
  for (const candidate of raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    let parsed;
    try {
      parsed = new URL(candidate);
    } catch {
      warn(`GEV_OVERPASS_UPSTREAMS: ignoring unparseable URL "${candidate}"`);
      continue;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      warn(`GEV_OVERPASS_UPSTREAMS: ignoring non-HTTP URL "${candidate}"`);
      continue;
    }
    if (
      parsed.protocol === 'http:' &&
      !isPrivateOverpassHost(parsed.hostname)
    ) {
      warn(
        `GEV_OVERPASS_UPSTREAMS: refusing plaintext to routable host "${parsed.hostname}"`,
      );
      continue;
    }
    accepted.push(candidate);
  }
  return accepted;
}

/**
 * Endpoints for this request: the fork's GEV_OVERPASS_UPSTREAMS first (validated
 * by parseOverpassUpstreamsEnv, which refuses plaintext to routable hosts), then
 * upstream's OVERPASS_UPSTREAMS. Public Overpass instances are never added:
 * upstream #742 stopped using them by default, and measured 2026-09-12 they
 * refused this proxy anyway (overpass-api.de 406 on the User-Agent; the
 * kumi.systems/private.coffee host 504 after ~60 s).
 *
 * Read lazily: the Vite config copies dotenv files into process.env AFTER
 * provider modules are imported, so a module-level list would miss them.
 * @returns {string[]}
 */
function overpassUpstreams() {
  const endpoints = parseOverpassUpstreamsEnv(
    process.env.GEV_OVERPASS_UPSTREAMS,
    (message) => console.warn(`[overpass] ${message}`),
  );
  for (const url of resolveOverpassUpstreams()) {
    if (!endpoints.includes(url)) endpoints.push(url);
  }
  return endpoints;
}

export {
  isPrivateOverpassHost,
  overpassUpstreams,
  parseOverpassUpstreamsEnv,
  OVERPASS_BOUNDARY_DISK_TTL_MS,
  OVERPASS_DISK_TTL_MS,
  OVERPASS_DISK_DIR,
  OVERPASS_CACHE_MS,
  OVERPASS_CACHE_MAX_ENTRIES,
  OVERPASS_MAX_BODY_BYTES,
  OVERPASS_MAX_CONCURRENT,
  OVERPASS_MAX_AROUND_M,
  OVERPASS_MAX_BBOX_DEG,
  OVERPASS_AREA_ELEMENT_RE,
  OVERPASS_SELECTOR_RE,
  OVERPASS_BBOX_RE,
  OVERPASS_MAX_QL_TIMEOUT,
  OVERPASS_SIMPLIFY_MIN_BYTES,
  OVERPASS_SIMPLIFY_MIN_POINTS,
  OVERPASS_SIMPLIFY_TOLERANCE_DEG,
  OVERPASS_MAX_RESPONSE_BYTES,
  parseOverpassUpstreams,
  resolveOverpassUpstreams,
  OVERPASS_USER_AGENT,
  OVERPASS_TIMEOUT_MS,
};
