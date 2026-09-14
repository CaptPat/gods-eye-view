import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  CLOUD_CLEAR_THRESHOLD,
  OVERLAY_INSERT_INDEX,
  createOverlayImagery,
  createOverlayLayer,
  createOverlayProvider,
  overlayTemplate,
} from './imagery.js';

const T = Date.UTC(2026, 8, 14, 15);

test('the URL template points at the proxy with Cesium tile tags', () => {
  assert.equal(
    overlayTemplate('pollen-grass', T),
    `/api/weather-overlays/tiles/pollen-grass/${T}/{z}/{x}/{y}.png`,
  );
});

test('providers cap zoom per mode, and Google imagery carries its attribution on screen', () => {
  const air = createOverlayProvider('air-quality', T);
  assert.ok(air instanceof Cesium.UrlTemplateImageryProvider);
  assert.equal(air.maximumLevel, 12);
  assert.equal(
    air.credit.html,
    'Source: Includes air quality data from Google',
  );
  assert.equal(air.credit.showOnScreen, true);

  const pollen = createOverlayProvider('pollen-weed', T);
  assert.equal(pollen.maximumLevel, 10);
  assert.equal(pollen.credit.html, 'Source: Includes pollen data from Google');
  assert.equal(pollen.credit.showOnScreen, true);

  assert.equal(createOverlayProvider('clouds', T).maximumLevel, 7);
  assert.equal(createOverlayProvider('clouds', T).credit, undefined);
  assert.equal(createOverlayProvider('temperature', T).maximumLevel, 6);
});

test('cloud layers turn dark, warm pixels transparent; other modes draw as served', () => {
  const clouds = createOverlayLayer(
    createOverlayProvider('clouds', T),
    'clouds',
  );
  assert.ok(clouds instanceof Cesium.ImageryLayer);
  assert.ok(Cesium.Color.equals(clouds.colorToAlpha, Cesium.Color.BLACK));
  assert.equal(clouds.colorToAlphaThreshold, CLOUD_CLEAR_THRESHOLD);
  assert.equal(CLOUD_CLEAR_THRESHOLD, 0.3);
  const temperature = createOverlayLayer(
    createOverlayProvider('temperature', T),
    'temperature',
  );
  assert.equal(temperature.colorToAlpha, undefined);
});

test('overlay frames sit directly above the base map, below radar layers', () => {
  const listeners = new Set();
  const layers = [{ base: true }, { radar: true }];
  const viewer = {
    imageryLayers: {
      get length() {
        return layers.length;
      },
      add(layer, index) {
        if (index === undefined) layers.push(layer);
        else layers.splice(index, 0, layer);
      },
      remove(layer) {
        layers.splice(layers.indexOf(layer), 1);
      },
    },
    scene: {
      globe: {
        tileLoadProgressEvent: {
          addEventListener: (listener) => (
            listeners.add(listener),
            () => listeners.delete(listener)
          ),
        },
      },
    },
  };
  assert.equal(OVERLAY_INSERT_INDEX, 1);
  const imagery = createOverlayImagery(viewer, {
    createProvider: (source, time) => ({ source, time }),
    createLayer: (provider, source) => ({ provider, source, alpha: 1 }),
  });
  imagery.setSource('temperature');
  imagery.show(T);
  assert.deepEqual(
    layers.map((layer) =>
      layer.base ? 'base' : layer.radar ? 'radar' : layer.source,
    ),
    ['base', 'temperature', 'radar'],
  );
  imagery.destroy();
  assert.equal(listeners.size, 0);
});
