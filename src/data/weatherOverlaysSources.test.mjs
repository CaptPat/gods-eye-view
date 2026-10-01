import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GFS_GRIDDAP_URL,
  OVERLAY_KEYS,
  gfsGridUrl,
  gfsValidTime,
  googleTileUrl,
  googleTimeBucket,
  isGfsTime,
  isGoogleKey,
  isGoogleTime,
  isOverlayKey,
  parseGfsCsv,
  parseTileCoords,
} from '../../server/providers/weather-overlays/sources.js';

const fixture = (name) =>
  readFileSync(
    new URL(`./fixtures/weather-overlays/${name}`, import.meta.url),
    'utf8',
  );
const hour = (h, day = 14) => Date.UTC(2026, 8, day, h);
const NOW = Date.UTC(2026, 8, 14, 16, 20);

test('overlay keys and tile coordinates follow each mode zoom cap', () => {
  assert.deepEqual(OVERLAY_KEYS, [
    'temperature',
    'air-quality',
    'pollen-tree',
    'pollen-grass',
    'pollen-weed',
  ]);
  assert.equal(isOverlayKey('pollen'), false, 'pollen is served per type');
  assert.equal(isGoogleKey('pollen-weed'), true);
  assert.equal(isGoogleKey('temperature'), false);
  assert.equal(
    isOverlayKey('clouds'),
    false,
    'clouds moved to Satellite clouds',
  );
  assert.deepEqual(parseTileCoords('temperature', '6', '63', '0'), {
    z: 6,
    x: 63,
    y: 0,
  });
  assert.deepEqual(parseTileCoords('air-quality', '12', '0', '0'), {
    z: 12,
    x: 0,
    y: 0,
  });
  for (const [key, z] of [
    ['temperature', '7'],
    ['air-quality', '13'],
    ['pollen-grass', '11'],
  ]) {
    assert.equal(parseTileCoords(key, z, '0', '0'), null, `${key} z${z}`);
  }
  for (const bad of [
    ['4', '16', '0'],
    ['4', '0', '-1'],
    ['1.5', '0', '0'],
    ['a', '0', '0'],
  ]) {
    assert.equal(parseTileCoords('temperature', ...bad), null, bad.join('/'));
  }
  assert.equal(parseTileCoords('nope', '0', '0', '0'), null);
});

test('the upstream URLs', () => {
  assert.equal(
    googleTileUrl('pollen-grass', { z: 3, x: 1, y: 2 }, 'K E Y'),
    'https://pollen.googleapis.com/v1/mapTypes/GRASS_UPI/heatmapTiles/3/1/2?key=K%20E%20Y',
  );
  assert.equal(
    googleTileUrl('air-quality', { z: 0, x: 0, y: 0 }, 'k'),
    'https://airquality.googleapis.com/v1/mapTypes/US_AQI/heatmapTiles/0/0/0?key=k',
  );

  assert.equal(
    gfsGridUrl(hour(15)),
    `${GFS_GRIDDAP_URL}?tmp2m%5B(2026-09-14T15:00:00Z)%5D%5B(-90):2:(90)%5D%5B(0):2:(359.5)%5D`,
  );
});

test('GFS steps and Google hour buckets are accepted only near now', () => {
  assert.equal(gfsValidTime(NOW), hour(15));
  assert.equal(gfsValidTime(Date.UTC(2026, 8, 14, 16, 31)), hour(18));
  assert.equal(isGfsTime(hour(21), NOW), true);
  assert.equal(isGfsTime(hour(14), NOW), false, 'not a 3-hour step');
  assert.equal(isGfsTime(hour(0, 15), NOW), false, 'more than 6 hours ahead');
  assert.equal(isGfsTime(Number.NaN, NOW), false);

  assert.equal(googleTimeBucket(NOW), hour(16));
  assert.equal(isGoogleTime(hour(14), NOW), true);
  assert.equal(isGoogleTime(hour(17), NOW), true);
  assert.equal(isGoogleTime(hour(13), NOW), false, 'more than 3 hours back');
  assert.equal(isGoogleTime(hour(18), NOW), false, 'more than 1 hour ahead');
  assert.equal(isGoogleTime(Date.UTC(2026, 8, 14, 16, 30), NOW), false);
});

test('the recorded GFS grid parses into a regular south-to-north grid in kelvin', () => {
  const grid = parseGfsCsv(fixture('gfs-tmp2m-30deg.csv'));
  assert.equal(grid.time, hour(15));
  assert.deepEqual(
    [
      grid.lat0,
      grid.latStep,
      grid.latCount,
      grid.lon0,
      grid.lonStep,
      grid.lonCount,
    ],
    [-90, 30, 7, 0, 30, 12],
  );
  assert.equal(grid.kelvin.length, 84);
  assert.ok(Math.abs(grid.kelvin[3 * 12] - 297.2) < 0.01, 'equator at 0°E');
  assert.ok(Math.abs(grid.kelvin[0] - 215.6) < 0.01, 'south pole');

  assert.equal(parseGfsCsv('not a grid'), null);
  const lines = fixture('gfs-tmp2m-30deg.csv').trim().split('\n');
  assert.equal(
    parseGfsCsv(lines.slice(0, -1).join('\n')),
    null,
    'a missing row',
  );
});
