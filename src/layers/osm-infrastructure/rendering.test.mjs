import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createOsmInfrastructureRendering } from './rendering.js';

const T = Cesium.JulianDate.now();

const LINE = {
  id: 'way/1',
  positions: [
    [-97, 30],
    [-97.1, 30.1],
    [-97.2, 30.2],
  ],
  tags: { power: 'line' },
  kind: 'line',
  color: '#ffbe0b',
  width: 2.5,
};
const POINT = {
  id: 'node/2',
  lat: 30.05,
  lon: -97.05,
  tags: { power: 'substation' },
  kind: 'substation',
  color: '#e0e1dd',
  pixelSize: 6,
};

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
        sources.splice(sources.indexOf(source), 1);
        return true;
      },
    },
  };
}

function setup() {
  const viewer = fakeViewer();
  const renders = [];
  const timers = { setTimeout: () => 0, clearTimeout: () => {} };
  const rendering = createOsmInfrastructureRendering(viewer, {
    layerId: 'transmission-lines',
    requestRender: (reason) => renders.push(reason),
    timers,
  });
  return { viewer, renders, rendering };
}

test('features become ground-clamped polylines and depth-test-free points with layer-prefixed ids', () => {
  const { viewer, renders, rendering } = setup();
  assert.equal(viewer.sources.length, 1);
  assert.equal(rendering.render({ lines: [LINE], points: [POINT] }), true);
  const entities = viewer.sources[0].entities;
  assert.equal(entities.values.length, 2);

  const line = entities.getById('transmission-lines:way/1');
  assert.equal(line.polyline.width.getValue(T), 2.5);
  assert.equal(line.polyline.clampToGround.getValue(T), true);
  assert.equal(line.polyline.positions.getValue(T).length, 3);
  assert.ok(
    line.polyline.material.color
      .getValue(T)
      .equals(Cesium.Color.fromCssColorString('#ffbe0b')),
  );

  const point = entities.getById('transmission-lines:node/2');
  assert.equal(point.point.pixelSize.getValue(T), 6);
  assert.equal(point.point.heightReference, undefined);
  assert.equal(
    point.point.disableDepthTestDistance.getValue(T),
    Number.POSITIVE_INFINITY,
  );
  assert.ok(renders.length > 0);

  assert.equal(
    rendering.render({ lines: [LINE], points: [POINT] }),
    false,
    'an unchanged feature set is not rebuilt',
  );
  assert.equal(rendering.render({ lines: [], points: [POINT] }), true);
  assert.equal(entities.values.length, 1);
});

test('picks resolve to feature ids only for this layer, and anchors sit on the feature', () => {
  const { viewer, rendering } = setup();
  rendering.render({ lines: [LINE], points: [POINT] });
  const entity = viewer.sources[0].entities.getById(
    'transmission-lines:node/2',
  );
  assert.equal(rendering.featureIdFromPick({ id: entity }), 'node/2');
  assert.equal(
    rendering.featureIdFromPick({ id: 'transmission-lines:way/1' }),
    'way/1',
  );
  assert.equal(rendering.featureIdFromPick({ id: 'oil-gas:way/1' }), null);
  assert.equal(
    rendering.featureIdFromPick({ id: 'transmission-lines:way/9' }),
    null,
  );
  assert.equal(rendering.featureIdFromPick(undefined), null);

  assert.equal(rendering.featureOf('way/1'), LINE);
  assert.ok(
    rendering
      .positionOf('node/2')
      .equals(Cesium.Cartesian3.fromDegrees(-97.05, 30.05)),
  );
  assert.ok(
    rendering
      .positionOf('way/1')
      .equals(Cesium.Cartesian3.fromDegrees(-97.1, 30.1)),
    'a line anchors at its middle vertex',
  );
  assert.equal(rendering.positionOf('way/9'), null);
});

test('selection highlights one feature and restores the previous one', () => {
  const { viewer, rendering } = setup();
  rendering.render({ lines: [LINE], points: [POINT] });
  const entities = viewer.sources[0].entities;
  const line = entities.getById('transmission-lines:way/1');
  const point = entities.getById('transmission-lines:node/2');

  rendering.setSelected('way/1');
  assert.equal(line.polyline.width.getValue(T), 4.5);
  assert.ok(
    line.polyline.material.color.getValue(T).equals(Cesium.Color.WHITE),
  );

  rendering.setSelected('node/2');
  assert.equal(line.polyline.width.getValue(T), 2.5);
  assert.equal(point.point.pixelSize.getValue(T), 10);
  assert.ok(point.point.outlineColor.getValue(T).equals(Cesium.Color.WHITE));

  rendering.setSelected(null);
  assert.equal(point.point.pixelSize.getValue(T), 6);
});

test('visibility, clearing and destruction release the data source', () => {
  const { viewer, rendering } = setup();
  rendering.render({ lines: [LINE], points: [POINT] });
  rendering.setVisible(false);
  assert.equal(viewer.sources[0].show, false);
  rendering.clear();
  assert.equal(viewer.sources[0].entities.values.length, 0);
  assert.equal(rendering.featureOf('way/1'), null);
  assert.equal(
    rendering.render({ lines: [LINE], points: [] }),
    true,
    'a cleared layer redraws the same set',
  );
  rendering.destroy();
  assert.equal(viewer.sources.length, 0);
});
