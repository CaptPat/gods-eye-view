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
 * They go to the collection `host()` names: the globe's `imageryLayers`, the
 * Google 3D tileset's own `imageryLayers` (Cesium drapes them onto the tiles),
 * or none, in which case they wait detached until `rehome()` finds one.
 */
export function createMarineDepthsImagery(
  viewer,
  {
    createBands = createDepthBandsLayer,
    createChart = createChartDepthsLayer,
    onTileError = () => {},
    host = () => ({ collection: viewer.imageryLayers, kind: 'globe' }),
  } = {},
) {
  let layers = [];
  let home = null;
  let removeErrorListeners = [];

  function place() {
    const collection = host()?.collection ?? null;
    if (!collection) return null;
    // Bands first, then chart directly above them.
    const index = Math.min(marineDepthsInsertIndex(viewer), collection.length);
    layers.forEach((layer, offset) => collection.add(layer, index + offset));
    return collection;
  }

  function clear() {
    removeErrorListeners.forEach((remove) => remove());
    removeErrorListeners = [];
    layers.forEach((layer) => {
      if (home) home.remove(layer, true);
      else layer.destroy?.();
    });
    layers = [];
    home = null;
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
      home = place();
    },
    shown: () => layers.length > 0,
    /** Move both layers to the current host, directly above any base map. */
    rehome() {
      if (!layers.length) return;
      if (home) layers.forEach((layer) => home.remove(layer, false));
      home = place();
    },
    clear,
    destroy: clear,
  };
}
