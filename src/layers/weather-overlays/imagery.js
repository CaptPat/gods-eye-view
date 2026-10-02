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
 * Evaluated fresh on every insert (and on `rehome()`), never cached, so it
 * tracks map-stack changes instead of a constant snapshot from layer setup.
 */
export function overlayInsertIndex(viewer) {
  return viewer?.scene?.globe?.show ? 1 : 0;
}
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

/**
 * Frame imagery for the overlay, plus Google's required on-screen credit while
 * it drapes on Google 3D. Cesium shows an imagery provider's credit only for
 * globe imagery; a tileset's draped imagery contributes none, so the credit is
 * added to the credit display directly for as long as a Google frame is shown
 * there.
 */
export function createOverlayImagery(viewer, options = {}) {
  const host = options.host ?? (() => ({ kind: 'globe' }));
  const frames = createFrameImagery(viewer, {
    createProvider: createOverlayProvider,
    insertIndex: () => overlayInsertIndex(viewer),
    ...options,
  });
  let source = null;
  let credit = null;

  function syncCredit() {
    const text =
      frames.shownTime() !== null && host().kind === 'tileset'
        ? (GOOGLE_IMAGERY_CREDITS[modeOfKey(source)] ?? null)
        : null;
    if ((credit?.html ?? null) === text) return;
    if (credit) viewer?.creditDisplay?.removeStaticCredit?.(credit);
    credit = text ? new Cesium.Credit(text, true) : null;
    if (credit) viewer?.creditDisplay?.addStaticCredit?.(credit);
  }

  return {
    ...frames,
    setSource(nextSource) {
      frames.setSource(nextSource);
      source = nextSource;
      syncCredit();
    },
    show(time) {
      frames.show(time);
      syncCredit();
    },
    release(keepTimes) {
      frames.release(keepTimes);
      syncCredit();
    },
    rehome() {
      frames.rehome();
      syncCredit();
    },
    clear() {
      frames.clear();
      syncCredit();
    },
    destroy() {
      frames.destroy();
      syncCredit();
    },
  };
}
