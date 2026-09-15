const round5 = (value) => Math.round(value * 1e5) / 1e5 + 0;

/** At most `max` vertices, evenly spaced, always keeping the first and last. */
export function thinPositions(positions, max) {
  const limit = Math.max(2, max);
  const count = positions.length;
  if (count <= limit) return positions;
  const step = Math.ceil((count - 1) / (limit - 1));
  const kept = [];
  for (let index = 0; index < count - 1; index += step)
    kept.push(positions[index]);
  kept.push(positions[count - 1]);
  return kept;
}

/** `[lon, lat]` pairs from an Overpass `out geom` geometry list, skipping gaps. */
function geometryPositions(geometry) {
  if (!Array.isArray(geometry)) return [];
  const positions = [];
  for (const vertex of geometry)
    if (Number.isFinite(vertex?.lat) && Number.isFinite(vertex?.lon))
      positions.push([round5(vertex.lon), round5(vertex.lat)]);
  return positions;
}

/** Mean of a way's vertices (a closed ring counts its shared vertex once), or a relation's bounds centre. */
function anchorOf(element, positions) {
  if (positions.length) {
    const [firstLon, firstLat] = positions[0];
    const [lastLon, lastLat] = positions[positions.length - 1];
    const ring =
      positions.length > 2 && firstLon === lastLon && firstLat === lastLat
        ? positions.slice(0, -1)
        : positions;
    let lon = 0;
    let lat = 0;
    for (const [x, y] of ring) {
      lon += x;
      lat += y;
    }
    return { lat: round5(lat / ring.length), lon: round5(lon / ring.length) };
  }
  const bounds = element.bounds;
  if (
    [bounds?.minlat, bounds?.minlon, bounds?.maxlat, bounds?.maxlon].every(
      Number.isFinite,
    )
  )
    return {
      lat: round5((bounds.minlat + bounds.maxlat) / 2),
      lon: round5((bounds.minlon + bounds.maxlon) / 2),
    };
  return null;
}

/**
 * Overpass elements as drawable features. Ways the line classifier accepts
 * become `lines`; nodes, and ways or relations the point classifier accepts,
 * become `points` anchored at their centre. Classifiers return a style object
 * (spread onto the feature) or null to drop the element. Ids are
 * `<type>/<osm id>`, matching openstreetmap.org URLs.
 */
export function normalizeOsmElements(
  elements,
  { classifyLine, classifyPoint, maxVertices = 400 },
) {
  const lines = [];
  const points = [];
  const seen = new Set();
  for (const element of Array.isArray(elements) ? elements : []) {
    if (!element || typeof element !== 'object') continue;
    const { type, id } = element;
    if (!['node', 'way', 'relation'].includes(type) || !Number.isFinite(id))
      continue;
    const featureId = `${type}/${id}`;
    if (seen.has(featureId)) continue;
    const tags =
      element.tags && typeof element.tags === 'object' ? element.tags : {};

    if (type === 'node') {
      if (!Number.isFinite(element.lat) || !Number.isFinite(element.lon))
        continue;
      const style = classifyPoint(tags);
      if (!style) continue;
      seen.add(featureId);
      points.push({
        id: featureId,
        lat: round5(element.lat),
        lon: round5(element.lon),
        tags,
        ...style,
      });
      continue;
    }

    const positions = geometryPositions(element.geometry);
    if (type === 'way' && positions.length >= 2) {
      const style = classifyLine(tags);
      if (style) {
        seen.add(featureId);
        lines.push({
          id: featureId,
          positions: thinPositions(positions, maxVertices),
          tags,
          ...style,
        });
        continue;
      }
    }
    const style = classifyPoint(tags);
    if (!style) continue;
    const anchor = anchorOf(element, positions);
    if (!anchor) continue;
    seen.add(featureId);
    points.push({ id: featureId, ...anchor, tags, ...style });
  }
  return { lines, points };
}
