import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AURORA_BAND_LEVELS,
  AURORA_META,
  auroraStatusLabel,
  parseAuroraPayload,
} from './model.js';

const FORECAST = Date.parse('2026-09-15T12:36:00Z');
const BAND = { level: 1, west: -10, south: 68.5, east: 20, north: 69.5 };

test('the layer meta names an aurora layer sourced from NOAA SWPC', () => {
  assert.deepEqual(
    [AURORA_META.id, AURORA_META.name, AURORA_META.icon, AURORA_META.source],
    ['aurora-forecast', 'Aurora Forecast', '🌌', 'NOAA SWPC'],
  );
});

test('four bands run from faint green through green and yellow to magenta', () => {
  assert.deepEqual(AURORA_BAND_LEVELS, [
    { threshold: 5, color: '#2ecc71', alpha: 0.16 },
    { threshold: 10, color: '#7cff6b', alpha: 0.28 },
    { threshold: 30, color: '#ffe66d', alpha: 0.38 },
    { threshold: 50, color: '#ff3dd8', alpha: 0.48 },
  ]);
});

test('the row reads the peak probability and the forecast time in UTC', () => {
  assert.equal(
    auroraStatusLabel({ maxProbability: 12, forecastTime: FORECAST }),
    'Peak 12% · forecast 12:36 UTC',
  );
  assert.equal(
    auroraStatusLabel({ maxProbability: 0, forecastTime: null }),
    'Peak 0%',
  );
});

test('the proxy payload keeps only drawable bands; a broken payload is refused', () => {
  assert.deepEqual(
    parseAuroraPayload({
      generatedAt: 1,
      stale: true,
      observationTime: FORECAST - 3_600_000,
      forecastTime: FORECAST,
      maxProbability: 12,
      bands: [
        BAND,
        { ...BAND, level: 4 },
        { ...BAND, west: 'x' },
        { ...BAND, east: -20 },
        null,
      ],
    }),
    { bands: [BAND], maxProbability: 12, forecastTime: FORECAST, stale: true },
  );
  assert.equal(parseAuroraPayload({ bands: 'x', maxProbability: 1 }), null);
  assert.equal(parseAuroraPayload({ bands: [], maxProbability: 'x' }), null);
  assert.equal(parseAuroraPayload(null), null);
});
