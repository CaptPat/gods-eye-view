import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  CHART_DEPTHS_OPACITY,
  DEPTH_BANDS_OPACITY,
  createChartDepthsLayer,
  createDepthBandsLayer,
  createMarineDepthsImagery,
} from './imagery.js';
import {
  CHART_DEPTHS_MIN_TERRAIN_LEVEL,
  DEPTH_BANDS_MAX_LEVEL,
  DEPTH_RENDERING_RULE_JSON,
  NOAA_CHART_WMS_URL,
} from './model.js';

function fakeViewer({ globeShown = true, base = true } = {}) {
  const list = base ? [{ base: true }] : [];
  const removed = [];
  return {
    list,
    removed,
    scene: { globe: { show: globeShown } },
    imageryLayers: {
      get length() {
        return list.length;
      },
      add(layer, index) {
        if (index === undefined) list.push(layer);
        else list.splice(index, 0, layer);
        return layer;
      },
      remove(layer, destroy) {
        const index = list.indexOf(layer);
        if (index < 0) return false;
        list.splice(index, 1);
        removed.push({ layer, destroy });
        return true;
      },
    },
  };
}

function fakeLayer(name) {
  const listeners = new Set();
  return {
    name,
    listeners,
    imageryProvider: {
      errorEvent: {
        addEventListener(fn) {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
      },
    },
  };
}

test('the band layer asks NCEI for masked depth bands in Web Mercator', () => {
  const layer = createDepthBandsLayer();
  assert.ok(layer instanceof Cesium.ImageryLayer);
  assert.equal(layer.alpha, DEPTH_BANDS_OPACITY);
  const provider = layer.imageryProvider;
  assert.ok(provider instanceof Cesium.UrlTemplateImageryProvider);
  assert.ok(provider.tilingScheme instanceof Cesium.WebMercatorTilingScheme);
  assert.equal(provider.maximumLevel, DEPTH_BANDS_MAX_LEVEL);
  const url = new URL(
    provider._resource
      .getDerivedResource({
        templateValues: {
          westProjected: 1,
          southProjected: 2,
          eastProjected: 3,
          northProjected: 4,
          width: 256,
          height: 256,
          renderingRule: DEPTH_RENDERING_RULE_JSON,
        },
      })
      .getUrlComponent(true),
  );
  assert.equal(url.searchParams.get('bbox'), '1,2,3,4');
  assert.equal(url.searchParams.get('size'), '256,256');
  assert.deepEqual(
    JSON.parse(url.searchParams.get('renderingRule')),
    JSON.parse(DEPTH_RENDERING_RULE_JSON),
    'the rule survives Cesium templating intact',
  );
});

test('the chart layer is NOAA depths only, close up, with picking off', () => {
  const layer = createChartDepthsLayer();
  assert.ok(layer instanceof Cesium.ImageryLayer);
  assert.equal(layer.alpha, CHART_DEPTHS_OPACITY);
  assert.equal(layer._minimumTerrainLevel, CHART_DEPTHS_MIN_TERRAIN_LEVEL);
  const provider = layer.imageryProvider;
  assert.ok(provider instanceof Cesium.WebMapServiceImageryProvider);
  assert.equal(provider.layers, '2');
  assert.equal(provider.url, NOAA_CHART_WMS_URL);
  assert.equal(provider.enablePickFeatures, false);
  assert.ok(provider.tilingScheme instanceof Cesium.WebMercatorTilingScheme);
});

test('show stacks bands then chart above the base map, once', () => {
  const viewer = fakeViewer();
  const bands = fakeLayer('bands');
  const chart = fakeLayer('chart');
  const imagery = createMarineDepthsImagery(viewer, {
    createBands: () => bands,
    createChart: () => chart,
  });
  assert.equal(imagery.shown(), false);
  imagery.show();
  imagery.show();
  assert.deepEqual(
    viewer.list.map((l) => l.name ?? 'base'),
    ['base', 'bands', 'chart'],
  );
  assert.equal(imagery.shown(), true);
});

test('reseat follows the stack; clear removes and destroys both layers', () => {
  const viewer = fakeViewer({ globeShown: false, base: false });
  const errors = [];
  const bands = fakeLayer('bands');
  const chart = fakeLayer('chart');
  const imagery = createMarineDepthsImagery(viewer, {
    createBands: () => bands,
    createChart: () => chart,
    onTileError: (e) => errors.push(e),
  });
  imagery.show();
  assert.deepEqual(
    viewer.list.map((l) => l.name),
    ['bands', 'chart'],
  );
  [...chart.listeners][0]('boom');
  assert.deepEqual(errors, ['boom']);

  viewer.list.push({ base: true });
  viewer.scene.globe.show = true;
  imagery.reseat();
  assert.deepEqual(
    viewer.list.map((l) => l.name ?? 'base'),
    ['base', 'bands', 'chart'],
  );

  viewer.removed.length = 0;
  imagery.clear();
  assert.deepEqual(viewer.removed, [
    { layer: bands, destroy: true },
    { layer: chart, destroy: true },
  ]);
  assert.equal(chart.listeners.size, 0, 'error listeners are released');
  assert.equal(imagery.shown(), false);
  imagery.reseat();
  assert.equal(viewer.list.length, 1, 'nothing to reseat once cleared');
});
