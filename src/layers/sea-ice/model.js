/** Pure Sea Ice model: layer meta, GIBS tile addresses and the served-day header. */

export const SEA_ICE_META = Object.freeze({
  id: 'sea-ice',
  name: 'Sea Ice',
  icon: '🧊',
  source: 'GHRSST MUR',
});

/**
 * GHRSST Level 4 MUR sea ice concentration on NASA GIBS: daily, current, and
 * served in Web Mercator to level 7. (The AMSR2 layers stopped in 2025.)
 */
const GIBS_LAYER = 'GHRSST_L4_MUR_Sea_Ice_Concentration';
const GIBS_BASE = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${GIBS_LAYER}/default`;
export const SEA_ICE_MAX_LEVEL = 7;
const TILE_MATRIX_SET = `GoogleMapsCompatible_Level${SEA_ICE_MAX_LEVEL}`;

/** A Cesium URL template for one day (`YYYY-MM-DD`, or `default` for the newest). */
export function seaIceTileTemplate(day) {
  return `${GIBS_BASE}/${day}/${TILE_MATRIX_SET}/{z}/{y}/{x}.png`;
}

/**
 * The single level-0 tile of the newest day. GIBS names the day it served in
 * the CORS-exposed `Layer-Time-Actual` header, so the capabilities document
 * (megabytes) is never needed.
 */
export const SEA_ICE_PROBE_URL = `${GIBS_BASE}/default/${TILE_MATRIX_SET}/0/0/0.png`;

/** `2026-09-07T00:00:00Z` → `2026-09-07`, or null. */
export function parseLayerTime(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/.exec(
    String(value ?? '').trim(),
  );
  if (!match) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}
