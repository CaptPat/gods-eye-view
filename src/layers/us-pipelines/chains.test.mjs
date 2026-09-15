import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeLineChains } from './sources.js';

const BASE = {
  kind: 'gas-interstate',
  name: null,
  operator: 'A',
  route: null,
  product: null,
  sizeIn: null,
  status: null,
};

test('connected segments with identical attributes chain into one line; junctions and differing attributes stay apart', () => {
  const records = [
    { ...BASE, id: 'gas/1', positions: [0, 0, 1, 0] },
    { ...BASE, id: 'gas/2', positions: [2, 0, 1, 0] },
    { ...BASE, id: 'gas/3', positions: [2, 0, 3, 0] },
    { ...BASE, id: 'gas/4', positions: [5, 5, 6, 6] },
    { ...BASE, id: 'gas/5', operator: 'B', positions: [3, 0, 4, 0] },
    { ...BASE, id: 'gas/6', positions: [10, 0, 11, 0] },
    { ...BASE, id: 'gas/7', positions: [11, 0, 12, 0] },
    { ...BASE, id: 'gas/8', positions: [11, 0, 11, 1] },
  ];
  assert.deepEqual(mergeLineChains(records), [
    { ...BASE, id: 'gas/1', positions: [0, 0, 1, 0, 2, 0, 3, 0] },
    { ...BASE, id: 'gas/4', positions: [5, 5, 6, 6] },
    { ...BASE, id: 'gas/5', operator: 'B', positions: [3, 0, 4, 0] },
    { ...BASE, id: 'gas/6', positions: [10, 0, 11, 0] },
    { ...BASE, id: 'gas/7', positions: [11, 0, 12, 0] },
    { ...BASE, id: 'gas/8', positions: [11, 0, 11, 1] },
  ]);
});

test('chains grow in both directions and stop around a closed loop', () => {
  const records = [
    { ...BASE, id: 'gas/20', positions: [1, 0, 2, 0] },
    { ...BASE, id: 'gas/21', positions: [0, 0, 1, 0] },
    { ...BASE, id: 'gas/22', positions: [2, 0, 3, 0] },
    { ...BASE, id: 'gas/30', positions: [10, 10, 11, 10] },
    { ...BASE, id: 'gas/31', positions: [11, 10, 10, 11] },
    { ...BASE, id: 'gas/32', positions: [10, 11, 10, 10] },
  ];
  assert.deepEqual(mergeLineChains(records), [
    { ...BASE, id: 'gas/20', positions: [0, 0, 1, 0, 2, 0, 3, 0] },
    {
      ...BASE,
      id: 'gas/30',
      positions: [10, 10, 11, 10, 10, 11, 10, 10],
    },
  ]);
  assert.deepEqual(mergeLineChains([]), []);
});
