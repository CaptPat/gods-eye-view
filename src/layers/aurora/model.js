/** Pure Aurora Forecast model: layer meta, band colours, payload parsing and row text. */

export const AURORA_META = Object.freeze({
  id: 'aurora-forecast',
  name: 'Aurora Forecast',
  icon: '🌌',
  source: 'NOAA SWPC',
  loadingLabel: 'Loading forecast',
  unavailableText: 'Aurora forecast unavailable',
  refreshFailedText: 'Aurora forecast refresh failed',
});

/** One entry per server band level (probability threshold in percent). */
export const AURORA_BAND_LEVELS = Object.freeze([
  Object.freeze({ threshold: 5, color: '#2ecc71', alpha: 0.16 }),
  Object.freeze({ threshold: 10, color: '#7cff6b', alpha: 0.28 }),
  Object.freeze({ threshold: 30, color: '#ffe66d', alpha: 0.38 }),
  Object.freeze({ threshold: 50, color: '#ff3dd8', alpha: 0.48 }),
]);

const pad2 = (value) => String(value).padStart(2, '0');

export function auroraStatusLabel({ maxProbability, forecastTime }) {
  const peak = `Peak ${maxProbability}%`;
  if (!Number.isFinite(forecastTime)) return peak;
  const when = new Date(forecastTime);
  return `${peak} · forecast ${pad2(when.getUTCHours())}:${pad2(when.getUTCMinutes())} UTC`;
}

const isBand = (band) =>
  Number.isInteger(band?.level) &&
  band.level >= 0 &&
  band.level < AURORA_BAND_LEVELS.length &&
  [band.west, band.south, band.east, band.north].every(Number.isFinite) &&
  band.west >= -180 &&
  band.east <= 180 &&
  band.south >= -90 &&
  band.north <= 90 &&
  band.east > band.west &&
  band.north > band.south;

/** `/api/aurora` → `{ bands, maxProbability, forecastTime, stale }`, or null. */
export function parseAuroraPayload(payload) {
  if (
    !Array.isArray(payload?.bands) ||
    !Number.isFinite(payload.maxProbability)
  )
    return null;
  return {
    bands: payload.bands
      .filter(isBand)
      .map(({ level, west, south, east, north }) => ({
        level,
        west,
        south,
        east,
        north,
      })),
    maxProbability: payload.maxProbability,
    forecastTime: Number.isFinite(payload.forecastTime)
      ? payload.forecastTime
      : null,
    stale: Boolean(payload.stale),
  };
}
