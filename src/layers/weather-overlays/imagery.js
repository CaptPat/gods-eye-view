import * as Cesium from 'cesium';
import { createFrameImagery } from '../weather-imagery/frameImagery.js';
import { maximumLevelFor, modeOfKey } from './modes.js';

/**
 * Directly above the base map, so radar (which always appends on top) stays
 * above the overlay whatever order the layers are enabled in. The map
 * controller removes the base imagery layer entirely (and sets
 * `scene.globe.show = false`) on the photoreal 3D-tileset stack, and adds
 * exactly one base layer at index 0 for every globe stack — so `globe.show`
 * is a reliable proxy for "is there a base layer below index 0 right now".
 * Evaluated fresh on every insert (and on `reseat()`), never cached, so it
 * tracks map-stack changes instead of a constant snapshot from layer setup.
 */
export function overlayInsertIndex(viewer) {
  return viewer?.scene?.globe?.show ? 1 : 0;
}
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
    insertIndex: () => overlayInsertIndex(viewer),
    ...options,
  });
}
