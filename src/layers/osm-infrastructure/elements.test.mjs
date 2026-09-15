import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOsmElements, thinPositions } from './elements.js';

const LINE_STYLE = { kind: 'line', color: '#ffffff', width: 2 };
const SUBSTATION_STYLE = { kind: 'substation', color: '#cccccc', pixelSize: 6 };
const classifyLine = (tags) => (tags.power === 'line' ? LINE_STYLE : null);
const classifyPoint = (tags) =>
  tags.power === 'substation' ? SUBSTATION_STYLE : null;

const RING = [
  { lat: 30, lon: -97 },
  { lat: 30, lon: -96.9 },
  { lat: 30.1, lon: -96.9 },
  { lat: 30.1, lon: -97 },
  { lat: 30, lon: -97 },
];

test('long lines keep evenly spaced vertices and always their last one', () => {
  const five = [
    [0, 0],
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 4],
  ];
  assert.deepEqual(thinPositions(five, 3), [
    [0, 0],
    [2, 2],
    [4, 4],
  ]);
  assert.deepEqual(thinPositions(five, 10), five);
  assert.deepEqual(thinPositions(five.slice(0, 4), 3), [
    [0, 0],
    [2, 2],
    [3, 3],
  ]);
});

test('ways become lines, nodes and areas become points, and everything else is dropped', () => {
  const lineTags = { power: 'line', voltage: '220000' };
  const { lines, points } = normalizeOsmElements(
    [
      {
        type: 'way',
        id: 1,
        tags: lineTags,
        geometry: [
          { lat: 30, lon: -97 },
          { lat: 30.1, lon: -97.1 },
          { lat: 30.2, lon: -97.2 },
          { lat: 30.3, lon: -97.3 },
          { lat: 30.4, lon: -97.4 },
        ],
      },
      {
        type: 'node',
        id: 2,
        lat: 30.05,
        lon: -97.05,
        tags: { power: 'substation', name: 'North' },
      },
      { type: 'way', id: 3, tags: { power: 'substation' }, geometry: RING },
      { type: 'way', id: 4, tags: { power: 'tower' }, geometry: RING },
      { type: 'way', id: 5, tags: { power: 'line' } },
      { type: 'node', id: 6, tags: { power: 'substation' } },
      { type: 'way', id: 1, tags: lineTags, geometry: RING },
      null,
    ],
    { classifyLine, classifyPoint, maxVertices: 3 },
  );
  assert.deepEqual(lines, [
    {
      id: 'way/1',
      positions: [
        [-97, 30],
        [-97.2, 30.2],
        [-97.4, 30.4],
      ],
      tags: lineTags,
      ...LINE_STYLE,
    },
  ]);
  assert.deepEqual(points, [
    {
      id: 'node/2',
      lat: 30.05,
      lon: -97.05,
      tags: { power: 'substation', name: 'North' },
      ...SUBSTATION_STYLE,
    },
    {
      id: 'way/3',
      lat: 30.05,
      lon: -96.95,
      tags: { power: 'substation' },
      ...SUBSTATION_STYLE,
    },
  ]);
});
