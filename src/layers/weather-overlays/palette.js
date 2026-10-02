/** Layers-panel legend colours. Pure data: no Cesium, no DOM, no Node built-ins. */

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
