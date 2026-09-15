/** Pure Fireballs model: layer meta, proxy payload parsing, point size and card text. */

export const FIREBALLS_META = Object.freeze({
  id: 'fireballs',
  name: 'Fireballs',
  icon: '☄️',
  source: 'NASA/JPL CNEOS',
  color: '#ff8c00',
  selectedSourceId: 'fireballs-selected',
  loadingLabel: 'Loading fireballs',
  unavailableText: 'Fireball data unavailable',
  refreshFailedText: 'Fireball refresh failed',
});

export const CNEOS_FIREBALLS_URL = 'https://cneos.jpl.nasa.gov/fireballs/';

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const SUPERSCRIPT = Object.freeze({
  0: '⁰',
  1: '¹',
  2: '²',
  3: '³',
  4: '⁴',
  5: '⁵',
  6: '⁶',
  7: '⁷',
  8: '⁸',
  9: '⁹',
  '-': '⁻',
});
const MIN_PIXELS = 6;
const MAX_PIXELS = 14;

const pad2 = (value) => String(value).padStart(2, '0');

/** 6 px at 0.1 kt or less, two more per tenfold impact energy, capped at 14 px. */
export function fireballPixelSize(impactKt) {
  const kt = Number.isFinite(impactKt) && impactKt > 0.1 ? impactKt : 0.1;
  const size = Math.round((8 + 2 * Math.log10(kt)) * 100) / 100;
  return Math.min(MAX_PIXELS, Math.max(MIN_PIXELS, size));
}

/** 6.1e10 → "6.1 × 10¹⁰ J" (one decimal, carrying 9.96 up to 1.0 × 10ⁿ⁺¹). */
function scientificJoules(joules) {
  let exponent = Math.floor(Math.log10(joules));
  let mantissa = Math.round((joules / 10 ** exponent) * 10) / 10;
  if (mantissa >= 10) {
    mantissa /= 10;
    exponent += 1;
  }
  const power = [...String(exponent)].map((char) => SUPERSCRIPT[char]).join('');
  return `${mantissa.toFixed(1)} × 10${power} J`;
}

function coordinates(lat, lon) {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(2)}°${ns} ${Math.abs(lon).toFixed(2)}°${ew}`;
}

export function buildFireballCard(record) {
  const when = new Date(record.time);
  const day = `${when.getUTCDate()} ${MONTHS[when.getUTCMonth()]} ${when.getUTCFullYear()}`;
  let clock = `${pad2(when.getUTCHours())}:${pad2(when.getUTCMinutes())} UTC`;
  if (Number.isFinite(record.altKm))
    clock += ` · ${Number(record.altKm.toFixed(1))} km up`;
  const details = [clock];
  if (Number.isFinite(record.impactKt))
    details.push(
      `Impact energy ${Number(record.impactKt.toPrecision(2))} kt TNT`,
    );
  if (Number.isFinite(record.velKms))
    details.push(`Entry speed ${Number(record.velKms.toFixed(1))} km/s`);
  if (Number.isFinite(record.energyJ) && record.energyJ > 0)
    details.push(`Radiated ${scientificJoules(record.energyJ)}`);
  details.push(coordinates(record.lat, record.lon));
  return {
    title: `Fireball · ${day}`,
    details,
    url: CNEOS_FIREBALLS_URL,
    accessibilityLabel: 'Open the NASA/JPL CNEOS fireball list',
  };
}

const isFireball = (record) =>
  typeof record?.id === 'string' &&
  record.id !== '' &&
  Number.isFinite(record.time) &&
  Number.isFinite(record.lat) &&
  Number.isFinite(record.lon) &&
  Math.abs(record.lat) <= 90 &&
  Math.abs(record.lon) <= 180;

/** `/api/fireballs` → `{ records, stale }` for the catalog layer, or null. */
export function parseFireballsPayload(payload) {
  if (!Array.isArray(payload?.fireballs)) return null;
  return {
    records: payload.fireballs.filter(isFireball).map((record) => ({
      ...record,
      pixelSize: fireballPixelSize(record.impactKt),
    })),
    stale: Boolean(payload.stale),
  };
}
