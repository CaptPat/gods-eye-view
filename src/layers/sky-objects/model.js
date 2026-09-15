/** Pure Planets & Deep Sky model: layer meta, planet palette and Messier parsing. */

export const SKY_OBJECTS_META = Object.freeze({
  id: 'sky-objects',
  name: 'Planets & Deep Sky',
  icon: '🪐',
  source: 'astronomy-engine · Messier',
  loadingLabel: 'Loading planets',
  unavailableText: 'Planet and Messier data unavailable',
});

export const PLANETS = Object.freeze(
  [
    { name: 'Mercury', color: '#b5b5b5' },
    { name: 'Venus', color: '#fff2c7' },
    { name: 'Mars', color: '#ff6b4a' },
    { name: 'Jupiter', color: '#ffd9a0' },
    { name: 'Saturn', color: '#f5deb3' },
    { name: 'Uranus', color: '#9fe7f5' },
    { name: 'Neptune', color: '#6f8bff' },
  ].map((planet) => Object.freeze(planet)),
);

export const MESSIER_COLORS = Object.freeze({
  galaxy: '#ff7ad9',
  nebula: '#6bffb8',
  cluster: '#ffe066',
  other: '#c8c8c8',
});

const CATEGORY_BY_TYPE = Object.freeze({
  s: 'galaxy',
  e: 'galaxy',
  i: 'galaxy',
  pn: 'nebula',
  rn: 'nebula',
  en: 'nebula',
  dn: 'nebula',
  sfr: 'nebula',
  snr: 'nebula',
  gc: 'cluster',
  oc: 'cluster',
});

/** d3-celestial Messier type code → galaxy, nebula, cluster or other. */
export function messierCategory(type) {
  return CATEGORY_BY_TYPE[type] ?? 'other';
}

const isRa = (value) => Number.isFinite(value) && value >= 0 && value <= 360;
const isDec = (value) => Number.isFinite(value) && value >= -90 && value <= 90;

/** Bundled `[id, name, type, mag, ra, dec]` rows → objects; null when not a list. */
export function parseMessier(rows) {
  if (!Array.isArray(rows)) return null;
  return rows
    .filter(
      (row) =>
        Array.isArray(row) &&
        typeof row[0] === 'string' &&
        row[0] !== '' &&
        Number.isFinite(row[3]) &&
        isRa(row[4]) &&
        isDec(row[5]),
    )
    .map(([id, name, type, mag, ra, dec]) => ({
      id,
      name: typeof name === 'string' && name.trim() ? name : null,
      category: messierCategory(type),
      mag,
      ra,
      dec,
    }));
}

export function messierLabel({ id, name }) {
  return name ? `${id} ${name}` : id;
}

export function skyObjectsStatus({ planets, messier }) {
  return `${planets} planets · ${messier} Messier objects`;
}
