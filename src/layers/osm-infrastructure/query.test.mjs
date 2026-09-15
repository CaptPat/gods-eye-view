import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOverpassQuery,
  snapViewBox,
  viewBoxFromRectangle,
} from './query.js';

test('a camera rectangle becomes a query box only when small enough and clear of the antimeridian', () => {
  assert.deepEqual(
    viewBoxFromRectangle(
      { south: 30.2, west: -97.9, north: 30.5, east: -97.6 },
      1.5,
    ),
    { south: 30.2, west: -97.9, north: 30.5, east: -97.6 },
  );
  assert.equal(
    viewBoxFromRectangle({ south: 30, west: -98, north: 31.6, east: -97 }, 1.5),
    null,
  );
  assert.equal(
    viewBoxFromRectangle({ south: 30, west: -98, north: 31, east: -96.4 }, 1.5),
    null,
  );
  assert.equal(
    viewBoxFromRectangle(
      { south: 10, west: 179.5, north: 11, east: -179.5 },
      1.5,
    ),
    null,
  );
  assert.equal(
    viewBoxFromRectangle(
      { south: Number.NaN, west: 0, north: 1, east: 1 },
      1.5,
    ),
    null,
  );
  assert.equal(viewBoxFromRectangle(null, 1.5), null);
});

test('query boxes snap outward to a 0.05° grid so nearby views share one proxy cache entry', () => {
  assert.deepEqual(
    snapViewBox({ south: 29.93, west: -97.02, north: 31.01, east: -96.98 }),
    { south: 29.9, west: -97.05, north: 31.05, east: -96.95 },
  );
  assert.deepEqual(
    snapViewBox({ south: 30, west: -97, north: 30.5, east: -96.5 }),
    { south: 30, west: -97, north: 30.5, east: -96.5 },
  );
});

test('selectors are each bounded by the box and the output is capped', () => {
  assert.equal(
    buildOverpassQuery(
      ['way["power"="line"]', 'node["power"="plant"]'],
      { south: 30, west: -97.05, north: 30.5, east: -96.5 },
      2500,
    ),
    '[out:json][timeout:25];(way["power"="line"](30,-97.05,30.5,-96.5);node["power"="plant"](30,-97.05,30.5,-96.5););out tags geom 2500;',
  );
});
