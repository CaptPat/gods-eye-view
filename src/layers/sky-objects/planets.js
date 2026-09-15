import { PLANETS } from './model.js';

/** astronomy-engine is 400 KB: load it only when the layer first needs positions. */
export const loadAstronomy = () => import('astronomy-engine');

/**
 * Geocentric J2000 equatorial unit vectors (aberration-corrected) for Mercury
 * to Neptune at `date`, with each planet's colour.
 */
export function planetDirections(astronomy, date) {
  return PLANETS.map(({ name, color }) => {
    const vector = astronomy.GeoVector(astronomy.Body[name], date, true);
    const length = Math.hypot(vector.x, vector.y, vector.z);
    return {
      name,
      color,
      x: vector.x / length,
      y: vector.y / length,
      z: vector.z / length,
    };
  });
}
