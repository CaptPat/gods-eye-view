import { IMAGERY_OPACITIES } from '../weather-imagery/opacity.js';
import { MODES, MODE_INFO, POLLEN_LABELS, POLLEN_TYPES } from './modes.js';
import {
  AIR_QUALITY_LEGEND,
  CLOUD_LEGEND,
  POLLEN_LEGEND,
  TEMPERATURE_STOPS,
  celsiusToFahrenheit,
} from './palette.js';

/**
 * Legend entries for the Layers panel. The panel renders `${label} ${count}`,
 * so `count` always carries the secondary text and is never undefined.
 */
export function buildLegend(mode) {
  if (mode === 'temperature') {
    return TEMPERATURE_STOPS.map(({ celsius, color }) => ({
      label: `${celsius}°C`,
      count: `${celsiusToFahrenheit(celsius)}°F`,
      color,
      blurb: `${celsius}°C (${celsiusToFahrenheit(celsius)}°F) at 2 m`,
    }));
  }
  if (mode === 'air-quality') {
    return AIR_QUALITY_LEGEND.map(({ label, range, color }) => ({
      label,
      count: range,
      color,
      blurb: `US AQI ${range}: ${label}`,
    }));
  }
  if (mode === 'pollen') {
    return POLLEN_LEGEND.map(({ label, index, color }) => ({
      label,
      count: `UPI ${index}`,
      color,
      blurb: `Universal Pollen Index ${index}: ${label}`,
    }));
  }
  return CLOUD_LEGEND.map(({ label, detail, color }) => ({
    label,
    count: detail,
    color,
    blurb: `Infrared cloud: ${label.toLowerCase()} cloud, ${detail}; clear sky is transparent`,
  }));
}

/** Row chips and legend (see layerPanel._syncRowControls). */
export function buildRowControls({
  mode,
  pollenType,
  opacity,
  googleConfigured,
}) {
  const keyMissing = googleConfigured === false;
  const chips = MODES.map((id) => {
    const info = MODE_INFO[id];
    const needsKey = info.google && keyMissing;
    return {
      id: `mode-${id}`,
      label: info.label,
      title: needsKey
        ? `${info.title}: needs a Google Maps API key`
        : info.title,
      active: mode === id,
      disabled: needsKey,
      params: { mode: id },
    };
  });
  if (mode === 'pollen') {
    for (const id of POLLEN_TYPES) {
      chips.push({
        id: `pollen-${id}`,
        label: POLLEN_LABELS[id],
        title: `${POLLEN_LABELS[id]} pollen`,
        active: pollenType === id,
        disabled: keyMissing,
        params: { pollenType: id },
      });
    }
  }
  for (const value of IMAGERY_OPACITIES) {
    const percent = Math.round(value * 100);
    chips.push({
      id: `opacity-${percent}`,
      label: `${percent}%`,
      title: `Overlay opacity ${percent}%`,
      active: opacity === value,
      disabled: false,
      params: { opacity: value },
    });
  }
  return { chips, legend: buildLegend(mode) };
}
