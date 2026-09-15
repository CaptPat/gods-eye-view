import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWikidataPoints } from './normalize.js';

const binding = (item, values) => ({
  item: { type: 'uri', value: `http://www.wikidata.org/entity/${item}` },
  ...Object.fromEntries(
    Object.entries(values).map(([name, value]) => [
      name,
      { type: 'literal', value: String(value) },
    ]),
  ),
});

const FIELDS = {
  statuses: { variable: 'stateLabel', type: 'list' },
  capacityMw: { variable: 'capacity', type: 'number', pick: 'max' },
  operator: { variable: 'operatorLabel' },
  country: { variable: 'countryLabel' },
  startYear: { variable: 'start', type: 'year', pick: 'min' },
  endYear: { variable: 'end', type: 'year', pick: 'max' },
};

const JSON_BINDINGS = {
  results: {
    bindings: [
      binding('Q1', {
        itemLabel: 'Alpha Plant',
        coord: 'Point(30.1 51.4)',
        stateLabel: 'decommissioned',
        capacity: '1000',
        start: '1977-05-26T00:00:00Z',
        article: 'https://en.wikipedia.org/wiki/Alpha',
      }),
      binding('Q1', {
        itemLabel: 'Alpha Plant',
        coord: 'Point(30.1 51.4)',
        stateLabel: 'in use',
        capacity: '3515',
        start: '1972-01-01T00:00:00Z',
        operatorLabel: 'Q999',
        end: '2000-12-15T00:00:00Z',
      }),
      binding('Q2', {
        itemLabel: 'Beta Site',
        itemDescription: 'deep repository',
        placeCoord: 'Point(-10 20)',
        placeLabel: 'Somewhere',
        clsLabel: 'deep geological repository',
        countryLabel: 'Finland',
        date: '2025-01-01T00:00:00Z',
      }),
      binding('Q3', { itemLabel: 'Q3', coord: 'Point(1 1)' }),
      binding('Q4', { itemLabel: 'No Place' }),
    ],
  },
};

test('bindings merge per item into located records with typed, picked fields', () => {
  assert.deepEqual(
    normalizeWikidataPoints(JSON_BINDINGS, {
      kindByClass: { 'deep geological repository': 'deep-geological' },
      fields: FIELDS,
      sort: 'name',
    }),
    [
      {
        id: 'Q1',
        name: 'Alpha Plant',
        description: null,
        kinds: [],
        date: null,
        lat: 51.4,
        lon: 30.1,
        place: null,
        approximate: false,
        wikipedia: 'https://en.wikipedia.org/wiki/Alpha',
        wikidata: 'https://www.wikidata.org/wiki/Q1',
        statuses: ['decommissioned', 'in use'],
        capacityMw: 3515,
        operator: null,
        country: null,
        startYear: 1972,
        endYear: 2000,
      },
      {
        id: 'Q2',
        name: 'Beta Site',
        description: 'deep repository',
        kinds: ['deep-geological'],
        date: '2025-01-01',
        lat: 20,
        lon: -10,
        place: 'Somewhere',
        approximate: true,
        wikipedia: null,
        wikidata: 'https://www.wikidata.org/wiki/Q2',
        statuses: [],
        capacityMw: null,
        operator: null,
        country: 'Finland',
        startYear: null,
        endYear: null,
      },
    ],
  );
});

test('date sorting puts undated records last; a missing binding list is refused', () => {
  const records = normalizeWikidataPoints(JSON_BINDINGS, { sort: 'date' });
  assert.deepEqual(
    records.map((record) => record.id),
    ['Q2', 'Q1'],
  );
  assert.deepEqual(Object.keys(records[1]).sort(), [
    'approximate',
    'date',
    'description',
    'id',
    'kinds',
    'lat',
    'lon',
    'name',
    'place',
    'wikidata',
    'wikipedia',
  ]);
  assert.equal(normalizeWikidataPoints({ results: {} }), null);
  assert.equal(normalizeWikidataPoints(null), null);
});
