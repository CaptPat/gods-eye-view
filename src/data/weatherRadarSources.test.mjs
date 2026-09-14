import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FRAME_COUNT, FRAME_STEP_MS, IEM_WMS_URL,
  iemCacheKey, iemFrameTimes, iemImageUrl, normalizeRainViewerManifest,
  parseIemQuery, parseTileCoords, rainViewerTileUrl,
} from '../../server/providers/weather-radar/sources.js';

const NOW = Date.UTC(2026, 8, 14, 4, 57, 30);

test('a RainViewer manifest becomes sorted frames with server-side paths', () => {
  const manifest = {
    host: 'https://tilecache.rainviewer.com',
    radar: { past: [
      { time: 1789361400, path: '/v2/radar/50efa037a58e' },
      { time: 1789360800, path: '/v2/radar/4a1b2c3d4e5f' },
      { time: 1789360200, path: '/../etc/passwd' },
      { time: 'x', path: '/v2/radar/abc' },
    ] },
  };
  assert.deepEqual(normalizeRainViewerManifest(manifest), {
    host: 'https://tilecache.rainviewer.com',
    frames: [
      { time: 1789360800000, path: '/v2/radar/4a1b2c3d4e5f' },
      { time: 1789361400000, path: '/v2/radar/50efa037a58e' },
    ],
  });
  assert.equal(normalizeRainViewerManifest({ host: 'http://insecure.example', radar: { past: [] } }), null);
  assert.equal(normalizeRainViewerManifest({ host: 'https://tilecache.rainviewer.com' }), null);
});

test('IEM frames are 13 ten-minute boundaries ending at least five minutes ago', () => {
  const times = iemFrameTimes(NOW);
  assert.equal(times.length, FRAME_COUNT);
  assert.equal(times.at(-1), Date.UTC(2026, 8, 14, 4, 50));
  assert.equal(times[0], Date.UTC(2026, 8, 14, 2, 50));
  for (let i = 1; i < times.length; i += 1) assert.equal(times[i] - times[i - 1], FRAME_STEP_MS);
  assert.equal(iemFrameTimes(Date.UTC(2026, 8, 14, 4, 54, 59)).at(-1), Date.UTC(2026, 8, 14, 4, 40));
});

test('tile coordinates must be integers within zoom 0-7', () => {
  assert.deepEqual(parseTileCoords('4', '3', '6'), { z: 4, x: 3, y: 6 });
  for (const bad of [['8', '0', '0'], ['4', '16', '0'], ['4', '0', '-1'], ['1.5', '0', '0'], ['a', '0', '0']]) {
    assert.equal(parseTileCoords(...bad), null, bad.join('/'));
  }
  assert.equal(
    rainViewerTileUrl('https://tilecache.rainviewer.com', '/v2/radar/50efa037a58e', { z: 4, x: 3, y: 6 }),
    'https://tilecache.rainviewer.com/v2/radar/50efa037a58e/256/4/3/6/2/1_1.png',
  );
});

test('IEM queries are validated for time, bbox and size', () => {
  const ok = new URLSearchParams({ time: '2026-09-14T04:50:00Z', bbox: '-100,28,-94,34', width: '256', height: '256' });
  assert.deepEqual(parseIemQuery(ok, NOW), { time: '2026-09-14T04:50:00Z', bbox: [-100, 28, -94, 34], width: 256, height: 256 });
  const bad = (patch) => parseIemQuery(new URLSearchParams({ ...Object.fromEntries(ok), ...patch }), NOW);
  assert.match(bad({ time: '2026-09-14T04:52:00Z' }).error, /time/, 'not a 5-minute boundary');
  assert.match(bad({ time: '2026-09-13T20:00:00Z' }).error, /time/, 'older than 6 hours');
  assert.match(bad({ time: '2026-09-14T05:05:00Z' }).error, /time/, 'in the future');
  assert.deepEqual(bad({ bbox: '-135,45,-112.5,67.5' }).bbox, [-135, 45, -112.5, 67.5], 'a level-3 edge tile is accepted');
  assert.match(bad({ bbox: '-140,28,-94,34' }).error, /bbox/, 'west beyond the envelope');
  assert.match(bad({ bbox: '-100,28,-40,34' }).error, /bbox/, 'east beyond the envelope');
  assert.match(bad({ bbox: '-130,21,-50,50' }).error, /bbox/, 'span wider than 70 degrees');
  assert.match(bad({ bbox: '-94,28,-100,34' }).error, /bbox/, 'west not less than east');
  assert.match(bad({ bbox: '-100,28,-94' }).error, /bbox/, 'three numbers');
  assert.match(bad({ width: '513' }).error, /size/);
  assert.match(bad({ height: '0' }).error, /size/);
});

test('IEM image URL uses the time-aware layer, and the cache key is stable', () => {
  const query = { time: '2026-09-14T04:50:00Z', bbox: [-100, 28, -94, 34], width: 256, height: 256 };
  const url = new URL(iemImageUrl(query));
  assert.equal(url.origin + url.pathname, IEM_WMS_URL);
  assert.equal(url.searchParams.get('layers'), 'nexrad-n0q-wmst');
  assert.equal(url.searchParams.get('time'), '2026-09-14T04:50:00Z');
  assert.equal(url.searchParams.get('bbox'), '-100,28,-94,34');
  assert.equal(url.searchParams.get('srs'), 'EPSG:4326');
  assert.equal(url.searchParams.get('transparent'), 'true');
  assert.match(iemCacheKey(query), /^[0-9a-f]{40}$/);
  assert.equal(iemCacheKey(query), iemCacheKey({ ...query }));
  assert.notEqual(iemCacheKey(query), iemCacheKey({ ...query, width: 512 }));
});
