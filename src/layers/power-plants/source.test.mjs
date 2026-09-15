import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { POWER_PLANT_FIELDS, normalizeGppdCsv } from './source.js';

const SAMPLE = readFileSync(
  new URL('../../data/fixtures/power-plants/gppd-sample.csv', import.meta.url),
  'utf8',
);

test('GPPD rows become compact non-hydro rows with typed capacity, position and year', () => {
  assert.deepEqual(POWER_PLANT_FIELDS, [
    'id',
    'name',
    'fuel',
    'capacityMw',
    'lat',
    'lon',
    'country',
    'commissioned',
    'owner',
  ]);
  assert.deepEqual(normalizeGppdCsv(SAMPLE), [
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
    [
      'WKS0070144',
      'Kandahar DOG',
      'Solar',
      10,
      31.67,
      65.795,
      'Afghanistan',
      null,
      null,
    ],
    [
      'IND0000010',
      'ANAPARA "C"',
      'Coal',
      1200,
      24.2007,
      82.8,
      'India',
      2011,
      null,
    ],
    [
      'ARG0000067',
      'COMODORO RIVADAVIA - ANTONIO MORAN',
      'Wind',
      16.56,
      -45.8467,
      -67.4964,
      'Argentina',
      null,
      'COOPERATIVA',
    ],
  ]);
});

test('rows without a usable position, capacity or fuel are dropped', () => {
  const header = SAMPLE.split('\n')[0];
  const columns = header.split(',');
  const row = (overrides) =>
    columns
      .map((name) => {
        const base = {
          gppd_idnr: 'X1',
          name: 'Test',
          primary_fuel: 'Gas',
          capacity_mw: '50',
          latitude: '10',
          longitude: '20',
          country_long: 'Nowhere',
        };
        return { ...base, ...overrides }[name] ?? '';
      })
      .join(',');
  const csv = [
    header,
    row({ latitude: '95' }),
    row({ capacity_mw: 'n/a' }),
    row({ primary_fuel: '' }),
    row({ gppd_idnr: 'KEEP' }),
  ].join('\n');
  assert.deepEqual(
    normalizeGppdCsv(csv).map((cells) => cells[0]),
    ['KEEP'],
  );
});
