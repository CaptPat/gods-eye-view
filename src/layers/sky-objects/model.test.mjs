import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MESSIER_COLORS,
  PLANETS,
  SKY_OBJECTS_META,
  messierCategory,
  messierLabel,
  parseMessier,
  skyObjectsStatus,
} from './model.js';

test('the layer meta names a Planets & Deep Sky layer', () => {
  assert.deepEqual(
    [
      SKY_OBJECTS_META.id,
      SKY_OBJECTS_META.name,
      SKY_OBJECTS_META.icon,
      SKY_OBJECTS_META.source,
    ],
    ['sky-objects', 'Planets & Deep Sky', '🪐', 'astronomy-engine · Messier'],
  );
  assert.deepEqual(
    PLANETS.map((planet) => planet.name),
    ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'],
  );
});

test('Messier types fall into galaxies, nebulae, clusters and other objects', () => {
  const cases = {
    s: 'galaxy',
    e: 'galaxy',
    i: 'galaxy',
    pn: 'nebula',
    rn: 'nebula',
    sfr: 'nebula',
    snr: 'nebula',
    gc: 'cluster',
    oc: 'cluster',
    pos: 'other',
  };
  for (const [type, category] of Object.entries(cases))
    assert.equal(messierCategory(type), category, type);
  assert.deepEqual(Object.keys(MESSIER_COLORS), [
    'galaxy',
    'nebula',
    'cluster',
    'other',
  ]);
});

test('bundled Messier rows become labelled objects; malformed rows are dropped', () => {
  const parsed = parseMessier([
    ['M31', 'Andromeda', 's', 3.4, 10.675, 41.267],
    ['M32', '', 'e', 8.2, 10.675, 40.867],
    ['Mx', '', 's', 'x', 0, 0],
    ['My', '', 'oc', 5, 0, 95],
  ]);
  assert.deepEqual(parsed, [
    {
      id: 'M31',
      name: 'Andromeda',
      category: 'galaxy',
      mag: 3.4,
      ra: 10.675,
      dec: 41.267,
    },
    {
      id: 'M32',
      name: null,
      category: 'galaxy',
      mag: 8.2,
      ra: 10.675,
      dec: 40.867,
    },
  ]);
  assert.equal(messierLabel(parsed[0]), 'M31 Andromeda');
  assert.equal(messierLabel(parsed[1]), 'M32');
  assert.equal(parseMessier('x'), null);
});

test('the row counts planets and Messier objects', () => {
  assert.equal(
    skyObjectsStatus({ planets: 7, messier: 110 }),
    '7 planets · 110 Messier objects',
  );
});
