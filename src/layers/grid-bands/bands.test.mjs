import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBands } from './bands.js';

const row = (levels) => (_row, col) => levels[col];

test('equal neighbouring cells in a row merge into one rectangle per level', () => {
  assert.deepEqual(
    buildBands({
      cols: 6,
      rows: 1,
      west: 0,
      south: 10,
      cellDeg: 1,
      levelAt: row([null, 0, 0, 1, 1, undefined]),
    }),
    [
      { level: 0, west: 1, south: 10, east: 3, north: 11 },
      { level: 1, west: 3, south: 10, east: 5, north: 11 },
    ],
  );
});

test('runs stop at the longitude cap so no rectangle grows too wide', () => {
  assert.deepEqual(
    buildBands({
      cols: 5,
      rows: 1,
      west: 0,
      south: 0,
      cellDeg: 1,
      maxRunDeg: 2,
      levelAt: () => 0,
    }).map(({ west, east }) => [west, east]),
    [
      [0, 2],
      [2, 4],
      [4, 5],
    ],
  );
});

test('rows are clamped at the poles, and a row with no height is skipped', () => {
  assert.deepEqual(
    buildBands({
      cols: 1,
      rows: 3,
      west: 0,
      south: -90.5,
      cellDeg: 1,
      levelAt: () => 2,
    }).map(({ south, north }) => [south, north]),
    [
      [-90, -89.5],
      [-89.5, -88.5],
      [-88.5, -87.5],
    ],
  );
  assert.deepEqual(
    buildBands({
      cols: 1,
      rows: 2,
      west: 0,
      south: 90,
      cellDeg: 1,
      levelAt: () => 0,
    }),
    [],
  );
});

test('a run across the antimeridian splits in two, and longitudes past 180 wrap', () => {
  assert.deepEqual(
    buildBands({
      cols: 3,
      rows: 1,
      west: 178.5,
      south: 0,
      cellDeg: 1,
      levelAt: () => 0,
    }).map(({ west, east }) => [west, east]),
    [
      [178.5, 180],
      [-180, -178.5],
    ],
  );
  assert.deepEqual(
    buildBands({
      cols: 1,
      rows: 1,
      west: 190,
      south: 0,
      cellDeg: 1,
      levelAt: () => 0,
    }).map(({ west, east }) => [west, east]),
    [[-170, -169]],
  );
});

test('an OVATION-shaped grid places a single cell centred on longitude 0', () => {
  const bands = buildBands({
    cols: 360,
    rows: 181,
    west: -0.5,
    south: -90.5,
    cellDeg: 1,
    levelAt: (r, c) => (r === 160 && c === 0 ? 1 : null),
  });
  assert.deepEqual(bands, [
    { level: 1, west: -0.5, south: 69.5, east: 0.5, north: 70.5 },
  ]);
});

test('an empty or degenerate grid yields no rectangles', () => {
  assert.deepEqual(
    buildBands({
      cols: 0,
      rows: 5,
      west: 0,
      south: 0,
      cellDeg: 1,
      levelAt: () => 0,
    }),
    [],
  );
  assert.deepEqual(
    buildBands({
      cols: 5,
      rows: 5,
      west: 0,
      south: 0,
      cellDeg: 0,
      levelAt: () => 0,
    }),
    [],
  );
});
