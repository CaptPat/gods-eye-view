import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  SKY_RADIUS_M,
  SKY_RENDER_INTERVAL_MS,
  createSkySphere,
  skyPosition,
  skyScale,
} from './sphere.js';

const T0 = Date.UTC(2026, 8, 15, 12, 0);

function fakeViewer(cameraPosition) {
  const primitives = [];
  return {
    primitives,
    camera: { positionWC: cameraPosition },
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

// Cesium labels rasterise glyphs through `document`, which Node lacks.
function fakeLabels() {
  const list = [];
  return {
    show: true,
    modelMatrix: Cesium.Matrix4.clone(Cesium.Matrix4.IDENTITY),
    get length() {
      return list.length;
    },
    add(options) {
      const label = { ...options };
      list.push(label);
      return label;
    },
    get: (index) => list[index],
    removeAll() {
      list.length = 0;
    },
  };
}

function fakeTimers() {
  const intervals = new Map();
  let next = 1;
  return {
    intervals,
    setInterval(fn, ms) {
      const handle = next++;
      intervals.set(handle, { fn, ms });
      return handle;
    },
    clearInterval(handle) {
      intervals.delete(handle);
    },
  };
}

function harness() {
  const camera = new Cesium.Cartesian3(7e6, 0, 0);
  const viewer = fakeViewer(camera);
  const renders = [];
  const rotations = [];
  const timers = fakeTimers();
  const quarterTurn = Cesium.Matrix3.fromRotationZ(Cesium.Math.PI_OVER_TWO);
  const sphere = createSkySphere(viewer, {
    id: 'night-sky',
    createLabels: fakeLabels,
    computeRotation: (time) => {
      rotations.push(Cesium.JulianDate.toDate(time).getTime());
      return quarterTurn;
    },
    preload: () => Promise.resolve(),
    requestRender: (reason) => renders.push(reason),
    now: () => T0,
    timers,
  });
  return { camera, viewer, renders, rotations, timers, sphere };
}

const transformed = (collection, point) =>
  Cesium.Matrix4.multiplyByPoint(
    collection.modelMatrix,
    point,
    new Cesium.Cartesian3(),
  );

test('a direction lands on the sky sphere, well inside the camera far plane', () => {
  const position = skyPosition({ x: 0, y: 1, z: 0 });
  assert.equal(position.y, SKY_RADIUS_M);
  assert.equal(position.x, 0);
  assert.ok(SKY_RADIUS_M < new Cesium.PerspectiveFrustum().far);
  assert.ok(SKY_RADIUS_M > 42_164_000, 'beyond geostationary orbit');
});

test('far from Earth the sphere grows, so the planet always stays in front of the sky', () => {
  assert.equal(skyScale(0), 1);
  assert.equal(skyScale(9.3e7), 1);
  assert.equal(skyScale(3e8), 3.07);
  const viewer = fakeViewer(new Cesium.Cartesian3(3e8, 0, 0));
  const sphere = createSkySphere(viewer, {
    id: 'night-sky',
    createLabels: fakeLabels,
    computeRotation: () => Cesium.Matrix3.IDENTITY,
    preload: () => Promise.resolve(),
    now: () => T0,
    timers: fakeTimers(),
  });
  sphere.updateFrame();
  const behindEarth = transformed(
    sphere.points,
    new Cesium.Cartesian3(-SKY_RADIUS_M, 0, 0),
  );
  assert.ok(Math.abs(behindEarth.x + 7e6) < 1, `${behindEarth.x}`);
  assert.ok(
    behindEarth.x < -6_378_137,
    'the sky directly behind the Earth lies beyond its far side',
  );
});

test('the sphere holds hidden points, lines and labels centred on the camera and turned with the sky', () => {
  const h = harness();
  assert.equal(h.viewer.primitives.length, 3);
  const { points, lines, labels } = h.sphere;
  assert.ok(points instanceof Cesium.PointPrimitiveCollection);
  assert.ok(lines instanceof Cesium.PolylineCollection);
  assert.equal(points.show, false);
  assert.equal(lines.show, false);
  assert.equal(labels.show, false);

  h.sphere.updateFrame();
  assert.deepEqual(h.rotations, [T0]);
  const moved = transformed(points, new Cesium.Cartesian3(SKY_RADIUS_M, 0, 0));
  assert.ok(
    Cesium.Cartesian3.equalsEpsilon(
      moved,
      new Cesium.Cartesian3(7e6, SKY_RADIUS_M, 0),
      0,
      1e-3,
    ),
    `quarter turn about the pole, offset by the camera: ${moved}`,
  );
  assert.ok(Cesium.Matrix4.equals(lines.modelMatrix, points.modelMatrix));
  assert.ok(Cesium.Matrix4.equals(labels.modelMatrix, points.modelMatrix));
});

test('attached, the sphere follows every frame and requests a render each minute; detached, neither', () => {
  const h = harness();
  h.sphere.attach();
  assert.equal(h.viewer.scene.preRender.numberOfListeners, 1);
  h.camera.x = 9e6;
  h.viewer.scene.preRender.raiseEvent();
  const origin = transformed(h.sphere.points, Cesium.Cartesian3.ZERO);
  assert.equal(origin.x, 9e6);
  const [interval] = [...h.timers.intervals.values()];
  assert.equal(interval.ms, SKY_RENDER_INTERVAL_MS);
  interval.fn();
  assert.deepEqual(h.renders, ['night-sky']);
  h.sphere.attach();
  assert.equal(
    h.viewer.scene.preRender.numberOfListeners,
    1,
    'attach is idempotent',
  );
  h.sphere.detach();
  assert.equal(h.viewer.scene.preRender.numberOfListeners, 0);
  assert.equal(h.timers.intervals.size, 0);
});

test('show toggles all three collections; destroy detaches and removes them', () => {
  const h = harness();
  h.sphere.show(true);
  assert.equal(h.sphere.points.show, true);
  assert.equal(h.sphere.lines.show, true);
  assert.equal(h.sphere.labels.show, true);
  assert.deepEqual(h.renders, ['night-sky']);
  h.sphere.attach();
  h.sphere.destroy();
  assert.equal(h.viewer.primitives.length, 0);
  assert.equal(h.viewer.scene.preRender.numberOfListeners, 0);
  assert.equal(h.timers.intervals.size, 0);
});
