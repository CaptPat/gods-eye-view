import {
  IMAGERY_OPACITIES,
  normalizeImageryOpacity,
} from '../weather-imagery/opacity.js';

export const RADAR_OPACITIES = IMAGERY_OPACITIES;
export const normalizeOpacity = normalizeImageryOpacity;

// Colours from RainViewer's published table (rainviewer_api_colors_table.csv):
// the "Universal Blue" column is what the API serves; "NEXRAD Level III" is the
// NWS palette that Iowa State's n0q composite uses.
const LEGENDS = Object.freeze({
  rainviewer: Object.freeze({
    palette: 'Universal Blue',
    items: [
      ['Light', '20 dBZ', '#00a3e0'],
      ['Moderate', '30 dBZ', '#005588'],
      ['Heavy', '50 dBZ', '#c10000'],
      ['Extreme', '65 dBZ', '#ffffff'],
    ],
  }),
  iem: Object.freeze({
    palette: 'NEXRAD Level III',
    items: [
      ['Light', '20 dBZ', '#00ff00'],
      ['Moderate', '30 dBZ', '#087305'],
      ['Heavy', '50 dBZ', '#ff0000'],
      ['Extreme', '65 dBZ', '#fe00fe'],
    ],
  }),
});

/** Row chips and legend for the Layers panel (see layerPanel._syncRowControls). */
export function buildRowControls({
  playing,
  usDetail,
  opacity,
  loopAvailable,
}) {
  const legend = LEGENDS[usDetail ? 'iem' : 'rainviewer'];
  return {
    chips: [
      {
        id: 'loop',
        label: playing ? '❚❚ Pause' : '▶ Loop',
        title: playing ? 'Pause the loop' : 'Loop the last two hours',
        active: Boolean(playing),
        disabled: !loopAvailable,
        params: { loop: !playing },
      },
      {
        id: 'us-detail',
        label: 'US detail',
        title: 'Iowa State NEXRAD over the contiguous US',
        active: Boolean(usDetail),
        disabled: false,
        params: { usDetail: !usDetail },
      },
      ...RADAR_OPACITIES.map((value) => {
        const percent = Math.round(value * 100);
        return {
          id: `opacity-${percent}`,
          label: `${percent}%`,
          title: `Radar opacity ${percent}%`,
          active: opacity === value,
          disabled: false,
          params: { opacity: value },
        };
      }),
    ],
    // `count` carries the dBZ text: the panel renders `${label} ${count}`.
    legend: legend.items.map(([label, count, color]) => ({
      label,
      count,
      color,
      blurb: `${legend.palette} colour at ${count}`,
    })),
  };
}
