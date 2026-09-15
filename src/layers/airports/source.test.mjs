import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AIRPORT_FIELDS, normalizeOurAirportsCsv } from './source.js';

const SAMPLE = readFileSync(
  new URL(
    '../../data/fixtures/airports/ourairports-sample.csv',
    import.meta.url,
  ),
  'utf8',
);

test('OurAirports rows become compact large and medium airport rows with their codes', () => {
  assert.deepEqual(AIRPORT_FIELDS, [
    'id',
    'size',
    'name',
    'icao',
    'iata',
    'lat',
    'lon',
    'elevationFt',
    'city',
    'country',
    'scheduled',
    'wikipedia',
  ]);
  assert.deepEqual(normalizeOurAirportsCsv(SAMPLE), [
    [
      'KJFK',
      'large',
      'John F. Kennedy International Airport',
      'KJFK',
      'JFK',
      40.6394,
      -73.7793,
      13,
      'New York',
      'US',
      true,
      'https://en.wikipedia.org/wiki/John_F._Kennedy_International_Airport',
    ],
    [
      'AE-0221',
      'medium',
      'Sas Al Nakheel Air Base',
      'OMNK',
      null,
      24.4413,
      54.517,
      14,
      'Sas Al Nakheel',
      'AE',
      false,
      null,
    ],
    [
      'LGIR',
      'large',
      'Heraklion International Nikos Kazantzakis Airport',
      'LGIR',
      'HER',
      35.3397,
      25.1803,
      115,
      'Heraklion',
      'GR',
      true,
      'https://en.wikipedia.org/wiki/Heraklion_International_Airport_"Nikos_Kazantzakis"',
    ],
    [
      'AGGM',
      'medium',
      'Munda Airport',
      'AGGM',
      'MUA',
      -8.328,
      157.263,
      10,
      'Munda',
      'SB',
      true,
      'https://en.wikipedia.org/wiki/Munda_Airport',
    ],
  ]);
});
