import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createSeaIceImagery } from './imagery.js';
import { SEA_ICE_MAX_LEVEL, seaIceTileTemplate } from './model.js';

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

test('a day draws as one GIBS imagery layer directly above the base map', () => {
  const viewer = fakeViewer();
  const imagery = createSeaIceImagery(viewer);
  imagery.setAlpha(0.8);
  imagery.show('2026-09-07');
  assert.equal(viewer.list.length, 2);
  const [, layer] = viewer.list;
  assert.ok(layer instanceof Cesium.ImageryLayer);
  assert.equal(layer.alpha, 0.8);
  const provider = layer.imageryProvider;
  assert.ok(provider instanceof Cesium.UrlTemplateImageryProvider);
  assert.equal(provider.maximumLevel, SEA_ICE_MAX_LEVEL);
  assert.equal(decodeURI(provider.url), seaIceTileTemplate('2026-09-07'));

  imagery.show('2026-09-07');
  assert.equal(viewer.list.length, 2, 'the same day is kept');
  imagery.show('2026-09-08');
  assert.equal(viewer.list.length, 2);
  assert.notEqual(viewer.list[1], layer);
  assert.deepEqual(viewer.removed, [{ layer, destroy: true }]);
  assert.equal(
    decodeURI(viewer.list[1].imageryProvider.url),
    seaIceTileTemplate('2026-09-08'),
  );

  imagery.setAlpha(0.5);
  assert.equal(viewer.list[1].alpha, 0.5);
});

test('without a base map the layer sits at the bottom; reseat follows the stack; clear removes it', () => {
  const viewer = fakeViewer({ globeShown: false, base: false });
  const imagery = createSeaIceImagery(viewer);
  imagery.show('2026-09-07');
  const [layer] = viewer.list;
  assert.ok(layer instanceof Cesium.ImageryLayer);

  viewer.list.push({ base: true });
  viewer.scene.globe.show = true;
  imagery.reseat();
  assert.equal(viewer.list[1], layer, 'back above the new base map');
  assert.deepEqual(viewer.removed, [{ layer, destroy: false }]);

  imagery.clear();
  assert.equal(viewer.list.includes(layer), false);
  imagery.reseat();
  assert.equal(viewer.list.length, 1, 'nothing to reseat once cleared');
  imagery.show('2026-09-07');
  assert.equal(viewer.list.length, 2, 'showing after clearing draws again');
  imagery.destroy();
  assert.equal(viewer.list.length, 1);
});
