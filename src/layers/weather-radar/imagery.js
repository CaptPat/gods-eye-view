import * as Cesium from 'cesium';
import {
  PRELOAD_ALPHA,
  createFrameImagery,
} from '../weather-imagery/frameImagery.js';

export { PRELOAD_ALPHA };
const IEM_RECTANGLE_DEGREES = Object.freeze([-130, 20, -60, 55]);

export function rainViewerTemplate(timeMs) {
  return `/api/radar/rainviewer/${timeMs}/{z}/{x}/{y}.png`;
}

export function iemTemplate(timeMs) {
  const iso = `${new Date(timeMs).toISOString().slice(0, 16)}:00Z`;
  return `/api/radar/iem?time=${iso}&bbox={westDegrees},{southDegrees},{eastDegrees},{northDegrees}&width={width}&height={height}`;
}

export function createProvider(source, timeMs) {
  if (source === 'iem') {
    return new Cesium.UrlTemplateImageryProvider({
      url: iemTemplate(timeMs),
      tilingScheme: new Cesium.GeographicTilingScheme(),
      tileWidth: 256,
      tileHeight: 256,
      // Level 3 (22.5° tiles) is the coarsest that fits the proxy's 70° x 35° span limit.
      minimumLevel: 3,
      maximumLevel: 9,
      rectangle: Cesium.Rectangle.fromDegrees(...IEM_RECTANGLE_DEGREES),
    });
  }
  return new Cesium.UrlTemplateImageryProvider({
    url: rainViewerTemplate(timeMs),
    tileWidth: 256,
    tileHeight: 256,
    maximumLevel: 7,
  });
}

/** Radar keeps its own providers; frame bookkeeping is shared with Weather Overlays. */
export function createRadarImagery(viewer, options = {}) {
  return createFrameImagery(viewer, { createProvider, ...options });
}
