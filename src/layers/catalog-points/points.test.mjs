import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  DEFAULT_PIXEL_SIZE,
  DEPTH_TEST_DISTANCE_M,
  SELECTED_PIXEL_GROWTH,
  catalogPickId,
  createCatalogPoints,
} from './points.js';
import { horizonDepthTestDistanceM } from './horizonDepth.js';

const RECORDS = [
  { id: 'Q108803795', lat: -17.86352, lon: 31.29114 },
  {
    id: '20260911101803',
    lat: -0.2,
    lon: -129.6,
    pixelSize: 12,
    color: '#ffcc00',
  },
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

test('records become hidden, pickable points in one collection, sized and coloured per record', () => {
  const viewer = fakeViewer();
  const points = createCatalogPoints(viewer, {
    layerId: 'ufo-incidents',
    color: '#39ff14',
  });
  assert.equal(viewer.primitives.length, 1);
  const [collection] = viewer.primitives;
  assert.ok(collection instanceof Cesium.PointPrimitiveCollection);
  assert.equal(collection.show, false);
  assert.equal(points.setRecords(RECORDS), 2);
  const first = collection.get(0);
  assert.equal(first.id, 'ufo-incidents:Q108803795');
  assert.equal(first.pixelSize, DEFAULT_PIXEL_SIZE);
  assert.equal(first.color.toCssHexString(), '#39ff14');
  assert.equal(first.disableDepthTestDistance, DEPTH_TEST_DISTANCE_M);
  const second = collection.get(1);
  assert.equal(second.pixelSize, 12);
  assert.equal(second.color.toCssHexString(), '#ffcc00');
  const carto = Cesium.Cartographic.fromCartesian(
    points.positionOf('Q108803795'),
  );
  assert.ok(Math.abs(Cesium.Math.toDegrees(carto.latitude) + 17.86352) < 1e-6);
  assert.ok(Math.abs(Cesium.Math.toDegrees(carto.longitude) - 31.29114) < 1e-6);
  points.setShow(true);
  assert.equal(collection.show, true);
  assert.equal(
    catalogPickId('fireballs', '20260911101803'),
    'fireballs:20260911101803',
  );
});

test('records without real coordinates or with a bad size are skipped or defaulted', () => {
  const viewer = fakeViewer();
  const points = createCatalogPoints(viewer, {
    layerId: 'fireballs',
    color: '#ff8c00',
  });
  assert.equal(
    points.setRecords([
      { id: 'no-lat', lat: Number.NaN, lon: 0 },
      { id: 'too-far', lat: 91, lon: 0 },
      {
        id: 'no-id',
        lat: 1,
        lon: 1,
        idless: true,
        get id() {
          return '';
        },
      },
      { id: 'ok', lat: 1, lon: 1, pixelSize: Number.POSITIVE_INFINITY },
    ]),
    1,
  );
  assert.equal(viewer.primitives[0].get(0).pixelSize, DEFAULT_PIXEL_SIZE);
});

test('shown points draw through the 3D mesh out to the horizon, and new points start there', () => {
  const viewer = fakeViewer();
  const points = createCatalogPoints(viewer, {
    layerId: 'airports',
    color: '#ffffff',
  });
  points.setRecords(RECORDS);
  const collection = viewer.primitives[0];
  points.setShow(true);
  viewer.scene.preRender.raiseEvent(viewer.scene);
  const horizon = horizonDepthTestDistanceM(viewer.camera.positionWC);
  assert.ok(horizon > 10_000_000);
  assert.equal(collection.get(0).disableDepthTestDistance, horizon);
  assert.equal(collection.get(1).disableDepthTestDistance, horizon);
  points.setRecords(RECORDS.slice(1));
  assert.equal(collection.get(0).disableDepthTestDistance, horizon);
  points.destroy();
  assert.equal(viewer.scene.preRender.numberOfListeners, 0);
});

test("picks resolve only this layer's records, from either pick path", () => {
  const points = createCatalogPoints(fakeViewer(), {
    layerId: 'ufo-incidents',
    color: '#39ff14',
  });
  points.setRecords(RECORDS);
  assert.equal(
    points.recordIdFromPick({ primitive: { id: 'ufo-incidents:Q108803795' } }),
    'Q108803795',
  );
  assert.equal(
    points.recordIdFromPick({ id: 'ufo-incidents:20260911101803' }),
    '20260911101803',
  );
  assert.equal(
    points.recordIdFromPick({ primitive: { id: 'fireballs:Q108803795' } }),
    null,
  );
  assert.equal(
    points.recordIdFromPick({ primitive: { id: 'ufo-incidents:Q0' } }),
    null,
  );
  assert.equal(points.recordIdFromPick(undefined), null);
});

test('selection grows a point from its own size, survives a refresh, and clears when its record disappears', () => {
  const viewer = fakeViewer();
  const points = createCatalogPoints(viewer, {
    layerId: 'ufo-incidents',
    color: '#39ff14',
  });
  points.setRecords(RECORDS);
  const collection = viewer.primitives[0];
  points.setSelected('20260911101803');
  assert.equal(collection.get(1).pixelSize, 12 + SELECTED_PIXEL_GROWTH);
  assert.ok(collection.get(1).outlineColor.equals(Cesium.Color.WHITE));
  points.setSelected('Q108803795');
  assert.equal(collection.get(1).pixelSize, 12);
  assert.equal(
    collection.get(0).pixelSize,
    DEFAULT_PIXEL_SIZE + SELECTED_PIXEL_GROWTH,
  );
  points.setRecords(RECORDS);
  assert.equal(points.selectedId(), 'Q108803795');
  assert.equal(
    viewer.primitives[0].get(0).pixelSize,
    DEFAULT_PIXEL_SIZE + SELECTED_PIXEL_GROWTH,
  );
  points.setRecords(RECORDS.slice(1));
  assert.equal(points.selectedId(), null);
  points.setSelected('nope');
  assert.equal(points.selectedId(), null);
  points.destroy();
  assert.equal(viewer.primitives.length, 0);
  assert.equal(points.count(), 0);
});
