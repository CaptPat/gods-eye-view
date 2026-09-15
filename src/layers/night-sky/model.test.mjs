import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NIGHT_SKY_META,
  nightSkyStatus,
  parseNightSkyData,
  starStyle,
} from './model.js';

test('the layer meta names a Night Sky layer from Hipparcos and the IAU figures', () => {
  assert.deepEqual(
    [
      NIGHT_SKY_META.id,
      NIGHT_SKY_META.name,
      NIGHT_SKY_META.icon,
      NIGHT_SKY_META.source,
    ],
    ['night-sky', 'Night Sky', '✨', 'Hipparcos · IAU'],
  );
});

test('bundled rows become stars, names, figures and labels; malformed rows are dropped', () => {
  assert.deepEqual(
    parseNightSkyData({
      stars: [
        [101.287, -16.716, -1.44, 0.009],
        [1, 2, 'x', null],
        [400, 0, 1, 0],
        [279.235, 38.784, 0.03, null],
      ],
      names: [
        [101.287, -16.716, -1.44, 'Sirius'],
        [0, 0, 1, ''],
      ],
      constellations: {
        lines: [
          [
            [30.975, 42.33],
            [17.433, 35.621],
          ],
          [[1, 2]],
          [
            [10, 10],
            [10, 91],
          ],
        ],
        labels: [
          ['Andromeda', 0.75, 43],
          ['Nowhere', 0, 95],
        ],
      },
    }),
    {
      stars: [
        { ra: 101.287, dec: -16.716, mag: -1.44, bv: 0.009 },
        { ra: 279.235, dec: 38.784, mag: 0.03, bv: null },
      ],
      names: [{ ra: 101.287, dec: -16.716, mag: -1.44, name: 'Sirius' }],
      lines: [
        [
          { ra: 30.975, dec: 42.33 },
          { ra: 17.433, dec: 35.621 },
        ],
      ],
      labels: [{ name: 'Andromeda', ra: 0.75, dec: 43 }],
    },
  );
  assert.equal(
    parseNightSkyData({ stars: 'x', names: [], constellations: {} }),
    null,
  );
  assert.equal(parseNightSkyData(null), null);
});

test('Sirius draws at full size and opacity with a blue-white tint', () => {
  assert.deepEqual(
    starStyle({ ra: 101.287, dec: -16.716, mag: -1.44, bv: 0.009 }),
    {
      pixelSize: 7,
      color: '#cad7ff',
      alpha: 1,
    },
  );
});

test('the row counts stars and constellations', () => {
  assert.equal(
    nightSkyStatus({ stars: [1, 2, 3], labels: [1, 2] }),
    '3 stars · 2 constellations',
  );
});
