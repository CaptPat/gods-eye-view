import * as Cesium from 'cesium';
import {
  CHART_DEPTHS_MAX_LEVEL,
  CHART_DEPTHS_MIN_TERRAIN_LEVEL,
  DEPTH_BANDS_MAX_LEVEL,
  DEPTH_BANDS_TILE_TEMPLATE,
  DEPTH_RENDERING_RULE_JSON,
  NOAA_CHART_DEPTH_LAYER,
  NOAA_CHART_WMS_URL,
} from './model.js';

export const DEPTH_BANDS_OPACITY = 0.7;
export const CHART_DEPTHS_OPACITY = 0.9;

/**
 * Directly above the base map when the globe shows one (index 0 holds it),
 * otherwise at the bottom. Evaluated on every insert, never cached, so it
 * follows map-stack switches (the Weather Overlays rule).
 */
export function marineDepthsInsertIndex(viewer) {
  return viewer?.scene?.globe?.show ? 1 : 0;
}

/** Global NCEI depth bands; land is NoData, so it stays transparent. */
export function createDepthBandsLayer() {
  const layer = new Cesium.ImageryLayer(
    new Cesium.UrlTemplateImageryProvider({
      url: DEPTH_BANDS_TILE_TEMPLATE,
      customTags: { renderingRule: () => DEPTH_RENDERING_RULE_JSON },
      tileWidth: 256,
      tileHeight: 256,
      maximumLevel: DEPTH_BANDS_MAX_LEVEL,
    }),
  );
  layer.alpha = DEPTH_BANDS_OPACITY;
  return layer;
}

/** NOAA ENC soundings and contours, only once the camera is close. */
export function createChartDepthsLayer() {
  const layer = new Cesium.ImageryLayer(
    new Cesium.WebMapServiceImageryProvider({
      url: NOAA_CHART_WMS_URL,
      layers: NOAA_CHART_DEPTH_LAYER,
      parameters: {
        service: 'WMS',
        version: '1.3.0',
        format: 'image/png',
        transparent: true,
        styles: '',
      },
      crs: 'EPSG:3857',
      tilingScheme: new Cesium.WebMercatorTilingScheme(),
      maximumLevel: CHART_DEPTHS_MAX_LEVEL,
      // A click must never become a GetFeatureInfo request to NOAA.
      enablePickFeatures: false,
    }),
    { minimumTerrainLevel: CHART_DEPTHS_MIN_TERRAIN_LEVEL },
  );
  layer.alpha = CHART_DEPTHS_OPACITY;
  return layer;
}

/**
 * The two imagery layers behind one toggle: global bands below, chart depths
 * above them. `onTileError` hears provider tile failures for the status row.
 */
export function createMarineDepthsImagery(
  viewer,
  {
    createBands = createDepthBandsLayer,
    createChart = createChartDepthsLayer,
    onTileError = () => {},
  } = {},
) {
  let layers = [];
  let removeErrorListeners = [];

  function insert() {
    // Bands first, then chart directly above them.
    const index = Math.min(
      marineDepthsInsertIndex(viewer),
      viewer.imageryLayers.length,
    );
    layers.forEach((layer, offset) =>
      viewer.imageryLayers.add(layer, index + offset),
    );
  }

  function clear() {
    removeErrorListeners.forEach((remove) => remove());
    removeErrorListeners = [];
    layers.forEach((layer) => viewer.imageryLayers.remove(layer, true));
    layers = [];
  }

  return {
    show() {
      if (layers.length) return;
      layers = [createBands(), createChart()];
      removeErrorListeners = layers
        .map((layer) =>
          layer.imageryProvider?.errorEvent?.addEventListener?.(onTileError),
        )
        .filter((remove) => typeof remove === 'function');
      insert();
    },
    shown: () => layers.length > 0,
    /** Move the layers back above the base map after the stack changed beneath them. */
    reseat() {
      if (!layers.length) return;
      layers.forEach((layer) => viewer.imageryLayers.remove(layer, false));
      insert();
    },
    clear,
    destroy: clear,
  };
}
