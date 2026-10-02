import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  createOverlayImagery,
  createOverlayProvider,
  overlayInsertIndex,
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
});

test('on 3D tiles the Google credit is put on screen directly; the globe shows the provider credit itself', () => {
  const shownCredits = new Set();
  const viewer = {
    ...fakeViewer([], { globeShow: false }),
    creditDisplay: {
      addStaticCredit: (credit) => shownCredits.add(credit),
      removeStaticCredit: (credit) => shownCredits.delete(credit),
    },
  };
  const tileset = { add() {}, remove() {}, length: 0 };
  let host = { collection: tileset, kind: 'tileset' };
  const imagery = createOverlayImagery(viewer, {
    ...overlayFactories(),
    host: () => host,
  });
  const onScreen = () => [...shownCredits].map((credit) => credit.html);

  imagery.setSource('air-quality');
  assert.deepEqual(onScreen(), [], 'nothing drawn yet');
  imagery.show(T);
  assert.deepEqual(onScreen(), [
    'Source: Includes air quality data from Google',
  ]);
  assert.equal([...shownCredits][0].showOnScreen, true);

  imagery.setSource('pollen-grass');
  imagery.show(T);
  assert.deepEqual(onScreen(), ['Source: Includes pollen data from Google']);

  host = { collection: viewer.imageryLayers, kind: 'globe' };
  imagery.rehome();
  assert.deepEqual(onScreen(), [], 'the globe draws the provider credit');

  host = { collection: tileset, kind: 'tileset' };
  imagery.rehome();
  assert.equal(onScreen().length, 1);
  imagery.clear();
  assert.deepEqual(onScreen(), [], 'cleared imagery takes its credit away');

  imagery.show(T);
  imagery.destroy();
  assert.deepEqual(onScreen(), []);
});

/** A minimal fake viewer whose `scene.globe.show` drives overlayInsertIndex. */
function fakeViewer(initial = [], { globeShow = false } = {}) {
  const listeners = new Set();
  const layers = [...initial];
  return {
    layers,
    imageryLayers: {
      get length() {
        return layers.length;
      },
      add(layer, index) {
        if (index === undefined) layers.push(layer);
        else layers.splice(index, 0, layer);
      },
      remove(layer) {
        const index = layers.indexOf(layer);
        if (index >= 0) layers.splice(index, 1);
        return index >= 0;
      },
    },
    scene: {
      globe: {
        show: globeShow,
        tileLoadProgressEvent: {
          addEventListener: (listener) => (
            listeners.add(listener),
            () => listeners.delete(listener)
          ),
        },
      },
    },
    listenerCount: () => listeners.size,
  };
}

const layerNames = (layers) =>
  layers.map((layer) =>
    layer.base ? 'base' : layer.radar ? 'radar' : layer.source,
  );

const overlayFactories = () => ({
  createProvider: (source, time) => ({ source, time }),
  createLayer: (provider, source) => ({ provider, source, alpha: 1 }),
});

test('overlayInsertIndex: below any base layer when there is one, otherwise index 0', () => {
  assert.equal(overlayInsertIndex({ scene: { globe: { show: true } } }), 1);
  assert.equal(overlayInsertIndex({ scene: { globe: { show: false } } }), 0);
  assert.equal(overlayInsertIndex(undefined), 0, 'no viewer: never crash');
});

test('an empty collection takes the overlay at index 0', () => {
  const viewer = fakeViewer([], { globeShow: false });
  const imagery = createOverlayImagery(viewer, overlayFactories());
  imagery.setSource('air-quality');
  imagery.show(T);
  assert.deepEqual(layerNames(viewer.layers), ['air-quality']);
});

test('a collection holding only radar: the overlay lands below it (no base layer yet)', () => {
  const viewer = fakeViewer([{ radar: true }], { globeShow: false });
  const imagery = createOverlayImagery(viewer, overlayFactories());
  imagery.setSource('air-quality');
  imagery.show(T);
  assert.deepEqual(layerNames(viewer.layers), ['air-quality', 'radar']);
});

test('a base layer plus radar: the overlay lands between them', () => {
  const viewer = fakeViewer([{ base: true }, { radar: true }], {
    globeShow: true,
  });
  const imagery = createOverlayImagery(viewer, overlayFactories());
  imagery.setSource('air-quality');
  imagery.show(T);
  assert.deepEqual(layerNames(viewer.layers), ['base', 'air-quality', 'radar']);
  imagery.destroy();
  assert.equal(viewer.listenerCount(), 0);
});

test('a map-stack change that adds a base layer re-homes the overlay above it, below radar', () => {
  // Photoreal-to-globe switch, radar already enabled: overlay starts with no
  // base layer beneath it (index 0).
  const viewer = fakeViewer([{ radar: true }], { globeShow: false });
  const imagery = createOverlayImagery(viewer, overlayFactories());
  imagery.setSource('air-quality');
  imagery.show(T);
  assert.deepEqual(layerNames(viewer.layers), ['air-quality', 'radar']);

  // The map controller adds the new base layer; something else (a stand-in
  // for anything that could touch the collection directly) displaces the
  // overlay's own layer to the top in the process.
  viewer.scene.globe.show = true;
  viewer.imageryLayers.add({ base: true }, 0);
  const overlayLayer = viewer.layers.find((layer) => layer.source);
  viewer.imageryLayers.remove(overlayLayer);
  viewer.imageryLayers.add(overlayLayer);
  assert.deepEqual(
    layerNames(viewer.layers),
    ['base', 'radar', 'air-quality'],
    'displaced above radar — the bug this finding fixes',
  );

  // rehome() is what the layer's map-stack listener calls: it must put the
  // overlay back above the base and below radar, however it got displaced.
  imagery.rehome();
  assert.deepEqual(
    layerNames(viewer.layers),
    ['base', 'air-quality', 'radar'],
    'rehome restores the overlay directly above the base, below radar',
  );
});
