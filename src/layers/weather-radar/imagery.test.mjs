import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  PRELOAD_ALPHA,
  createProvider,
  createRadarImagery,
  iemTemplate,
  rainViewerTemplate,
} from './imagery.js';

const T = Date.UTC(2026, 8, 14, 4, 50);
const MIN = 60_000;

function fakeViewer() {
  const listeners = new Set();
  const layers = [{ base: true }];
  return {
    layers,
    progress: (queued) => {
      for (const listener of [...listeners]) listener(queued);
    },
    listenerCount: () => listeners.size,
    imageryLayers: {
      add(layer) {
        layers.push(layer);
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

const fakeFactories = () => ({
  createProvider: (source, time) => ({ source, time }),
  createLayer: (provider) => ({ provider, alpha: 1, show: true }),
});

const radarLayers = (viewer) => viewer.layers.filter((layer) => !layer.base);

test('URL templates point at the proxy with Cesium tile tags', () => {
  assert.equal(
    rainViewerTemplate(T),
    `/api/radar/rainviewer/${T}/{z}/{x}/{y}.png`,
  );
  assert.equal(
    iemTemplate(T),
    '/api/radar/iem?time=2026-09-14T04:50:00Z&bbox={westDegrees},{southDegrees},{eastDegrees},{northDegrees}&width={width}&height={height}',
  );
});

test('providers: RainViewer capped at zoom 7; IEM geographic, level 3-9, over the contiguous US', () => {
  const rainviewer = createProvider('rainviewer', T);
  assert.ok(rainviewer instanceof Cesium.UrlTemplateImageryProvider);
  assert.equal(rainviewer.maximumLevel, 7);
  const iem = createProvider('iem', T);
  assert.ok(iem.tilingScheme instanceof Cesium.GeographicTilingScheme);
  assert.equal(iem.minimumLevel, 3);
  assert.equal(iem.maximumLevel, 9);
  assert.ok(Math.abs(Cesium.Math.toDegrees(iem.rectangle.west) + 130) < 1e-9);
  assert.ok(Math.abs(Cesium.Math.toDegrees(iem.rectangle.north) - 55) < 1e-9);
});

test('preloaded frames sit above the base map, nearly transparent, and become ready when the tile queue drains', () => {
  const viewer = fakeViewer();
  const imagery = createRadarImagery(viewer, fakeFactories());
  imagery.setSource('rainviewer');
  imagery.preload([T - 10 * MIN, T]);
  assert.equal(viewer.layers[0].base, true, 'the base map stays at index 0');
  assert.deepEqual(
    radarLayers(viewer).map((layer) => [layer.provider.time, layer.alpha]),
    [
      [T - 10 * MIN, PRELOAD_ALPHA],
      [T, PRELOAD_ALPHA],
    ],
  );
  assert.equal(imagery.readyCount(), 0);
  viewer.progress(5);
  assert.equal(imagery.readyCount(), 0);
  viewer.progress(0);
  assert.equal(imagery.readyCount(), 2);
  assert.equal(imagery.isReady(T), true);
  imagery.preload([T]);
  assert.equal(
    radarLayers(viewer).length,
    2,
    'preloading an existing frame adds nothing',
  );
});

test('show brings one frame to full opacity and dims the previous; setAlpha follows the shown frame', () => {
  const viewer = fakeViewer();
  const imagery = createRadarImagery(viewer, fakeFactories());
  imagery.setSource('rainviewer');
  imagery.setAlpha(0.7);
  imagery.show(T - 10 * MIN);
  imagery.show(T);
  const [older, newer] = radarLayers(viewer);
  assert.equal(older.alpha, PRELOAD_ALPHA);
  assert.equal(newer.alpha, 0.7);
  assert.equal(imagery.shownTime(), T);
  imagery.setAlpha(0.4);
  assert.equal(newer.alpha, 0.4);
  assert.equal(older.alpha, PRELOAD_ALPHA);
});

test('release keeps only the given frames; a source change and clear remove every radar layer but never the base', () => {
  const viewer = fakeViewer();
  const imagery = createRadarImagery(viewer, fakeFactories());
  imagery.setSource('rainviewer');
  imagery.preload([T - 20 * MIN, T - 10 * MIN, T]);
  imagery.show(T);
  imagery.release([T - 10 * MIN, T]);
  assert.deepEqual(
    radarLayers(viewer).map((layer) => layer.provider.time),
    [T - 10 * MIN, T],
  );
  viewer.layers[0] = { base: true, replaced: true };
  imagery.setSource('iem');
  assert.equal(radarLayers(viewer).length, 0);
  assert.equal(imagery.shownTime(), null);
  imagery.show(T);
  assert.equal(radarLayers(viewer)[0].provider.source, 'iem');
  imagery.clear();
  assert.deepEqual(viewer.layers, [{ base: true, replaced: true }]);
  imagery.destroy();
  assert.equal(viewer.listenerCount(), 0);
});
