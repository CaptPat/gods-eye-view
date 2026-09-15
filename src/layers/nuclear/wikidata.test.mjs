import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  NUCLEAR_QUERIES,
  normalizeNuclearAccidents,
  normalizeNuclearPlants,
  normalizeNuclearWasteSites,
} from './wikidata.js';

const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../../data/fixtures/nuclear/${name}`, import.meta.url),
      'utf8',
    ),
  );
const pickFields = (record, names) =>
  Object.fromEntries(names.map((name) => [name, record[name]]));

test('every layer has its own SPARQL query over the classes it draws', () => {
  assert.deepEqual(Object.keys(NUCLEAR_QUERIES), [
    'plants',
    'waste',
    'accidents',
  ]);
  assert.match(NUCLEAR_QUERIES.plants, /"nuclear power plant"@en/);
  assert.match(NUCLEAR_QUERIES.plants, /wdt:P5817/);
  assert.match(NUCLEAR_QUERIES.waste, /"deep geological repository"@en/);
  assert.match(NUCLEAR_QUERIES.accidents, /wdt:P2127/);
});

test('plants merge their many rows into status lists, peak capacity and service years', () => {
  const plants = normalizeNuclearPlants(fixture('wikidata-plants.json'));
  assert.deepEqual(
    plants.map((plant) => plant.id),
    ['Q215419', 'Q486898', 'Q28223974'],
  );
  const fields = [
    'statuses',
    'capacityMw',
    'operator',
    'country',
    'startYear',
    'endYear',
    'lat',
    'lon',
    'wikipedia',
  ];
  assert.deepEqual(pickFields(plants[0], fields), {
    statuses: ['decommissioned'],
    capacityMw: 3515,
    operator: null,
    country: 'Ukraine',
    startYear: 1972,
    endYear: 2000,
    lat: 51.38955,
    lon: 30.09915,
    wikipedia: 'https://en.wikipedia.org/wiki/Chernobyl_Nuclear_Power_Plant',
  });
  assert.deepEqual(pickFields(plants[1], fields), {
    statuses: ['in use'],
    capacityMw: 7489,
    operator: 'Korea Hydro & Nuclear Power',
    country: 'South Korea',
    startYear: 1978,
    endYear: null,
    lat: 35.32022,
    lon: 129.29461,
    wikipedia: 'https://en.wikipedia.org/wiki/Kori_Nuclear_Power_Plant',
  });
  assert.deepEqual(plants[2].statuses, [
    'building or structure under construction',
  ]);
  assert.equal(plants[2].capacityMw, null);
});

test('waste sites keep only repository classes, falling back to their place when unplaced', () => {
  const sites = normalizeNuclearWasteSites(
    fixture('wikidata-waste-accidents.json'),
  );
  assert.deepEqual(
    sites.map((site) => [
      site.name,
      site.kinds,
      site.approximate,
      site.place,
      site.country,
      site.lat,
      site.lon,
    ]),
    [
      [
        'Důl Bratrství',
        ['deep-geological'],
        false,
        'Jáchymov',
        'Czech Republic',
        50.37444,
        12.94,
      ],
      [
        'Lepse',
        ['repository'],
        true,
        'Sayda Bay',
        'Russia',
        69.26389,
        33.28278,
      ],
    ],
  );
});

test('accidents keep only accident classes, sorted by date, with INES level and deaths', () => {
  const accidents = normalizeNuclearAccidents(
    fixture('wikidata-waste-accidents.json'),
  );
  assert.deepEqual(
    accidents.map((accident) =>
      pickFields(accident, [
        'name',
        'kinds',
        'date',
        'ines',
        'deaths',
        'country',
        'lat',
        'lon',
      ]),
    ),
    [
      {
        name: 'Kyshtym disaster',
        kinds: ['disaster'],
        date: '1957-09-29',
        ines: 6,
        deaths: 200,
        country: 'Soviet Union',
        lat: 55.69364,
        lon: 60.80433,
      },
      {
        name: 'Chernobyl disaster',
        kinds: ['disaster'],
        date: '1986-04-26',
        ines: 7,
        deaths: 4000,
        country: 'Soviet Union',
        lat: 51.38944,
        lon: 30.09917,
      },
      {
        name: 'Goiânia accident',
        kinds: ['accident'],
        date: '1987-09-13',
        ines: null,
        deaths: 4,
        country: 'Brazil',
        lat: -16.6746,
        lon: -49.2641,
      },
    ],
  );
  assert.equal(normalizeNuclearAccidents({ results: {} }), null);
});
