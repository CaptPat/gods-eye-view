import * as Cesium from 'cesium';

/** Loaded but effectively invisible: Cesium still requests tiles for it. */
export const PRELOAD_ALPHA = 0.001;
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

export function createRadarImagery(
  viewer,
  {
    createProvider: makeProvider = createProvider,
    createLayer = (provider) => new Cesium.ImageryLayer(provider),
  } = {},
) {
  const layers = new Map();
  const pending = new Set();
  const ready = new Set();
  let source = null;
  let shown = null;
  let alpha = 0.7;

  const removeProgressListener =
    viewer.scene.globe.tileLoadProgressEvent.addEventListener((queued) => {
      if (queued !== 0) return;
      for (const time of pending) ready.add(time);
      pending.clear();
    });

  function remove(time) {
    const layer = layers.get(time);
    if (!layer) return;
    viewer.imageryLayers.remove(layer, true);
    layers.delete(time);
    pending.delete(time);
    ready.delete(time);
    if (shown === time) shown = null;
  }

  function ensure(time) {
    if (layers.has(time)) return layers.get(time);
    const layer = createLayer(makeProvider(source, time));
    layer.alpha = PRELOAD_ALPHA;
    layer.show = true;
    viewer.imageryLayers.add(layer);
    layers.set(time, layer);
    pending.add(time);
    return layer;
  }

  return {
    setSource(nextSource) {
      if (nextSource === source) return;
      for (const time of [...layers.keys()]) remove(time);
      source = nextSource;
    },
    preload(times) {
      for (const time of times) ensure(time);
    },
    show(time) {
      if (shown !== null && shown !== time && layers.has(shown))
        layers.get(shown).alpha = PRELOAD_ALPHA;
      ensure(time).alpha = alpha;
      shown = time;
    },
    setAlpha(nextAlpha) {
      alpha = nextAlpha;
      if (shown !== null && layers.has(shown)) layers.get(shown).alpha = alpha;
    },
    release(keepTimes) {
      const keep = new Set(keepTimes);
      for (const time of [...layers.keys()]) if (!keep.has(time)) remove(time);
    },
    isReady: (time) => ready.has(time),
    readyCount: () =>
      [...layers.keys()].filter((time) => ready.has(time)).length,
    shownTime: () => shown,
    clear() {
      for (const time of [...layers.keys()]) remove(time);
    },
    destroy() {
      this.clear();
      removeProgressListener();
    },
  };
}
