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

test('without a base map the layer sits at the bottom; rehome follows the stack; clear removes it', () => {
  const viewer = fakeViewer({ globeShown: false, base: false });
  const imagery = createSeaIceImagery(viewer);
  imagery.show('2026-09-07');
  const [layer] = viewer.list;
  assert.ok(layer instanceof Cesium.ImageryLayer);

  viewer.list.push({ base: true });
  viewer.scene.globe.show = true;
  imagery.rehome();
  assert.equal(viewer.list[1], layer, 'back above the new base map');
  assert.deepEqual(viewer.removed, [{ layer, destroy: false }]);

  imagery.clear();
  assert.equal(viewer.list.includes(layer), false);
  imagery.rehome();
  assert.equal(viewer.list.length, 1, 'nothing to rehome once cleared');
  imagery.show('2026-09-07');
  assert.equal(viewer.list.length, 2, 'showing after clearing draws again');
  imagery.destroy();
  assert.equal(viewer.list.length, 1);
});

/** A tileset's own imagery collection (Google 3D). */
function fakeCollection() {
  const list = [];
  return {
    list,
    get length() {
      return list.length;
    },
    add(layer, index) {
      if (index === undefined) list.push(layer);
      else list.splice(index, 0, layer);
      return layer;
    },
    remove(layer) {
      const index = list.indexOf(layer);
      if (index < 0) return false;
      list.splice(index, 1);
      return true;
    },
  };
}

test('on Google 3D the day drapes onto the tileset, and follows the map source back to the globe', () => {
  const viewer = fakeViewer({ globeShown: false, base: false });
  const tileset = fakeCollection();
  let host = { collection: tileset, kind: 'tileset' };
  const imagery = createSeaIceImagery(viewer, { host: () => host });
  imagery.setAlpha(0.8);
  imagery.show('2026-09-07');
  assert.equal(viewer.list.length, 0, 'nothing on the hidden globe');
  assert.equal(tileset.list.length, 1);
  assert.equal(tileset.list[0].alpha, 0.8);

  viewer.list.push({ base: true });
  viewer.scene.globe.show = true;
  host = { collection: viewer.imageryLayers, kind: 'globe' };
  imagery.rehome();
  assert.equal(tileset.list.length, 0);
  assert.equal(viewer.list.length, 2);
  assert.ok(viewer.list[1] instanceof Cesium.ImageryLayer, 'above the base');

  imagery.clear();
  assert.equal(viewer.list.length, 1);
});

test('with nowhere to drape, the day waits detached and is destroyed when cleared', () => {
  const viewer = fakeViewer({ globeShown: false, base: false });
  let destroyed = 0;
  const imagery = createSeaIceImagery(viewer, {
    host: () => ({ collection: null, kind: 'none' }),
    createLayer: () => ({ alpha: 1, destroy: () => (destroyed += 1) }),
  });
  imagery.show('2026-09-07');
  assert.equal(viewer.list.length, 0);
  imagery.show('2026-09-08');
  assert.equal(destroyed, 1, 'the replaced day is destroyed');
  imagery.clear();
  assert.equal(destroyed, 2);
});
