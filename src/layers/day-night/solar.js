import { buildBands } from '../grid-bands/bands.js';

const RAD = Math.PI / 180;

/** Altitude of the sun (degrees) at a point, given the sun's subpoint. */
export function solarAltitudeDeg(lat, lon, subsolar) {
  const phi1 = lat * RAD;
  const phi2 = subsolar.lat * RAD;
  const cosDistance =
    Math.sin(phi1) * Math.sin(phi2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.cos((lon - subsolar.lon) * RAD);
  return 90 - Math.acos(Math.min(1, Math.max(-1, cosDistance))) / RAD;
}

/**
 * Band level for a solar altitude: null in daylight, 0 civil twilight (0 to −6°),
 * 1 nautical (to −12°), 2 astronomical (to −18°), 3 night.
 */
export function twilightLevel(altitudeDeg) {
  if (!(altitudeDeg < 0)) return null;
  if (altitudeDeg >= -6) return 0;
  if (altitudeDeg >= -12) return 1;
  if (altitudeDeg >= -18) return 2;
  return 3;
}

/** Twilight and night bands over a global grid of `cellDeg` cells. */
export function nightBands(subsolar, { cellDeg = 1 } = {}) {
  return buildBands({
    cols: Math.round(360 / cellDeg),
    rows: Math.round(180 / cellDeg),
    west: -180,
    south: -90,
    cellDeg,
    levelAt: (row, col) =>
      twilightLevel(
        solarAltitudeDeg(
          -90 + (row + 0.5) * cellDeg,
          -180 + (col + 0.5) * cellDeg,
          subsolar,
        ),
      ),
  });
}

/** Latitude and longitude (degrees) under an Earth-fixed direction vector. */
export function subpointFromVector({ x, y, z }) {
  const length = Math.hypot(x, y, z);
  return {
    lat: Math.asin(z / length) / RAD,
    lon: Math.atan2(y, x) / RAD,
  };
}

/**
 * Illuminated fraction from the geocentric sun–moon angle, and whether the
 * moon is waxing (east of the sun in right ascension, by less than 180°).
 * Vectors are geocentric in an equatorial frame.
 */
export function moonIllumination(sun, moon) {
  const cosAngle =
    (sun.x * moon.x + sun.y * moon.y + sun.z * moon.z) /
    (Math.hypot(sun.x, sun.y, sun.z) * Math.hypot(moon.x, moon.y, moon.z));
  const fraction = (1 - Math.min(1, Math.max(-1, cosAngle))) / 2;
  let east = Math.atan2(moon.y, moon.x) - Math.atan2(sun.y, sun.x);
  if (east < 0) east += 2 * Math.PI;
  return { fraction, waxing: east > 0 && east < Math.PI };
}
