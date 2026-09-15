import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HERITAGE_QUERIES,
  fortDetailsQuery,
  mergeFortBindings,
  normalizeFortsCastles,
} from './wikidata.js';

const uri = (id) => ({
  type: 'uri',
  value: `http://www.wikidata.org/entity/${id}`,
});
const literal = (value) => ({ type: 'literal', value });

test('fort id queries skip labels and articles so each class answers inside the query timeout', () => {
  assert.equal(HERITAGE_QUERIES.forts.length, 4);
  for (const query of HERITAGE_QUERIES.forts) {
    assert.doesNotMatch(query, /wikibase:label/);
    assert.doesNotMatch(query, /schema:about/);
    assert.match(query, /BIND\("[a-z ]+" AS \?clsLabel\)/);
  }
});

test('a details query asks for labels, country and article for exactly the chunk of ids', () => {
  const query = fortDetailsQuery(['Q1', 'Q22']);
  assert.match(query, /VALUES \?item \{ wd:Q1 wd:Q22 \}/);
  assert.match(query, /wikibase:label/);
  assert.match(query, /wdt:P17/);
  assert.match(query, /schema:isPartOf <https:\/\/en\.wikipedia\.org\/>/);
});

test('id and detail bindings merge per item into rows the fort normaliser reads', () => {
  const merged = mergeFortBindings(
    [
      {
        item: uri('Q1'),
        coord: literal('Point(1 2)'),
        clsLabel: literal('castle'),
      },
      {
        item: uri('Q1'),
        coord: literal('Point(1 2)'),
        clsLabel: literal('fortification'),
      },
      {
        item: uri('Q3'),
        coord: literal('Point(5 6)'),
        clsLabel: literal('fort'),
      },
    ],
    [
      {
        item: uri('Q1'),
        itemLabel: literal('Keep'),
        countryLabel: literal('X'),
      },
      {
        item: uri('Q1'),
        itemLabel: literal('Keep'),
        countryLabel: literal('Y'),
      },
    ],
  );
  assert.deepEqual(
    normalizeFortsCastles({ results: { bindings: merged } }).map((fort) => [
      fort.id,
      fort.name,
      fort.kinds,
      fort.country,
      fort.lat,
      fort.lon,
    ]),
    [['Q1', 'Keep', ['castle', 'fortification'], 'X', 2, 1]],
    'an item with no details has no name and is dropped',
  );
});
