import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRANSMISSION_META,
  TRANSMISSION_QUERY,
  buildTransmissionCard,
  classifyTransmissionLine,
  classifyTransmissionPoint,
  voltageKv,
} from './model.js';

test('the layer meta and query describe OpenStreetMap power lines, substations and plants', () => {
  assert.deepEqual(
    [
      TRANSMISSION_META.id,
      TRANSMISSION_META.name,
      TRANSMISSION_META.icon,
      TRANSMISSION_META.source,
    ],
    ['transmission-lines', 'Transmission Lines', '🗼', 'OpenStreetMap'],
  );
  assert.equal(TRANSMISSION_META.zoomMessage, 'Zoom in to load power lines');
  assert.deepEqual(TRANSMISSION_QUERY, {
    selectors: [
      'way["power"~"^(line|minor_line|cable)$"]',
      'nwr["power"~"^(substation|plant)$"]',
    ],
    cap: 2500,
    maxViewDegrees: 1.5,
  });
});

test('voltage tags in volts read as the highest kilovolt value', () => {
  assert.equal(voltageKv('220000;110000'), 220);
  assert.equal(voltageKv('400000'), 400);
  assert.equal(voltageKv('13800'), 13.8);
  assert.equal(voltageKv('medium'), null);
  assert.equal(voltageKv(''), null);
  assert.equal(voltageKv(undefined), null);
});

test('lines colour and thicken with voltage; other power ways are not lines', () => {
  const style = (voltage, power = 'line') =>
    classifyTransmissionLine({ power, voltage });
  assert.deepEqual(style('765000'), {
    kind: 'line',
    voltageKv: 765,
    color: '#ff006e',
    width: 4,
  });
  assert.deepEqual(style('345000'), {
    kind: 'line',
    voltageKv: 345,
    color: '#fb5607',
    width: 3,
  });
  assert.deepEqual(style('138000'), {
    kind: 'line',
    voltageKv: 138,
    color: '#ffbe0b',
    width: 2.5,
  });
  assert.deepEqual(style('69000', 'minor_line'), {
    kind: 'minor_line',
    voltageKv: 69,
    color: '#8ecae6',
    width: 2,
  });
  assert.deepEqual(style(undefined, 'cable'), {
    kind: 'cable',
    voltageKv: null,
    color: '#adb5bd',
    width: 1.5,
  });
  assert.equal(classifyTransmissionLine({ power: 'tower' }), null);
});

test('substations and plants are points; other power nodes are not', () => {
  assert.deepEqual(
    classifyTransmissionPoint({ power: 'substation', voltage: '138000' }),
    {
      kind: 'substation',
      voltageKv: 138,
      color: '#e0e1dd',
      pixelSize: 6,
    },
  );
  assert.deepEqual(classifyTransmissionPoint({ power: 'plant' }), {
    kind: 'plant',
    voltageKv: null,
    color: '#ffd166',
    pixelSize: 8,
  });
  assert.equal(classifyTransmissionPoint({ power: 'pole' }), null);
});

test('cards describe voltage, circuits, kind and operator, linking to the OpenStreetMap feature', () => {
  assert.deepEqual(
    buildTransmissionCard({
      id: 'way/1',
      kind: 'line',
      voltageKv: 220,
      tags: {
        power: 'line',
        voltage: '220000',
        circuits: '2',
        operator: 'Oncor',
      },
    }),
    {
      title: '220 kV power line',
      details: ['220 kV · 2 circuits · Transmission line', 'Oncor'],
      url: 'https://www.openstreetmap.org/way/1',
      accessibilityLabel: 'Open 220 kV power line on OpenStreetMap',
    },
  );
  assert.deepEqual(
    buildTransmissionCard({
      id: 'way/2',
      kind: 'minor_line',
      voltageKv: null,
      tags: { power: 'minor_line' },
    }).details,
    ['Voltage unknown · Minor line'],
  );
  assert.deepEqual(
    buildTransmissionCard({
      id: 'node/3',
      kind: 'substation',
      voltageKv: 138,
      tags: { power: 'substation', name: 'North' },
    }),
    {
      title: 'North',
      details: ['138 kV · Substation'],
      url: 'https://www.openstreetmap.org/node/3',
      accessibilityLabel: 'Open North on OpenStreetMap',
    },
  );
  assert.deepEqual(
    buildTransmissionCard({
      id: 'way/4',
      kind: 'plant',
      voltageKv: null,
      tags: {
        power: 'plant',
        name: 'Sand Hill',
        'plant:source': 'gas',
        'plant:output:electricity': '595 MW',
        operator: 'Austin Energy',
      },
    }).details,
    ['Gas power plant · 595 MW', 'Austin Energy'],
  );
});
