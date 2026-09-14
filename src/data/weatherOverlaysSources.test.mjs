import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GFS_GRIDDAP_URL,
  GMGSI_WMS_URL,
  OVERLAY_KEYS,
  gfsGridUrl,
  gfsValidTime,
  gmgsiTileUrl,
  googleTileUrl,
  googleTimeBucket,
  isGfsTime,
  isGoogleKey,
  isGoogleTime,
  isOverlayKey,
  mercatorBounds,
  parseGfsCsv,
  parseGmgsiTimes,
  parseTileCoords,
} from '../../server/providers/weather-overlays/sources.js';

const fixture = (name) =>
  readFileSync(
    new URL(`./fixtures/weather-overlays/${name}`, import.meta.url),
    'utf8',
  );
const hour = (h, day = 14) => Date.UTC(2026, 8, day, h);
const NOW = Date.UTC(2026, 8, 14, 16, 20);
const HALF = 20037508.342789244;

test('overlay keys and tile coordinates follow each mode zoom cap', () => {
  assert.deepEqual(OVERLAY_KEYS, [
    'clouds',
    'temperature',
    'air-quality',
    'pollen-tree',
    'pollen-grass',
    'pollen-weed',
  ]);
  assert.equal(isOverlayKey('pollen'), false, 'pollen is served per type');
  assert.equal(isGoogleKey('pollen-weed'), true);
  assert.equal(isGoogleKey('clouds'), false);
  assert.deepEqual(parseTileCoords('clouds', '7', '127', '0'), {
    z: 7,
    x: 127,
    y: 0,
  });
  assert.deepEqual(parseTileCoords('air-quality', '12', '0', '0'), {
    z: 12,
    x: 0,
    y: 0,
  });
  for (const [key, z] of [
    ['clouds', '8'],
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
    assert.equal(parseTileCoords('clouds', ...bad), null, bad.join('/'));
  }
  assert.equal(parseTileCoords('nope', '0', '0', '0'), null);
});

test('Web Mercator bounds and the upstream URLs', () => {
  const east = mercatorBounds({ z: 1, x: 1, y: 0 });
  assert.equal(east.west, 0);
  assert.equal(east.south, 0);
  assert.ok(Math.abs(east.east - HALF) < 1e-6);
  assert.ok(Math.abs(east.north - HALF) < 1e-6);

  assert.equal(
    googleTileUrl('pollen-grass', { z: 3, x: 1, y: 2 }, 'K E Y'),
    'https://pollen.googleapis.com/v1/mapTypes/GRASS_UPI/heatmapTiles/3/1/2?key=K%20E%20Y',
  );
  assert.equal(
    googleTileUrl('air-quality', { z: 0, x: 0, y: 0 }, 'k'),
    'https://airquality.googleapis.com/v1/mapTypes/US_AQI/heatmapTiles/0/0/0?key=k',
  );

  const wms = new URL(gmgsiTileUrl(hour(15), { z: 9, x: 121, y: 212 }));
  assert.equal(wms.origin + wms.pathname, GMGSI_WMS_URL);
  assert.equal(
    wms.searchParams.get('layers'),
    'global_longwave_imagery_mosaic',
  );
  assert.equal(wms.searchParams.get('crs'), 'EPSG:3857');
  assert.equal(wms.searchParams.get('version'), '1.3.0');
  assert.equal(wms.searchParams.get('time'), '2026-09-14T15:00:00Z');
  const bbox = wms.searchParams.get('bbox').split(',').map(Number);
  assert.deepEqual(
    bbox.map((value) => Math.round(value)),
    [-10566655, 3365675, -10488383, 3443947],
  );

  assert.equal(
    gfsGridUrl(hour(15)),
    `${GFS_GRIDDAP_URL}?tmp2m%5B(2026-09-14T15:00:00Z)%5D%5B(-90):2:(90)%5D%5B(0):2:(359.5)%5D`,
  );
});

test('GMGSI times parse from the recorded capabilities, including ISO ranges', () => {
  assert.deepEqual(
    parseGmgsiTimes(fixture('gmgsi-capabilities.xml')),
    [10, 11, 12, 13, 14, 15].map((h) => hour(h)),
  );
  const ranged =
    '<Layer><Name>global_longwave_imagery_mosaic</Name>' +
    '<Dimension name="time" units="ISO8601">2026-09-14T13:00:00.000Z/2026-09-14T15:00:00.000Z/PT1H</Dimension></Layer>';
  assert.deepEqual(
    parseGmgsiTimes(ranged),
    [13, 14, 15].map((h) => hour(h)),
  );
  assert.deepEqual(parseGmgsiTimes('<Layer><Name>other</Name></Layer>'), []);
  assert.deepEqual(parseGmgsiTimes(null), []);
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
