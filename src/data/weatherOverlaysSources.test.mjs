import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OVERLAY_KEYS,
  googleTileUrl,
  googleTimeBucket,
  isGoogleKey,
  isGoogleTime,
  isOverlayKey,
  parseTileCoords,
} from '../../server/providers/weather-overlays/sources.js';

const hour = (h, day = 14) => Date.UTC(2026, 8, day, h);
const NOW = Date.UTC(2026, 8, 14, 16, 20);

test('overlay keys and tile coordinates follow each mode zoom cap', () => {
  assert.deepEqual(OVERLAY_KEYS, [
    'air-quality',
    'pollen-tree',
    'pollen-grass',
    'pollen-weed',
  ]);
  assert.equal(isOverlayKey('pollen'), false, 'pollen is served per type');
  for (const moved of ['clouds', 'temperature']) {
    assert.equal(isOverlayKey(moved), false, `${moved} moved upstream`);
  }
  assert.ok(OVERLAY_KEYS.every(isGoogleKey), 'every key is a Google heatmap');
  assert.deepEqual(parseTileCoords('air-quality', '12', '4095', '0'), {
    z: 12,
    x: 4095,
    y: 0,
  });
  for (const [key, z] of [
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
    assert.equal(parseTileCoords('air-quality', ...bad), null, bad.join('/'));
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
});

test('Google hour buckets are accepted only near now', () => {
  assert.equal(googleTimeBucket(NOW), hour(16));
  assert.equal(isGoogleTime(hour(14), NOW), true);
  assert.equal(isGoogleTime(hour(17), NOW), true);
  assert.equal(isGoogleTime(hour(13), NOW), false, 'more than 3 hours back');
  assert.equal(isGoogleTime(hour(18), NOW), false, 'more than 1 hour ahead');
  assert.equal(isGoogleTime(Date.UTC(2026, 8, 14, 16, 30), NOW), false);
});
