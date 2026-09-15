import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SEA_ICE_MAX_LEVEL,
  SEA_ICE_META,
  SEA_ICE_PROBE_URL,
  parseLayerTime,
  seaIceTileTemplate,
} from './model.js';

const BASE =
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GHRSST_L4_MUR_Sea_Ice_Concentration/default';

test('tiles come from the GIBS GHRSST MUR sea ice layer in Web Mercator, pinned to one day', () => {
  assert.equal(
    seaIceTileTemplate('2026-09-07'),
    `${BASE}/2026-09-07/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png`,
  );
  assert.equal(
    SEA_ICE_PROBE_URL,
    `${BASE}/default/GoogleMapsCompatible_Level7/0/0/0.png`,
  );
  assert.equal(SEA_ICE_MAX_LEVEL, 7);
  assert.deepEqual(
    [SEA_ICE_META.id, SEA_ICE_META.name, SEA_ICE_META.source],
    ['sea-ice', 'Sea Ice', 'GHRSST MUR'],
  );
});

test('the GIBS Layer-Time-Actual header gives the day shown', () => {
  assert.equal(parseLayerTime('2026-09-07T00:00:00Z'), '2026-09-07');
  assert.equal(parseLayerTime(' 2026-09-07 '), '2026-09-07');
  for (const value of [
    '',
    'yesterday',
    '2026-13-01T00:00:00Z',
    '2026-02-32',
    null,
    undefined,
  ])
    assert.equal(parseLayerTime(value), null, String(value));
});
