import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { pickGround } from './groundPick.js';

const AUSTIN = Cesium.Cartesian3.fromDegrees(-97.743, 30.267);
const near = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} ≈ ${expected}`);
function viewer({
  supported = true,
  pickPosition,
  pickEllipsoid,
  globePick,
} = {}) {
  return {
    scene: {
      pickPositionSupported: supported,
      pickPosition,
      globe: { pick: globePick },
    },
    camera: { pickEllipsoid, getPickRay: () => ({ ray: true }) },
  };
}

test('the depth pick wins when it lands on a real surface', () => {
  const point = pickGround(viewer({ pickPosition: () => AUSTIN }), {
    x: 10,
    y: 20,
  });
  near(point.lat, 30.267);
  near(point.lon, -97.743);
});

test('degenerate or throwing picks fall through to the ellipsoid, then the globe', () => {
  const ellipsoid = pickGround(
    viewer({
      pickPosition: () => new Cesium.Cartesian3(0, 0, 0),
      pickEllipsoid: () => AUSTIN,
    }),
    { x: 1, y: 1 },
  );
  near(ellipsoid.lat, 30.267);
  const globe = pickGround(
    viewer({
      supported: false,
      pickEllipsoid: () => {
        throw new Error('no');
      },
      globePick: () => AUSTIN,
    }),
    { x: 1, y: 1 },
  );
  near(globe.lon, -97.743);
});

test('sky and invalid positions pick nothing', () => {
  assert.equal(
    pickGround(
      viewer({
        pickPosition: () => undefined,
        pickEllipsoid: () => undefined,
        globePick: () => undefined,
      }),
      { x: 1, y: 1 },
    ),
    null,
  );
  assert.equal(
    pickGround(viewer({ pickPosition: () => AUSTIN }), { x: Number.NaN, y: 1 }),
    null,
  );
  assert.equal(pickGround(null, { x: 1, y: 1 }), null);
});
