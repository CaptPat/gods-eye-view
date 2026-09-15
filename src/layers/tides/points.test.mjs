import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  DEPTH_TEST_DISTANCE_M,
  POINT_PIXEL_SIZE,
  SELECTED_PIXEL_SIZE,
  createStationPoints,
  stationPickId,
} from './points.js';

const STATIONS = [
  { id: '8454000', name: 'Providence', lat: 41.80717, lon: -71.40067 },
  { id: '9063020', name: 'Buffalo', lat: 42.87739, lon: -78.89037 },
];

function fakeViewer() {
  const primitives = [];
  return {
    primitives,
    camera: { positionWC: Cesium.Cartesian3.fromDegrees(0, 0, 12_000_000) },
    scene: {
      preRender: new Cesium.Event(),
      primitives: {
        add(primitive) {
          primitives.push(primitive);
          return primitive;
        },
        remove(primitive) {
          const index = primitives.indexOf(primitive);
          if (index >= 0) primitives.splice(index, 1);
          return index >= 0;
        },
      },
    },
  };
}

test('stations become hidden, pickable points in one collection added to the scene', () => {
  const viewer = fakeViewer();
  const points = createStationPoints(viewer, {
    layerId: 'tide-stations',
    color: '#38bdf8',
  });
  assert.equal(viewer.primitives.length, 1);
  const [collection] = viewer.primitives;
  assert.ok(collection instanceof Cesium.PointPrimitiveCollection);
  assert.equal(collection.show, false);
  assert.equal(points.setStations(STATIONS), 2);
  assert.equal(collection.length, 2);
  const first = collection.get(0);
  assert.equal(first.id, 'tide-stations:8454000');
  assert.equal(first.pixelSize, POINT_PIXEL_SIZE);
  assert.equal(first.disableDepthTestDistance, DEPTH_TEST_DISTANCE_M);
  assert.equal(first.color.toCssHexString(), '#38bdf8');
  const carto = Cesium.Cartographic.fromCartesian(points.positionOf('8454000'));
  assert.ok(Math.abs(Cesium.Math.toDegrees(carto.latitude) - 41.80717) < 1e-6);
  points.setShow(true);
  assert.equal(collection.show, true);
  assert.equal(
    stationPickId('current-stations', 'ACT1616'),
    'current-stations:ACT1616',
  );
});

test("picks resolve only this layer's stations, from either pick path", () => {
  const points = createStationPoints(fakeViewer(), {
    layerId: 'tide-stations',
    color: '#38bdf8',
  });
  points.setStations(STATIONS);
  assert.equal(
    points.stationIdFromPick({ primitive: { id: 'tide-stations:9063020' } }),
    '9063020',
  );
  assert.equal(
    points.stationIdFromPick({ id: 'tide-stations:8454000' }),
    '8454000',
  );
  assert.equal(
    points.stationIdFromPick({ primitive: { id: 'current-stations:8454000' } }),
    null,
  );
  assert.equal(
    points.stationIdFromPick({ primitive: { id: 'tide-stations:0000000' } }),
    null,
  );
  assert.equal(points.stationIdFromPick(undefined), null);
});

test('selection enlarges one point, survives a station refresh, and clears when its station disappears', () => {
  const viewer = fakeViewer();
  const points = createStationPoints(viewer, {
    layerId: 'tide-stations',
    color: '#38bdf8',
  });
  points.setStations(STATIONS);
  points.setSelected('9063020');
  const collection = viewer.primitives[0];
  assert.equal(collection.get(1).pixelSize, SELECTED_PIXEL_SIZE);
  points.setSelected('8454000');
  assert.equal(collection.get(1).pixelSize, POINT_PIXEL_SIZE);
  assert.equal(collection.get(0).pixelSize, SELECTED_PIXEL_SIZE);
  points.setStations(STATIONS);
  assert.equal(points.selectedId(), '8454000');
  assert.equal(collection.get(0).pixelSize, SELECTED_PIXEL_SIZE);
  points.setStations(STATIONS.slice(1));
  assert.equal(points.selectedId(), null);
  points.setSelected('nope');
  assert.equal(points.selectedId(), null);
  points.destroy();
  assert.equal(viewer.primitives.length, 0);
  assert.equal(points.count(), 0);
});
