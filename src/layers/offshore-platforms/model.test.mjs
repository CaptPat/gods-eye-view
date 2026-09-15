import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OFFSHORE_PLATFORMS_META,
  PLATFORM_FIELDS,
  buildOffshorePlatformCard,
  parseOffshorePlatformSnapshot,
  structureStyle,
  toPlatformRows,
} from './model.js';

const HOOVER = {
  id: '183-1',
  name: 'A (Hoover)',
  lat: 26.93905,
  lon: -94.68872,
  area: 'AC',
  block: '25',
  type: 'SPAR',
  installed: '2000-01-01',
  waterDepthFt: 4825,
  distanceToShoreNm: 160,
  operator: 'ExxonMobil Corporation',
  products: ['oil', 'gas'],
  manned: true,
  heliport: true,
};
const PROTECTOR = {
  id: '600-1',
  name: 'C',
  lat: 28.7,
  lon: -91.2,
  area: 'SS',
  block: '7',
  type: 'WP',
  installed: null,
  waterDepthFt: null,
  distanceToShoreNm: null,
  operator: null,
  products: [],
  manned: false,
  heliport: false,
};

test('the layer describes BSEE offshore structures', () => {
  assert.deepEqual(
    [
      OFFSHORE_PLATFORMS_META.id,
      OFFSHORE_PLATFORMS_META.name,
      OFFSHORE_PLATFORMS_META.source,
      OFFSHORE_PLATFORMS_META.selectedSourceId,
    ],
    [
      'offshore-platforms',
      'Offshore Platforms',
      'BSEE',
      'offshore-platforms-selected',
    ],
  );
  assert.deepEqual(PLATFORM_FIELDS, [
    'id',
    'name',
    'lat',
    'lon',
    'area',
    'block',
    'type',
    'installed',
    'waterDepthFt',
    'distanceToShoreNm',
    'operator',
    'products',
    'manned',
    'heliport',
  ]);
});

test('floating production systems stand out; fixed platforms, caissons and subsea structures step down', () => {
  assert.deepEqual(structureStyle('SPAR'), {
    label: 'SPAR platform',
    color: '#ff006e',
    pixelSize: 8,
  });
  assert.deepEqual(structureStyle('TLP'), {
    label: 'Tension leg platform',
    color: '#ff006e',
    pixelSize: 8,
  });
  assert.deepEqual(structureStyle('FIXED'), {
    label: 'Fixed leg platform',
    color: '#00b4d8',
    pixelSize: 6,
  });
  assert.deepEqual(structureStyle('CAIS'), {
    label: 'Caisson',
    color: '#8ecae6',
    pixelSize: 4,
  });
  assert.deepEqual(structureStyle('WP'), {
    label: 'Well protector',
    color: '#90be6d',
    pixelSize: 4,
  });
  assert.deepEqual(structureStyle('SSMNF'), {
    label: 'Subsea manifold',
    color: '#adb5bd',
    pixelSize: 3,
  });
  assert.deepEqual(structureStyle('XYZ'), {
    label: 'Structure XYZ',
    color: '#adb5bd',
    pixelSize: 3,
  });
  assert.deepEqual(structureStyle(null), {
    label: 'Offshore structure',
    color: '#adb5bd',
    pixelSize: 3,
  });
});

test('cards name the structure by area, block and name, with type, depth, operator, products and age', () => {
  assert.deepEqual(buildOffshorePlatformCard(HOOVER), {
    title: 'AC 25 A (Hoover)',
    details: [
      'SPAR platform · 4,825 ft water',
      'ExxonMobil Corporation',
      'Oil, gas · Manned · 160 nm offshore',
      'Installed 2000',
    ],
    url: null,
    accessibilityLabel: 'AC 25 A (Hoover) offshore platform',
  });
  assert.deepEqual(buildOffshorePlatformCard(PROTECTOR).details, [
    'Well protector',
  ]);
});

test('snapshots round-trip through compact rows and pick up styles; a wrong shape is rejected', () => {
  const rows = toPlatformRows([HOOVER, PROTECTOR]);
  assert.deepEqual(
    rows[0],
    PLATFORM_FIELDS.map((field) => HOOVER[field]),
  );
  const parsed = parseOffshorePlatformSnapshot({
    fields: PLATFORM_FIELDS,
    rows: [...rows, 'garbage', [null, 'no id', 1, 2]],
  });
  assert.equal(parsed.stale, false);
  assert.equal(parsed.records.length, 2);
  assert.deepEqual(parsed.records[0], {
    ...HOOVER,
    color: '#ff006e',
    pixelSize: 8,
  });
  assert.equal(parsed.records[1].color, '#90be6d');
  assert.equal(parseOffshorePlatformSnapshot({ fields: ['id'], rows }), null);
  assert.equal(parseOffshorePlatformSnapshot(null), null);
});
