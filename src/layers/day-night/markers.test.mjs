import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createBodyMarkers, moonLabel } from './markers.js';

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

const latOf = (position) =>
  Cesium.Math.toDegrees(Cesium.Cartographic.fromCartesian(position).latitude);

test('the moon label gives its lit fraction and whether it waxes or wanes', () => {
  assert.equal(
    moonLabel({ illumination: 0.784, waxing: true }),
    '☾ Moon overhead · 78% lit, waxing',
  );
  assert.equal(
    moonLabel({ illumination: 0.004, waxing: false }),
    '☾ Moon overhead · 0% lit, waning',
  );
});

test('sun and moon markers are hidden points with labels that follow their subpoints', () => {
  // Cesium labels rasterise glyphs through `document`, which Node lacks, so
  // the label collection is a stand-in with LabelCollection's add/get shape.
  const fakeLabels = () => {
    const list = [];
    return {
      show: true,
      get length() {
        return list.length;
      },
      add(options) {
        const label = { ...options };
        list.push(label);
        return label;
      },
      get: (index) => list[index],
    };
  };
  const defaults = fakeViewer();
  createBodyMarkers(defaults);
  assert.ok(defaults.primitives[1] instanceof Cesium.LabelCollection);

  const viewer = fakeViewer();
  const markers = createBodyMarkers(viewer, { createLabels: fakeLabels });
  assert.equal(viewer.primitives.length, 2);
  const [points, labels] = viewer.primitives;
  assert.ok(points instanceof Cesium.PointPrimitiveCollection);
  assert.equal(points.show, false);
  assert.equal(labels.show, false);

  markers.set({
    sun: { lat: 3, lon: 10 },
    moon: { lat: -20, lon: 140 },
    illumination: 0.5,
    waxing: false,
  });
  assert.equal(points.length, 2);
  assert.equal(points.get(0).id, 'day-night:sun');
  assert.equal(points.get(1).id, 'day-night:moon');
  assert.ok(Math.abs(latOf(points.get(0).position) - 3) < 1e-6);
  assert.equal(labels.get(0).text, '☀ Sun overhead');
  assert.equal(labels.get(1).text, '☾ Moon overhead · 50% lit, waning');

  markers.set({
    sun: { lat: 4, lon: 9 },
    moon: { lat: -19, lon: 139 },
    illumination: 0.51,
    waxing: false,
  });
  assert.equal(points.length, 2, 'markers move rather than multiply');
  assert.ok(Math.abs(latOf(labels.get(1).position) + 19) < 1e-6);

  markers.setShow(true);
  assert.equal(points.show, true);
  assert.equal(labels.show, true);
  markers.destroy();
  assert.equal(viewer.primitives.length, 0);
});
