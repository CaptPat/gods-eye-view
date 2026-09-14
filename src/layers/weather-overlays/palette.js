/**
 * Colours shared by the server's temperature tile renderer and the Layers-panel
 * legends. Pure data and arithmetic: no Cesium, no DOM, no Node built-ins.
 */

/** Temperature ramp at 2 m, °C to sRGB. Values outside the ends clamp. */
export const TEMPERATURE_STOPS = Object.freeze([
  Object.freeze({ celsius: -30, color: '#5e3c99' }),
  Object.freeze({ celsius: -15, color: '#3b6fd8' }),
  Object.freeze({ celsius: 0, color: '#9fd8f0' }),
  Object.freeze({ celsius: 10, color: '#fff3a0' }),
  Object.freeze({ celsius: 20, color: '#ffb050' }),
  Object.freeze({ celsius: 30, color: '#f05a28' }),
  Object.freeze({ celsius: 40, color: '#a50f15' }),
]);

/** US AQI categories; the colours Google's US_AQI heatmap tiles use (measured). */
export const AIR_QUALITY_LEGEND = Object.freeze([
  Object.freeze({ label: 'Good', range: '0-50', color: '#00e400' }),
  Object.freeze({ label: 'Moderate', range: '51-100', color: '#ffff00' }),
  Object.freeze({ label: 'Sensitive', range: '101-150', color: '#ff7e00' }),
  Object.freeze({ label: 'Unhealthy', range: '151-200', color: '#ff0000' }),
  Object.freeze({
    label: 'Very unhealthy',
    range: '201-300',
    color: '#8f3f97',
  }),
  Object.freeze({ label: 'Hazardous', range: '301+', color: '#7e0023' }),
]);

/** Universal Pollen Index 1-5; colours sampled from Google's UPI heatmap tiles. */
export const POLLEN_LEGEND = Object.freeze([
  Object.freeze({ label: 'Very low', index: 1, color: '#009e3a' }),
  Object.freeze({ label: 'Low', index: 2, color: '#84cf33' }),
  Object.freeze({ label: 'Moderate', index: 3, color: '#ffff00' }),
  Object.freeze({ label: 'High', index: 4, color: '#ff8c00' }),
  Object.freeze({ label: 'Very high', index: 5, color: '#ff0000' }),
]);

/** Longwave infrared: brighter means colder, higher cloud tops. */
export const CLOUD_LEGEND = Object.freeze([
  Object.freeze({ label: 'Low', detail: 'warm tops', color: '#8c8c8c' }),
  Object.freeze({ label: 'Mid', detail: 'cool tops', color: '#c8c8c8' }),
  Object.freeze({ label: 'High', detail: 'cold tops', color: '#ffffff' }),
]);

export function celsiusToFahrenheit(celsius) {
  return Math.round((celsius * 9) / 5 + 32);
}

function hexToRgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

const STOP_RGB = TEMPERATURE_STOPS.map((stop) => hexToRgb(stop.color));

/** Linear interpolation along the ramp; null for a missing value. */
export function temperatureRgb(celsius) {
  if (!Number.isFinite(celsius)) return null;
  const last = TEMPERATURE_STOPS.length - 1;
  if (celsius <= TEMPERATURE_STOPS[0].celsius) return [...STOP_RGB[0]];
  if (celsius >= TEMPERATURE_STOPS[last].celsius) return [...STOP_RGB[last]];
  let upper = 1;
  while (TEMPERATURE_STOPS[upper].celsius < celsius) upper += 1;
  const low = TEMPERATURE_STOPS[upper - 1].celsius;
  const high = TEMPERATURE_STOPS[upper].celsius;
  const t = (celsius - low) / (high - low);
  return STOP_RGB[upper - 1].map((channel, index) =>
    Math.round(channel + (STOP_RGB[upper][index] - channel) * t),
  );
}
