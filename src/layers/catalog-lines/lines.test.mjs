import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { DEFAULT_LINE_WIDTH, createCatalogLines } from './lines.js';

const GAS = {
  id: 'gas/1',
  positions: [-97, 30, -96.5, 30.5, -96, 31],
  color: '#ffb703',
  width: 3,
};
const CRUDE = { id: 'crude/2', positions: [-100, 40, -99, 41] };

function setup() {
  const added = [];
  const viewer = {
    scene: {
      groundPrimitives: {
        add: (primitive) => {
          added.push(primitive);
          return primitive;
        },
        remove: (primitive) => {
          added.splice(added.indexOf(primitive), 1);
          return true;
        },
      },
    },
  };
  const created = [];
  const lines = createCatalogLines(viewer, {
    layerId: 'us-pipelines',
    color: '#8338ec',
    createPrimitive: (options) => {
      const attributes = new Map();
      const primitive = {
        options,
        show: true,
        ready: true,
        attributes,
        getGeometryInstanceAttributes(id) {
          if (!attributes.has(id)) attributes.set(id, {});
          return attributes.get(id);
        },
      };
      created.push(primitive);
      return primitive;
    },
  });
  return { viewer, added, created, lines };
}

const colorValue = (css) =>
  Array.from(
    Cesium.ColorGeometryInstanceAttribute.toValue(
      Cesium.Color.fromCssColorString(css),
    ),
  );

test('records become one hidden ground primitive of coloured, pickable line instances', () => {
  const { added, created, lines } = setup();
  assert.equal(
    lines.setRecords([GAS, { id: 'bad', positions: [1] }, CRUDE, GAS]),
    2,
  );
  assert.equal(created.length, 1);
  const [primitive] = created;
  assert.deepEqual(added, [primitive]);
  assert.equal(primitive.show, false, 'hidden until the layer shows it');
  assert.equal(primitive.options.asynchronous, true);
  assert.equal(
    primitive.options.classificationType,
    Cesium.ClassificationType.BOTH,
  );
  assert.ok(
    primitive.options.appearance instanceof Cesium.PolylineColorAppearance,
  );

  const [gas, crude] = primitive.options.geometryInstances;
  assert.equal(gas.id, 'us-pipelines:gas/1');
  assert.ok(gas.geometry instanceof Cesium.GroundPolylineGeometry);
  assert.equal(gas.geometry.width, 3);
  assert.deepEqual(
    Array.from(gas.attributes.color.value),
    colorValue('#ffb703'),
  );
  assert.equal(crude.id, 'us-pipelines:crude/2');
  assert.equal(crude.geometry.width, DEFAULT_LINE_WIDTH);
  assert.deepEqual(
    Array.from(crude.attributes.color.value),
    colorValue('#8338ec'),
    'records without a colour use the layer colour',
  );

  lines.setShow(true);
  assert.equal(primitive.show, true);
  assert.equal(lines.setRecords([CRUDE]), 1);
  assert.deepEqual(
    added,
    [created[1]],
    'a new record set replaces the primitive',
  );
  assert.equal(created[1].show, true, 'and keeps the shown state');
  assert.equal(lines.setRecords([]), 0);
  assert.deepEqual(added, []);
  assert.equal(lines.count(), 0);
});

test('picks resolve to record ids and anchors sit at the middle of each line', () => {
  const { lines } = setup();
  lines.setRecords([GAS, CRUDE]);
  assert.equal(lines.recordIdFromPick({ id: 'us-pipelines:gas/1' }), 'gas/1');
  assert.equal(lines.recordIdFromPick({ id: 'us-pipelines:none' }), null);
  assert.equal(lines.recordIdFromPick({ id: 'power-plants:gas/1' }), null);
  assert.equal(lines.recordIdFromPick(undefined), null);
  assert.ok(
    lines
      .positionOf('gas/1')
      .equals(Cesium.Cartesian3.fromDegrees(-96.5, 30.5)),
  );
  assert.ok(
    lines
      .positionOf('crude/2')
      .equals(Cesium.Cartesian3.fromDegrees(-99.5, 40.5)),
    'a two-vertex line anchors between its ends',
  );
  assert.equal(lines.positionOf('none'), null);
});

test('selection recolours one line white and restores the previous one', () => {
  const { created, lines } = setup();
  lines.setRecords([GAS, CRUDE]);
  const { attributes } = created[0];
  lines.setSelected('gas/1');
  assert.equal(lines.selectedId(), 'gas/1');
  assert.deepEqual(
    Array.from(attributes.get('us-pipelines:gas/1').color),
    colorValue('#ffffff'),
  );
  lines.setSelected('crude/2');
  assert.deepEqual(
    Array.from(attributes.get('us-pipelines:gas/1').color),
    colorValue('#ffb703'),
  );
  lines.setSelected(null);
  assert.deepEqual(
    Array.from(attributes.get('us-pipelines:crude/2').color),
    colorValue('#8338ec'),
  );
  lines.setSelected('none');
  assert.equal(lines.selectedId(), null);
});

test('destroying removes the primitive', () => {
  const { added, lines } = setup();
  lines.setRecords([GAS]);
  lines.destroy();
  assert.deepEqual(added, []);
  assert.equal(lines.count(), 0);
});
