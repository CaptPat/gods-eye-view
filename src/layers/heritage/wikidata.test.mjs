import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  HERITAGE_QUERIES,
  normalizeFortsCastles,
  normalizeParksMonuments,
  normalizeWorldHeritage,
} from './wikidata.js';

const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../../data/fixtures/heritage/${name}`, import.meta.url),
      'utf8',
    ),
  );
const pickFields = (record, names) =>
  Object.fromEntries(names.map((name) => [name, record[name]]));

test('queries cover World Heritage designation, each fort class separately, and parks with monuments', () => {
  assert.deepEqual(Object.keys(HERITAGE_QUERIES), [
    'worldHeritage',
    'forts',
    'parks',
  ]);
  assert.match(HERITAGE_QUERIES.worldHeritage, /wdt:P1435 wd:Q9259/);
  assert.equal(HERITAGE_QUERIES.forts.length, 4);
  for (const label of ['castle', 'fort', 'fortification', 'star fort'])
    assert.ok(
      HERITAGE_QUERIES.forts.some((query) => query.includes(`"${label}"@en`)),
      label,
    );
  assert.match(HERITAGE_QUERIES.parks, /wd:Q46169/);
  assert.match(HERITAGE_QUERIES.parks, /wd:Q893775/);
});

test('World Heritage sites keep every country and their earliest inception year', () => {
  const sites = normalizeWorldHeritage(fixture('wikidata-world-heritage.json'));
  assert.deepEqual(
    sites.map((site) =>
      pickFields(site, [
        'id',
        'name',
        'lat',
        'lon',
        'countries',
        'year',
        'wikipedia',
      ]),
    ),
    [
      {
        id: 'Q192666',
        name: 'Białowieża Forest',
        lat: 52.75,
        lon: 23.95,
        countries: ['Belarus', 'Poland'],
        year: 1932,
        wikipedia: 'https://en.wikipedia.org/wiki/Bia%C5%82owie%C5%BCa_Forest',
      },
      {
        id: 'Q3457361',
        name: 'Hubei Shennongjia',
        lat: 31.29,
        lon: 110.19,
        countries: ["People's Republic of China"],
        year: null,
        wikipedia: null,
      },
      {
        id: 'Q278908',
        name: 'Margravial Opera House',
        lat: 49.94434,
        lon: 11.57866,
        countries: ['Germany'],
        year: 1744,
        wikipedia: 'https://en.wikipedia.org/wiki/Margravial_Opera_House',
      },
    ],
  );
});

test('forts and castles take their kind from class and drop items with no name', () => {
  const forts = normalizeFortsCastles(fixture('wikidata-forts.json'));
  assert.deepEqual(
    forts.map((fort) => [
      fort.id,
      fort.name,
      fort.kinds,
      fort.country,
      fort.lat,
      fort.lon,
    ]),
    [
      [
        'Q81650',
        'Anadoluhisarı',
        ['fortification'],
        'Turkey',
        41.08214,
        29.06703,
      ],
      [
        'Q142121',
        'Finlarig Castle',
        ['castle'],
        'United Kingdom',
        56.475,
        -4.31506,
      ],
      [
        'Q632232',
        'Fort Charlotte',
        ['fort'],
        'United Kingdom',
        60.15536,
        -1.14436,
      ],
      ['Q150039', 'Neuf-Brisach', ['star-fort'], 'France', 48.01806, 7.52833],
    ],
  );
});

test('parks and monuments keep both kinds when an item is both', () => {
  const parks = normalizeParksMonuments(fixture('wikidata-parks.json'));
  assert.deepEqual(
    parks.map((park) =>
      pickFields(park, ['id', 'kinds', 'country', 'year', 'lat', 'lon']),
    ),
    [
      {
        id: 'Q119150',
        kinds: ['park'],
        country: 'Sweden',
        year: 1991,
        lat: 63.97404,
        lon: 18.01487,
      },
      {
        id: 'Q129902',
        kinds: ['park', 'monument'],
        country: 'United States',
        year: 1937,
        lat: 38.2,
        lon: -111.167,
      },
    ],
  );
  assert.equal(normalizeParksMonuments({ results: {} }), null);
});
