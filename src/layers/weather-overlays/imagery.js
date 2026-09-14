import * as Cesium from 'cesium';
import { createFrameImagery } from '../weather-imagery/frameImagery.js';
import { maximumLevelFor, modeOfKey } from './modes.js';

/** Directly above the base map (index 0), so radar added later stays on top. */
export const OVERLAY_INSERT_INDEX = 1;
/** GMGSI longwave pixels darker than this (0-1) are warm surface: made clear. */
export const CLOUD_CLEAR_THRESHOLD = 0.3;
/** Google's required attribution, shown on screen while its imagery is drawn. */
export const GOOGLE_IMAGERY_CREDITS = Object.freeze({
  'air-quality': 'Source: Includes air quality data from Google',
  pollen: 'Source: Includes pollen data from Google',
});

export function overlayTemplate(key, timeMs) {
  return `/api/weather-overlays/tiles/${key}/${timeMs}/{z}/{x}/{y}.png`;
}

export function createOverlayProvider(key, timeMs) {
  const creditText = GOOGLE_IMAGERY_CREDITS[modeOfKey(key)];
  return new Cesium.UrlTemplateImageryProvider({
    url: overlayTemplate(key, timeMs),
    tileWidth: 256,
    tileHeight: 256,
    maximumLevel: maximumLevelFor(key),
    ...(creditText ? { credit: new Cesium.Credit(creditText, true) } : {}),
  });
}

export function createOverlayLayer(provider, key) {
  if (key !== 'clouds') return new Cesium.ImageryLayer(provider);
  return new Cesium.ImageryLayer(provider, {
    colorToAlpha: Cesium.Color.BLACK,
    colorToAlphaThreshold: CLOUD_CLEAR_THRESHOLD,
  });
}

export function createOverlayImagery(viewer, options = {}) {
  return createFrameImagery(viewer, {
    createProvider: createOverlayProvider,
    createLayer: createOverlayLayer,
    insertIndex: OVERLAY_INSERT_INDEX,
    ...options,
  });
}
