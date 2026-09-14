/** 0.01° (~1.1 km): 613,743 raw zone positions became 32,853 (measured 2026-09-14). */
export const SIMPLIFY_TOLERANCE_DEG = 0.01;

const roundCoordinate = (value) => Math.round(value * 10_000) / 10_000;

function validPosition(position) {
  return (
    Array.isArray(position) &&
    Number.isFinite(position[0]) &&
    Number.isFinite(position[1]) &&
    Math.abs(position[0]) <= 180 &&
    Math.abs(position[1]) <= 90
  );
}

/** Round to 4 decimals and drop invalid or repeated positions. */
export function cleanPositions(positions) {
  if (!Array.isArray(positions)) return [];
  const out = [];
  for (const position of positions) {
    if (!validPosition(position)) continue;
    const next = [roundCoordinate(position[0]), roundCoordinate(position[1])];
    const last = out.at(-1);
    if (last && last[0] === next[0] && last[1] === next[1]) continue;
    out.push(next);
  }
  return out;
}

/** Douglas–Peucker on one ring; the result is closed, or null when it collapses. */
export function simplifyRing(ring, tolerance = SIMPLIFY_TOLERANCE_DEG) {
  const points = cleanPositions(ring);
  if (points.length < 4) return null;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const toleranceSq = tolerance * tolerance;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop();
    const [ax, ay] = points[start];
    const [bx, by] = points[end];
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    let farthest = -1;
    let farthestSq = toleranceSq;
    for (let i = start + 1; i < end; i += 1) {
      const [px, py] = points[i];
      const t = lengthSq
        ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq))
        : 0;
      const ex = ax + t * dx - px;
      const ey = ay + t * dy - py;
      const distanceSq = ex * ex + ey * ey;
      if (distanceSq > farthestSq) {
        farthestSq = distanceSq;
        farthest = i;
      }
    }
    if (farthest >= 0) {
      keep[farthest] = 1;
      stack.push([start, farthest], [farthest, end]);
    }
  }
  const simplified = points.filter((_, index) => keep[index]);
  const first = simplified[0];
  const last = simplified.at(-1);
  if (first[0] !== last[0] || first[1] !== last[1])
    simplified.push([first[0], first[1]]);
  return simplified.length >= 4 ? simplified : null;
}

function polygonCoordinates(geometry) {
  if (!geometry || typeof geometry !== 'object') return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') {
    return Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
  }
  if (geometry.type === 'GeometryCollection') {
    return (
      Array.isArray(geometry.geometries) ? geometry.geometries : []
    ).flatMap(polygonCoordinates);
  }
  return [];
}

/** Polygon, MultiPolygon or GeometryCollection → `[[outer, ...holes], ...]`, simplified. */
export function simplifyGeometry(geometry, tolerance = SIMPLIFY_TOLERANCE_DEG) {
  const polygons = [];
  for (const polygon of polygonCoordinates(geometry)) {
    if (!Array.isArray(polygon)) continue;
    const outer = simplifyRing(polygon[0], tolerance);
    if (!outer) continue;
    const holes = polygon
      .slice(1)
      .map((ring) => simplifyRing(ring, tolerance))
      .filter(Boolean);
    polygons.push([outer, ...holes]);
  }
  return polygons;
}

export function countPositions(polygons) {
  let count = 0;
  for (const polygon of polygons)
    for (const ring of polygon) count += ring.length;
  return count;
}
