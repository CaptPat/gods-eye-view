import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createBandRendering } from './rendering.js';

const T = Cesium.JulianDate.now();
const LEVELS = [
  { color: '#7cff6b', alpha: 0.2 },
  { color: '#ff3dd8', alpha: 0.45 },
];
const BANDS = [
  { level: 0, west: -10, south: 60, east: 10, north: 61 },
  { level: 1, west: 20, south: 65, east: 40, north: 66 },
  { level: 7, west: 0, south: 0, east: 1, north: 1 },
];

function fakeViewer() {
  const sources = [];
  return {
    sources,
    dataSources: {
      add(source) {
        sources.push(source);
        return Promise.resolve(source);
      },
      remove(source) {
        const index = sources.indexOf(source);
        if (index >= 0) sources.splice(index, 1);
        return index >= 0;
      },
    },
  };
}

function harness() {
  const viewer = fakeViewer();
  const renders = [];
  const rendering = createBandRendering(viewer, {
    id: 'aurora-forecast',
    levels: LEVELS,
    requestRender: (reason) => renders.push(reason),
  });
  return { viewer, renders, rendering };
}

test('bands become hidden ground rectangles coloured by level; unknown levels are skipped', () => {
  const { viewer, renders, rendering } = harness();
  assert.equal(viewer.sources.length, 1);
  assert.equal(rendering.dataSource.show, false);
  assert.equal(rendering.setBands(BANDS), 2);
  const entities = rendering.dataSource.entities.values;
  assert.equal(entities.length, 2);
  const [first, second] = entities;
  assert.equal(first.id, 'aurora-forecast:0');
  const rectangle = first.rectangle.coordinates.getValue(T);
  assert.ok(
    Cesium.Rectangle.equalsEpsilon(
      rectangle,
      Cesium.Rectangle.fromDegrees(-10, 60, 10, 61),
      1e-12,
    ),
  );
  assert.equal(
    first.rectangle.classificationType.getValue(T),
    Cesium.ClassificationType.BOTH,
  );
  assert.ok(
    first.rectangle.material
      .getValue(T)
      .color.equals(Cesium.Color.fromCssColorString('#7cff6b').withAlpha(0.2)),
  );
  assert.ok(
    second.rectangle.material
      .getValue(T)
      .color.equals(Cesium.Color.fromCssColorString('#ff3dd8').withAlpha(0.45)),
  );
  assert.deepEqual(renders, ['aurora-forecast']);
});

test('new bands replace the old ones; show and destroy request renders and release the source', () => {
  const { viewer, renders, rendering } = harness();
  rendering.setBands(BANDS);
  assert.equal(rendering.setBands(BANDS.slice(1, 2)), 1);
  assert.equal(rendering.dataSource.entities.values.length, 1);
  assert.equal(rendering.dataSource.entities.values[0].id, 'aurora-forecast:0');
  rendering.setShow(true);
  assert.equal(rendering.dataSource.show, true);
  rendering.clear();
  assert.equal(rendering.dataSource.entities.values.length, 0);
  assert.equal(renders.length, 4);
  rendering.destroy();
  assert.equal(viewer.sources.length, 0);
});
