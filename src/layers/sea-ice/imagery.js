import * as Cesium from 'cesium';
import { SEA_ICE_MAX_LEVEL, seaIceTileTemplate } from './model.js';

/**
 * Directly above the base map when the globe shows one (index 0 holds it),
 * otherwise at the bottom. Evaluated on every insert, never cached, so it
 * follows map-stack switches (the Weather Overlays rule).
 */
export function seaIceInsertIndex(viewer) {
  return viewer?.scene?.globe?.show ? 1 : 0;
}

function createDayLayer(day) {
  return new Cesium.ImageryLayer(
    new Cesium.UrlTemplateImageryProvider({
      url: seaIceTileTemplate(day),
      tileWidth: 256,
      tileHeight: 256,
      maximumLevel: SEA_ICE_MAX_LEVEL,
    }),
  );
}

/** One imagery layer for the day shown; a new day replaces it. */
export function createSeaIceImagery(
  viewer,
  { createLayer = createDayLayer } = {},
) {
  let layer = null;
  let shownDay = null;
  let alpha = 1;

  function insert(target) {
    viewer.imageryLayers.add(
      target,
      Math.min(seaIceInsertIndex(viewer), viewer.imageryLayers.length),
    );
  }

  function clear() {
    if (layer) viewer.imageryLayers.remove(layer, true);
    layer = null;
    shownDay = null;
  }

  return {
    show(day) {
      if (layer && day === shownDay) return;
      clear();
      layer = createLayer(day);
      layer.alpha = alpha;
      shownDay = day;
      insert(layer);
    },
    setAlpha(nextAlpha) {
      alpha = nextAlpha;
      if (layer) layer.alpha = alpha;
    },
    /** Move the layer back above the base map after the stack changed beneath it. */
    reseat() {
      if (!layer) return;
      viewer.imageryLayers.remove(layer, false);
      insert(layer);
    },
    clear,
    destroy: clear,
  };
}
