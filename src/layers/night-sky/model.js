/** Pure Night Sky model: layer meta, bundled catalogue parsing and star styling. */
import {
  bvToColor,
  starAlpha,
  starPixelSize,
} from '../sky-sphere/celestial.js';

export const NIGHT_SKY_META = Object.freeze({
  id: 'night-sky',
  name: 'Night Sky',
  icon: '✨',
  source: 'Hipparcos · IAU',
  loadingLabel: 'Loading star catalogue',
  unavailableText: 'Night sky data unavailable',
});

const isRa = (value) => Number.isFinite(value) && value >= 0 && value <= 360;
const isDec = (value) => Number.isFinite(value) && value >= -90 && value <= 90;
const isPlace = (row, raIndex, decIndex) =>
  Array.isArray(row) && isRa(row[raIndex]) && isDec(row[decIndex]);

/**
 * Bundled rows (see scripts/build-night-sky.mjs) → `{ stars, names, lines, labels }`
 * with `{ ra, dec }` in degrees. Malformed rows are dropped; null when the shape is wrong.
 */
export function parseNightSkyData(json) {
  if (
    !Array.isArray(json?.stars) ||
    !Array.isArray(json.names) ||
    !Array.isArray(json.constellations?.lines) ||
    !Array.isArray(json.constellations?.labels)
  )
    return null;
  return {
    stars: json.stars
      .filter((row) => isPlace(row, 0, 1) && Number.isFinite(row[2]))
      .map(([ra, dec, mag, bv]) => ({
        ra,
        dec,
        mag,
        bv: Number.isFinite(bv) ? bv : null,
      })),
    names: json.names
      .filter(
        (row) =>
          isPlace(row, 0, 1) &&
          Number.isFinite(row[2]) &&
          typeof row[3] === 'string' &&
          row[3].trim() !== '',
      )
      .map(([ra, dec, mag, name]) => ({ ra, dec, mag, name })),
    lines: json.constellations.lines
      .filter(
        (line) =>
          Array.isArray(line) &&
          line.length >= 2 &&
          line.every((point) => isPlace(point, 0, 1)),
      )
      .map((line) => line.map(([ra, dec]) => ({ ra, dec }))),
    labels: json.constellations.labels
      .filter(
        (row) =>
          typeof row?.[0] === 'string' && row[0] !== '' && isPlace(row, 1, 2),
      )
      .map(([name, ra, dec]) => ({ name, ra, dec })),
  };
}

export function starStyle(star) {
  return {
    pixelSize: starPixelSize(star.mag),
    color: bvToColor(star.bv),
    alpha: starAlpha(star.mag),
  };
}

/** Serpens has two label entries (Caput and Cauda), so constellations count by name. */
export function nightSkyStatus({ stars, labels }) {
  const constellations = new Set(labels.map((label) => label?.name ?? label));
  return `${stars.length} stars · ${constellations.size} constellations`;
}
