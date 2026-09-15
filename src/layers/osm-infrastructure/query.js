/** Query boxes snap outward to this grid so nearby views reuse one proxy cache entry. */
export const QUERY_SNAP_DEGREES = 0.05;

const EPSILON = 1e-9;
const round5 = (value) => Math.round(value * 1e5) / 1e5 + 0;

/**
 * A `{ south, west, north, east }` box in degrees, or null when it is invalid,
 * crosses the antimeridian, or spans more than `maxDegrees` either way.
 */
export function viewBoxFromRectangle(rect, maxDegrees) {
  if (!rect) return null;
  const { south, west, north, east } = rect;
  if (![south, west, north, east].every(Number.isFinite)) return null;
  if (south < -90 || north > 90 || west < -180 || east > 180) return null;
  if (north <= south || east <= west) return null;
  if (north - south > maxDegrees || east - west > maxDegrees) return null;
  return { south, west, north, east };
}

/** Snap a box outward to the query grid, staying inside the globe. */
export function snapViewBox({ south, west, north, east }) {
  const grid = QUERY_SNAP_DEGREES;
  const down = (value) => round5(Math.floor(value / grid + EPSILON) * grid);
  const up = (value) => round5(Math.ceil(value / grid - EPSILON) * grid);
  return {
    south: Math.max(-90, down(south)),
    west: Math.max(-180, down(west)),
    north: Math.min(90, up(north)),
    east: Math.min(180, up(east)),
  };
}

/** Whether `outer` fully contains `inner`. */
export function boxContains(outer, inner) {
  return Boolean(
    outer &&
    inner &&
    inner.south >= outer.south &&
    inner.west >= outer.west &&
    inner.north <= outer.north &&
    inner.east <= outer.east,
  );
}

/** Overpass QL: every selector bounded by the box, tags plus geometry, capped at `cap` elements. */
export function buildOverpassQuery(selectors, box, cap, timeout = 25) {
  const bbox = `(${box.south},${box.west},${box.north},${box.east})`;
  const union = selectors.map((selector) => `${selector}${bbox};`).join('');
  return `[out:json][timeout:${timeout}];(${union});out tags geom ${cap};`;
}
