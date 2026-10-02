/**
 * Overlay modes and the keys the proxy serves them under. Pure: shared by the
 * browser layer and `server/providers/weather-overlays/sources.js`.
 */
// Cloud cover and 2 m temperature live upstream: Satellite clouds
// (weather-satellite) and the Wind layer's Temperature field, both of which
// also draw on Google 3D.
export const MODES = Object.freeze(['air-quality', 'pollen']);
export const POLLEN_TYPES = Object.freeze(['tree', 'grass', 'weed']);
export const DEFAULT_MODE = 'air-quality';
export const DEFAULT_POLLEN_TYPE = 'tree';
export const DEFAULT_OPACITY = 0.7;

export const MODE_INFO = Object.freeze({
  'air-quality': Object.freeze({
    label: 'Air',
    title: 'Air quality (US AQI)',
    name: 'Google Air Quality',
    short: 'AQI',
    google: true,
    maximumLevel: 12,
  }),
  pollen: Object.freeze({
    label: 'Pollen',
    title: 'Universal Pollen Index',
    name: 'Google Pollen',
    short: 'POLLEN',
    google: true,
    maximumLevel: 10,
  }),
});

export const POLLEN_LABELS = Object.freeze({
  tree: 'Tree',
  grass: 'Grass',
  weed: 'Weed',
});

/** Every key the proxy serves: one per mode, with pollen split by type. */
export const OVERLAY_KEYS = Object.freeze([
  'air-quality',
  ...POLLEN_TYPES.map((type) => `pollen-${type}`),
]);

export function normalizeMode(value) {
  return MODES.includes(value) ? value : null;
}

export function normalizePollenType(value) {
  return POLLEN_TYPES.includes(value) ? value : null;
}

export function overlayKey(mode, pollenType) {
  return mode === 'pollen' ? `pollen-${pollenType}` : mode;
}

export function modeOfKey(key) {
  return String(key).startsWith('pollen-') ? 'pollen' : key;
}

export function maximumLevelFor(key) {
  return MODE_INFO[modeOfKey(key)]?.maximumLevel ?? null;
}

/** The source name the Layers row shows, e.g. `Google Pollen · Grass`. */
export function sourceName(mode, pollenType) {
  const name = MODE_INFO[mode].name;
  return mode === 'pollen' ? `${name} · ${POLLEN_LABELS[pollenType]}` : name;
}
