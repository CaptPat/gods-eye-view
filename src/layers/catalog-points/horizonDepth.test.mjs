import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  NEAR_DEPTH_TEST_DISTANCE_M,
  horizonDepthTestDistanceM,
  trackHorizonDepthTest,
} from './horizonDepth.js';

const R = Cesium.Ellipsoid.WGS84.maximumRadius;
const above = (height, lon = 0, lat = 0) =>
  Cesium.Cartesian3.fromDegrees(lon, lat, height);

test('the distance is the tangent to the horizon from high cameras and the near floor from low ones', () => {
  const height = 12_000_000;
  assert.ok(
    Math.abs(
      horizonDepthTestDistanceM(above(height)) -
        Math.sqrt((R + height) ** 2 - R ** 2),
    ) < 1,
  );
  assert.equal(
    horizonDepthTestDistanceM(above(100)),
    NEAR_DEPTH_TEST_DISTANCE_M,
  );
  assert.equal(
    horizonDepthTestDistanceM(above(-500)),
    NEAR_DEPTH_TEST_DISTANCE_M,
  );
});

test('points on the near side of the horizon fall inside the distance and points past it fall outside', () => {
  // From 1,000 km over the equator the horizon is ~30.2° of longitude away.
  const camera = above(1_000_000);
  const cutoff = horizonDepthTestDistanceM(camera);
  const to = (lon) => Cesium.Cartesian3.distance(camera, above(5, lon));
  assert.ok(to(29) < cutoff);
  assert.ok(to(31) > cutoff);
});

test('the tracker retunes on rendered frames only while active and only when the horizon moves', () => {
  const viewer = {
    scene: { preRender: new Cesium.Event() },
    camera: { positionWC: above(12_000_000) },
  };
  const render = () => viewer.scene.preRender.raiseEvent(viewer.scene);
  const applied = [];
  let active = false;
  const horizon = trackHorizonDepthTest(
    viewer,
    (distanceM) => applied.push(distanceM),
    { isActive: () => active },
  );
  assert.equal(horizon.distanceM(), NEAR_DEPTH_TEST_DISTANCE_M);
  render();
  assert.deepEqual(applied, [], 'a hidden layer is left alone');

  active = true;
  render();
  assert.deepEqual(applied, [
    horizonDepthTestDistanceM(viewer.camera.positionWC),
  ]);
  assert.equal(horizon.distanceM(), applied[0]);

  viewer.camera.positionWC = above(12_000_000, 120, 30);
  render();
  viewer.camera.positionWC = above(12_100_000);
  render();
  assert.equal(applied.length, 1, 'panning and small climbs rewrite nothing');

  viewer.camera.positionWC = above(1_000_000);
  render();
  assert.equal(applied.length, 2);

  horizon.destroy();
  viewer.camera.positionWC = above(20_000_000);
  render();
  assert.equal(applied.length, 2, 'a destroyed tracker stops listening');
  assert.equal(viewer.scene.preRender.numberOfListeners, 0);
});
