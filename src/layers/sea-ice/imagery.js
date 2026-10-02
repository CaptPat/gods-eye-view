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

/**
 * One imagery layer for the day shown; a new day replaces it. It goes to the
 * collection `host()` names: the globe's `imageryLayers`, the Google 3D
 * tileset's own `imageryLayers` (Cesium drapes it onto the tiles), or none, in
 * which case it waits detached until `rehome()` finds one.
 */
export function createSeaIceImagery(
  viewer,
  {
    createLayer = createDayLayer,
    host = () => ({ collection: viewer.imageryLayers, kind: 'globe' }),
  } = {},
) {
  let layer = null;
  let home = null;
  let shownDay = null;
  let alpha = 1;

  function place(target) {
    const collection = host()?.collection ?? null;
    if (collection) {
      collection.add(
        target,
        Math.min(seaIceInsertIndex(viewer), collection.length),
      );
    }
    return collection;
  }

  function clear() {
    if (layer) {
      if (home) home.remove(layer, true);
      else layer.destroy?.();
    }
    layer = null;
    home = null;
    shownDay = null;
  }

  return {
    show(day) {
      if (layer && day === shownDay) return;
      clear();
      layer = createLayer(day);
      layer.alpha = alpha;
      shownDay = day;
      home = place(layer);
    },
    setAlpha(nextAlpha) {
      alpha = nextAlpha;
      if (layer) layer.alpha = alpha;
    },
    /** Move the layer to the current host, directly above any base map. */
    rehome() {
      if (!layer) return;
      if (home) home.remove(layer, false);
      home = place(layer);
    },
    clear,
    destroy: clear,
  };
}
