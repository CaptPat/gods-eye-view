export const FIREBALL_API = 'https://ssd-api.jpl.nasa.gov/fireball.api';

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

/** The one upstream request: every fireball CNEOS has a location for. */
export function fireballsUrl() {
  return `${FIREBALL_API}?req-loc=true`;
}

/** The SSD API reports a refused request as `{ code, message }`. */
export function upstreamError(json) {
  if (
    json &&
    typeof json === 'object' &&
    json.code &&
    typeof json.message === 'string'
  )
    return json.message;
  return null;
}

/** A finite number from the API's numeric strings, or null. */
function numeric(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** An unsigned magnitude plus hemisphere letter as a signed degree, or null. */
function signedDegrees(value, direction, positive, negative, limit) {
  const magnitude = numeric(value);
  if (magnitude === null || magnitude < 0 || magnitude > limit) return null;
  if (direction === positive) return magnitude;
  if (direction === negative) return magnitude === 0 ? 0 : -magnitude;
  return null;
}

/** Radiated energy arrives in units of 10^10 J; scale in decimal so 6.1 stays 6.1e10. */
function tenBillionJoules(value) {
  if (numeric(value) === null) return null;
  return Number(`${String(value).trim()}e10`);
}

/** "YYYY-MM-DD hh:mm:ss" (GMT) as epoch ms, rejecting impossible calendar values. */
function utcTime(text) {
  const match = DATE_PATTERN.exec(String(text ?? ''));
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const time = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second);
  const roundTrip = new Date(time).toISOString().slice(0, 19);
  return roundTrip === `${year}-${month}-${day}T${hour}:${minute}:${second}`
    ? { time, key: `${year}${month}${day}${hour}${minute}${second}` }
    : null;
}

/**
 * CNEOS fireball rows → `{ id, time, lat, lon, altKm, velKms, energyJ, impactKt }`.
 * Rows without a valid time or location are dropped. Returns null for an
 * error answer or a payload that is not a field/row table.
 */
export function normalizeFireballs(json) {
  if (!json || typeof json !== 'object' || upstreamError(json)) return null;
  if (String(json.count) === '0' && json.data === undefined) return [];
  if (!Array.isArray(json.fields) || !Array.isArray(json.data)) return null;
  const column = (name) => json.fields.indexOf(name);
  const index = {
    date: column('date'),
    energy: column('energy'),
    impact: column('impact-e'),
    lat: column('lat'),
    latDir: column('lat-dir'),
    lon: column('lon'),
    lonDir: column('lon-dir'),
    alt: column('alt'),
    vel: column('vel'),
  };
  if (
    [index.date, index.lat, index.latDir, index.lon, index.lonDir].some(
      (position) => position < 0,
    )
  )
    return null;
  const optional = (row, position, read) =>
    position >= 0 ? read(row[position]) : null;
  const seen = new Map();
  const records = [];
  for (const row of json.data) {
    if (!Array.isArray(row)) continue;
    const when = utcTime(row[index.date]);
    const lat = signedDegrees(row[index.lat], row[index.latDir], 'N', 'S', 90);
    const lon = signedDegrees(row[index.lon], row[index.lonDir], 'E', 'W', 180);
    if (!when || lat === null || lon === null) continue;
    const occurrence = (seen.get(when.key) ?? 0) + 1;
    seen.set(when.key, occurrence);
    records.push({
      id: occurrence === 1 ? when.key : `${when.key}-${occurrence}`,
      time: when.time,
      lat,
      lon,
      altKm: optional(row, index.alt, numeric),
      velKms: optional(row, index.vel, numeric),
      energyJ: optional(row, index.energy, tenBillionJoules),
      impactKt: optional(row, index.impact, numeric),
    });
  }
  return records;
}
