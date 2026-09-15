import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FUEL_COLORS,
  POWER_PLANTS_META,
  buildPowerPlantCard,
  parsePowerPlantSnapshot,
  powerPlantPixelSize,
} from './model.js';
import { POWER_PLANT_FIELDS } from './source.js';

const ATUCHA = {
  id: 'ARG0000029',
  name: 'ATUCHA I',
  fuel: 'Nuclear',
  capacityMw: 370,
  lat: -33.967,
  lon: -59.2059,
  country: 'Argentina',
  commissioned: 1974,
  owner: 'NASA',
};

test('the layer meta names a Power Plants layer from the WRI database', () => {
  assert.deepEqual(
    [
      POWER_PLANTS_META.id,
      POWER_PLANTS_META.name,
      POWER_PLANTS_META.icon,
      POWER_PLANTS_META.source,
    ],
    ['power-plants', 'Power Plants', '⚡', 'WRI GPPD'],
  );
});

test('each fuel has its own colour, and unknown fuels use the Other colour', () => {
  assert.equal(FUEL_COLORS.Coal, '#6c757d');
  assert.equal(FUEL_COLORS.Gas, '#ff9f1c');
  assert.equal(FUEL_COLORS.Nuclear, '#ffd60a');
  assert.equal(FUEL_COLORS.Wind, '#4cc9f0');
  assert.equal(FUEL_COLORS.Solar, '#ffe066');
  const [record] = parsePowerPlantSnapshot({
    fields: POWER_PLANT_FIELDS,
    rows: [['X', 'Test', 'Plasma', 5, 1, 1, 'Nowhere', null, null]],
  }).records;
  assert.equal(record.color, FUEL_COLORS.Other);
});

test('point size grows 1.5 pixels per tenfold capacity from 3 px at 1 MW, capped at 10', () => {
  assert.equal(powerPlantPixelSize(null), 3);
  assert.equal(powerPlantPixelSize(0.5), 3);
  assert.equal(powerPlantPixelSize(1), 3);
  assert.equal(powerPlantPixelSize(100), 6);
  assert.equal(powerPlantPixelSize(1000), 7.5);
  assert.equal(powerPlantPixelSize(1_000_000), 10);
});

test('a card gives fuel and capacity, owner, commissioning year and country, with no link', () => {
  assert.deepEqual(buildPowerPlantCard(ATUCHA), {
    title: 'ATUCHA I',
    details: ['Nuclear · 370 MW', 'NASA', 'Since 1974 · Argentina'],
    url: null,
    accessibilityLabel: 'ATUCHA I power plant',
  });
  assert.deepEqual(
    buildPowerPlantCard({
      ...ATUCHA,
      fuel: 'Wind',
      capacityMw: 16.56,
      owner: null,
      commissioned: null,
    }).details,
    ['Wind · 16.6 MW', 'Argentina'],
  );
  assert.equal(
    buildPowerPlantCard({ ...ATUCHA, fuel: 'Coal', capacityMw: 1200 })
      .details[0],
    'Coal · 1,200 MW',
  );
});

test('snapshot rows become styled records; rows with bad positions drop and mismatched fields are refused', () => {
  const parsed = parsePowerPlantSnapshot({
    fields: POWER_PLANT_FIELDS,
    rows: [
      [
        'ARG0000029',
        'ATUCHA I',
        'Nuclear',
        370,
        -33.967,
        -59.2059,
        'Argentina',
        1974,
        'NASA',
      ],
      ['BAD', 'Bad', 'Gas', 10, 95, 0, 'Nowhere', null, null],
    ],
  });
  assert.equal(parsed.stale, false);
  assert.deepEqual(parsed.records, [
    {
      ...ATUCHA,
      color: FUEL_COLORS.Nuclear,
      pixelSize: powerPlantPixelSize(370),
    },
  ]);
  assert.equal(parsePowerPlantSnapshot({ fields: ['id'], rows: [] }), null);
  assert.equal(
    parsePowerPlantSnapshot({ fields: POWER_PLANT_FIELDS, rows: 'x' }),
    null,
  );
});
