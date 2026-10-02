import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRELOAD_ALPHA,
  createFrameImagery,
  swapToFrame,
} from './frameImagery.js';
import { IMAGERY_OPACITIES, normalizeImageryOpacity } from './opacity.js';

function fakeViewer(initial = [{ base: true }]) {
  const listeners = new Set();
  const layers = [...initial];
  return {
    layers,
    progress: (queued) => {
      for (const listener of [...listeners]) listener(queued);
    },
    listenerCount: () => listeners.size,
    imageryLayers: {
      get length() {
        return layers.length;
      },
      add(layer, index) {
        if (index === undefined) layers.push(layer);
        else layers.splice(index, 0, layer);
        return layer;
      },
      remove(layer) {
        const index = layers.indexOf(layer);
        if (index >= 0) layers.splice(index, 1);
        return index >= 0;
      },
    },
    scene: {
      globe: {
        tileLoadProgressEvent: {
          addEventListener(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
        },
      },
    },
  };
}

const factories = () => ({
  createProvider: (source, time) => ({ source, time }),
  createLayer: (provider, source) => ({
    provider,
    source,
    alpha: 1,
    show: true,
  }),
});

const frameLayers = (viewer) => viewer.layers.filter((layer) => layer.provider);

test('opacity snaps only to the three offered steps', () => {
  assert.deepEqual(IMAGERY_OPACITIES, [0.4, 0.7, 1]);
  assert.equal(normalizeImageryOpacity(0.4), 0.4);
  assert.equal(normalizeImageryOpacity('0.7'), 0.7);
  assert.equal(normalizeImageryOpacity(1.0004), 1);
  assert.equal(normalizeImageryOpacity(0.5), null);
  assert.equal(normalizeImageryOpacity('x'), null);
});

test('a provider factory is required, and createLayer receives the source', () => {
  assert.throws(() => createFrameImagery(fakeViewer()), /createProvider/);
  const viewer = fakeViewer();
  const imagery = createFrameImagery(viewer, factories());
  imagery.setSource('clouds');
  imagery.show(1000);
  assert.deepEqual(
    frameLayers(viewer).map((layer) => [layer.source, layer.provider.time]),
    [['clouds', 1000]],
  );
});

test('insertIndex places frames directly above the base map and clamps to the collection', () => {
  const viewer = fakeViewer([{ base: true }, { radar: true }]);
  const imagery = createFrameImagery(viewer, {
    ...factories(),
    insertIndex: 1,
  });
  imagery.setSource('clouds');
  imagery.show(1000);
  assert.deepEqual(
    viewer.layers.map((layer) =>
      layer.base ? 'base' : layer.radar ? 'radar' : layer.source,
    ),
    ['base', 'clouds', 'radar'],
  );

  const empty = fakeViewer([]);
  const clamped = createFrameImagery(empty, { ...factories(), insertIndex: 1 });
  clamped.setSource('clouds');
  clamped.show(1000);
  assert.equal(
    empty.layers.length,
    1,
    'an empty collection takes the layer at index 0',
  );
});

test('insertIndex may be a function, evaluated fresh on every add', () => {
  const viewer = fakeViewer([{ radar: true }]);
  let base = false;
  const imagery = createFrameImagery(viewer, {
    ...factories(),
    insertIndex: () => (base ? 1 : 0),
  });
  imagery.setSource('clouds');
  imagery.show(1000);
  assert.deepEqual(
    viewer.layers.map((layer) => (layer.radar ? 'radar' : layer.source)),
    ['clouds', 'radar'],
    'no base yet: the function is called at add time and returns 0',
  );
});

test('rehome re-derives insertIndex and moves existing frames there', () => {
  const viewer = fakeViewer([{ radar: true }]);
  let index = 1; // wrong on purpose: this would land the frame above radar
  const imagery = createFrameImagery(viewer, {
    ...factories(),
    insertIndex: () => index,
  });
  imagery.setSource('clouds');
  imagery.show(1000);
  assert.deepEqual(
    viewer.layers.map((layer) => (layer.radar ? 'radar' : layer.source)),
    ['radar', 'clouds'],
    'starts above radar, per the stale index',
  );

  index = 0; // the corrected target once, say, the base map changed
  imagery.rehome();
  assert.deepEqual(
    viewer.layers.map((layer) => (layer.radar ? 'radar' : layer.source)),
    ['clouds', 'radar'],
    'rehome moves the frame to the freshly resolved index',
  );
});

test('rehome leaves a frame in place on the same host when insertIndex was never given', () => {
  const viewer = fakeViewer([{ base: true }, { radar: true }]);
  const imagery = createFrameImagery(viewer, factories());
  imagery.setSource('rainviewer');
  imagery.show(1000);
  assert.deepEqual(
    viewer.layers.map((layer) =>
      layer.base ? 'base' : layer.radar ? 'radar' : layer.source,
    ),
    ['base', 'radar', 'rainviewer'],
  );
  imagery.rehome();
  assert.deepEqual(
    viewer.layers.map((layer) =>
      layer.base ? 'base' : layer.radar ? 'radar' : layer.source,
    ),
    ['base', 'radar', 'rainviewer'],
    'still on top: rehome never moves a layer with no insertIndex',
  );
});

/** A bare imagery collection, like a 3D tileset's `imageryLayers`. */
function fakeCollection() {
  const layers = [];
  return {
    layers,
    get length() {
      return layers.length;
    },
    add(layer, index) {
      if (index === undefined) layers.push(layer);
      else layers.splice(index, 0, layer);
      return layer;
    },
    remove(layer) {
      const index = layers.indexOf(layer);
      if (index >= 0) layers.splice(index, 1);
      return index >= 0;
    },
  };
}

test('frames go to the host collection, and rehome moves them when the map source changes', () => {
  const viewer = fakeViewer();
  const tileset = fakeCollection();
  let host = { collection: viewer.imageryLayers, kind: 'globe' };
  const imagery = createFrameImagery(viewer, {
    ...factories(),
    insertIndex: () => (host.kind === 'globe' ? 1 : 0),
    host: () => host,
  });
  imagery.setSource('air-quality');
  imagery.setAlpha(0.7);
  imagery.show(1000);
  assert.equal(frameLayers(viewer).length, 1, 'on the globe first');

  host = { collection: tileset, kind: 'tileset' };
  imagery.rehome();
  assert.equal(frameLayers(viewer).length, 0, 'gone from the hidden globe');
  assert.deepEqual(
    tileset.layers.map((layer) => [layer.provider.time, layer.alpha]),
    [[1000, 0.7]],
    'draped on the 3D tiles at the shown alpha',
  );
  assert.equal(imagery.shownTime(), 1000);

  host = { collection: viewer.imageryLayers, kind: 'globe' };
  imagery.rehome();
  assert.equal(tileset.layers.length, 0);
  assert.deepEqual(
    viewer.layers.map((layer) => (layer.base ? 'base' : layer.source)),
    ['base', 'air-quality'],
    'back above the base map',
  );
});

test('a frame added on a 3D tileset is ready at once: the globe never reports its tiles', () => {
  const viewer = fakeViewer();
  const tileset = fakeCollection();
  const imagery = createFrameImagery(viewer, {
    ...factories(),
    host: () => ({ collection: tileset, kind: 'tileset' }),
  });
  imagery.setSource('pollen-tree');
  assert.equal(swapToFrame(imagery, 1000), true);
  assert.equal(
    swapToFrame(imagery, 2000),
    true,
    'the next hour swaps in without waiting for globe tile progress',
  );
  assert.deepEqual(
    tileset.layers.map((layer) => layer.provider.time),
    [2000],
  );
});

test('with no host the frames wait detached, and are placed once a host returns', () => {
  const viewer = fakeViewer();
  let host = { collection: null, kind: 'none' };
  const imagery = createFrameImagery(viewer, {
    ...factories(),
    host: () => host,
  });
  imagery.setSource('air-quality');
  imagery.show(1000);
  assert.equal(frameLayers(viewer).length, 0);
  assert.equal(imagery.shownTime(), 1000, 'still the shown frame');

  host = { collection: viewer.imageryLayers, kind: 'globe' };
  imagery.rehome();
  assert.equal(frameLayers(viewer).length, 1);

  host = { collection: null, kind: 'none' };
  imagery.rehome();
  assert.equal(frameLayers(viewer).length, 0);
});

test('a detached frame is destroyed when released, since no collection owns it', () => {
  const viewer = fakeViewer();
  let destroyed = 0;
  const imagery = createFrameImagery(viewer, {
    createProvider: (source, time) => ({ source, time }),
    createLayer: (provider, source) => ({
      provider,
      source,
      alpha: 1,
      destroy: () => (destroyed += 1),
    }),
    host: () => ({ collection: null, kind: 'none' }),
  });
  imagery.setSource('air-quality');
  imagery.show(1000);
  imagery.preload([2000]);
  imagery.clear();
  assert.equal(imagery.shownTime(), null);
  assert.equal(destroyed, 2);
});

test('swapToFrame shows at once when nothing is shown, and otherwise waits for readiness', () => {
  const viewer = fakeViewer();
  const imagery = createFrameImagery(viewer, factories());
  imagery.setSource('clouds');
  imagery.setAlpha(0.7);
  assert.equal(swapToFrame(imagery, 1000), true);
  assert.equal(imagery.shownTime(), 1000);

  assert.equal(
    swapToFrame(imagery, 2000),
    false,
    'the new frame is not ready yet',
  );
  assert.equal(imagery.shownTime(), 1000);
  assert.deepEqual(
    frameLayers(viewer).map((layer) => [layer.provider.time, layer.alpha]),
    [
      [1000, 0.7],
      [2000, PRELOAD_ALPHA],
    ],
  );

  viewer.progress(0);
  assert.equal(swapToFrame(imagery, 2000), true);
  assert.equal(imagery.shownTime(), 2000);
  assert.deepEqual(
    frameLayers(viewer).map((layer) => layer.provider.time),
    [2000],
  );
  assert.equal(
    swapToFrame(imagery, 2000),
    true,
    'the shown frame counts as shown',
  );

  imagery.destroy();
  assert.equal(viewer.listenerCount(), 0);
  assert.deepEqual(viewer.layers, [{ base: true }]);
});
