import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FORT_COLORS,
  HERITAGE_FIELDS,
  HERITAGE_LAYERS,
  buildFortCard,
  buildParkCard,
  buildWorldHeritageCard,
  parseHeritageSnapshot,
  toHeritageRows,
} from './model.js';

const BASE = {
  description: null,
  kinds: [],
  date: null,
  place: null,
  approximate: false,
  wikipedia: null,
};
const BIALOWIEZA = {
  ...BASE,
  id: 'Q192666',
  name: 'Białowieża Forest',
  description: 'old forest in Poland and Belarus',
  lat: 52.75,
  lon: 23.95,
  wikipedia: 'https://en.wikipedia.org/wiki/Bia%C5%82owie%C5%BCa_Forest',
  wikidata: 'https://www.wikidata.org/wiki/Q192666',
  countries: ['Belarus', 'Poland'],
  year: 1932,
};

test('three heritage layers with their own ids, names and icons', () => {
  assert.deepEqual(
    Object.values(HERITAGE_LAYERS).map((meta) => [
      meta.id,
      meta.name,
      meta.icon,
      meta.source,
    ]),
    [
      ['world-heritage', 'World Heritage Sites', '🏛️', 'Wikidata'],
      ['forts-castles', 'Forts & Castles', '🏰', 'Wikidata'],
      ['parks-monuments', 'National Parks & Monuments', '🏞️', 'Wikidata'],
    ],
  );
});

test('normalised records compact into rows that keep the article title, not the full URL', () => {
  assert.deepEqual(HERITAGE_FIELDS.worldHeritage, [
    'id',
    'name',
    'lat',
    'lon',
    'countries',
    'year',
    'wiki',
    'description',
  ]);
  assert.deepEqual(toHeritageRows('worldHeritage', [BIALOWIEZA]), [
    [
      'Q192666',
      'Białowieża Forest',
      52.75,
      23.95,
      ['Belarus', 'Poland'],
      1932,
      'Bia%C5%82owie%C5%BCa_Forest',
      'old forest in Poland and Belarus',
    ],
  ]);
  assert.deepEqual(
    toHeritageRows('forts', [
      {
        ...BASE,
        id: 'Q1',
        name: 'Twin',
        kinds: ['fortification', 'castle'],
        lat: 1,
        lon: 2,
        country: 'X',
      },
    ]),
    [['Q1', 'Twin', 'castle', 1, 2, 'X', null]],
    'a castle that is also a fortification reads as a castle',
  );
  assert.deepEqual(
    toHeritageRows('parks', [
      {
        ...BASE,
        id: 'Q129902',
        name: 'Capitol Reef National Park',
        kinds: ['park', 'monument'],
        lat: 38.2,
        lon: -111.167,
        country: 'United States',
        year: 1937,
      },
    ])[0].slice(0, 3),
    ['Q129902', 'Capitol Reef National Park', 'park'],
  );
});

test('World Heritage cards give the inception year, every country and the description', () => {
  assert.deepEqual(
    buildWorldHeritageCard(
      parseHeritageSnapshot(
        {
          fields: HERITAGE_FIELDS.worldHeritage,
          rows: toHeritageRows('worldHeritage', [BIALOWIEZA]),
        },
        'worldHeritage',
      ).records[0],
    ),
    {
      title: 'Białowieża Forest',
      details: [
        'World Heritage Site · established 1932',
        'Belarus, Poland',
        'old forest in Poland and Belarus',
      ],
      url: 'https://en.wikipedia.org/wiki/Bia%C5%82owie%C5%BCa_Forest',
      accessibilityLabel: 'Open the Wikipedia article on Białowieża Forest',
    },
  );
  const hubei = buildWorldHeritageCard({
    id: 'Q3457361',
    name: 'Hubei Shennongjia',
    countries: ["People's Republic of China"],
    year: null,
    wiki: null,
    description: 'Biosphere reserve in China, designated in 1990',
  });
  assert.deepEqual(hubei.details, [
    'World Heritage Site',
    "People's Republic of China",
    'Biosphere reserve in China, designated in 1990',
  ]);
  assert.equal(hubei.url, 'https://www.wikidata.org/wiki/Q3457361');
});

test('fort and park cards name their kind with country, year and description', () => {
  assert.deepEqual(
    buildFortCard({
      id: 'Q150039',
      name: 'Neuf-Brisach',
      kind: 'star-fort',
      country: 'France',
      wiki: 'Neuf-Brisach',
    }),
    {
      title: 'Neuf-Brisach',
      details: ['Star fort · France'],
      url: 'https://en.wikipedia.org/wiki/Neuf-Brisach',
      accessibilityLabel: 'Open the Wikipedia article on Neuf-Brisach',
    },
  );
  assert.deepEqual(
    buildFortCard({
      id: 'Q9',
      name: 'Nameless Keep',
      kind: 'fortification',
      country: null,
      wiki: null,
    }).details,
    ['Fortification'],
  );
  assert.deepEqual(
    buildParkCard({
      id: 'Q119150',
      name: 'Björnlandet National Park',
      kind: 'park',
      country: 'Sweden',
      year: 1991,
      wiki: 'Bj%C3%B6rnlandet_National_Park',
      description: 'national park of Sweden',
    }).details,
    ['National park · established 1991', 'Sweden', 'national park of Sweden'],
  );
  assert.deepEqual(
    buildParkCard({
      id: 'Q2',
      name: 'Some Monument',
      kind: 'monument',
      country: 'United States',
      year: null,
      wiki: null,
      description: null,
    }).details,
    ['National monument', 'United States'],
  );
});

test('snapshots style each layer; mismatched fields and bad rows are refused', () => {
  const forts = parseHeritageSnapshot(
    {
      fields: HERITAGE_FIELDS.forts,
      rows: [
        [
          'Q142121',
          'Finlarig Castle',
          'castle',
          56.475,
          -4.31506,
          'United Kingdom',
          'Finlarig_Castle',
        ],
        ['Q1', 'Bad', 'castle', 95, 0, null, null],
      ],
    },
    'forts',
  );
  assert.equal(forts.records.length, 1);
  assert.equal(forts.records[0].color, FORT_COLORS.castle);
  assert.equal(forts.records[0].pixelSize, 4);
  const parks = parseHeritageSnapshot(
    {
      fields: HERITAGE_FIELDS.parks,
      rows: [
        [
          'Q2',
          'Some Monument',
          'monument',
          40,
          -110,
          'United States',
          null,
          null,
          null,
        ],
      ],
    },
    'parks',
  );
  assert.equal(parks.records[0].color, '#2a9d8f');
  assert.equal(
    parseHeritageSnapshot({ fields: ['id'], rows: [] }, 'forts'),
    null,
  );
  assert.equal(
    parseHeritageSnapshot({ fields: HERITAGE_FIELDS.forts, rows: [] }, 'nope'),
    null,
  );
});
