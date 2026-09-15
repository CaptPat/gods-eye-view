import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeWikidataUfoIncidents } from './wikidata.js';

const bindings = () =>
  JSON.parse(
    readFileSync(
      new URL(
        '../../data/fixtures/ufo-incidents/wikidata-bindings.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );

test('located incidents keep exact coordinates first, fall back to their place, and sort by date', () => {
  const incidents = normalizeWikidataUfoIncidents(bindings());
  assert.deepEqual(
    incidents.map((incident) => incident.id),
    ['Q111467273', 'Q2940740', 'Q108803795', 'Q5371519'],
    'Flight 105 (1947), Carson Sink (1952), Ruwa (1994), then undated Emilcin',
  );
  assert.deepEqual(incidents[2], {
    id: 'Q108803795',
    name: 'Ruwa UFO incident',
    description: '1994 sighting in Zimbabwe',
    kinds: ['sighting'],
    date: '1994-09-16',
    lat: -17.86352,
    lon: 31.29114,
    place: 'Ruwa',
    approximate: false,
    wikipedia: 'https://en.wikipedia.org/wiki/Ariel_School_UFO_incident',
    wikidata: 'https://www.wikidata.org/wiki/Q108803795',
  });
  assert.deepEqual(
    {
      lat: incidents[0].lat,
      lon: incidents[0].lon,
      place: incidents[0].place,
      approximate: incidents[0].approximate,
    },
    {
      lat: 45.8288,
      lon: -120.32227,
      place: 'Pacific Northwest',
      approximate: true,
    },
  );
  assert.deepEqual(
    [incidents[3].lat, incidents[3].lon, incidents[3].date, incidents[3].kinds],
    [51.13406, 22.03782, null, ['abduction']],
  );
  assert.equal(incidents[1].wikipedia, null);
  assert.equal(incidents[1].description, null);
});

test('several bindings for one item merge kinds; unnamed, unlocated and malformed items are dropped', () => {
  const json = bindings();
  const [ruwa] = json.results.bindings.filter((binding) =>
    binding.item.value.endsWith('/Q108803795'),
  );
  const extra = [
    {
      ...ruwa,
      clsLabel: { type: 'literal', value: 'unidentified flying object' },
    },
    { ...ruwa, clsLabel: { type: 'literal', value: 'close encounter' } },
    {
      item: { type: 'uri', value: 'http://www.wikidata.org/entity/Q1' },
      itemLabel: { type: 'literal', value: 'Q1' },
      coord: { type: 'literal', value: 'Point(10 10)' },
      clsLabel: { type: 'literal', value: 'UFO sighting' },
    },
    {
      item: { type: 'uri', value: 'http://www.wikidata.org/entity/Q2' },
      itemLabel: { type: 'literal', value: 'Off-world coordinates' },
      coord: { type: 'literal', value: 'Point(200 95)' },
      clsLabel: { type: 'literal', value: 'UFO crash' },
    },
    {
      item: { type: 'uri', value: 'http://www.wikidata.org/entity/Q3' },
      itemLabel: { type: 'literal', value: 'Not a point' },
      coord: { type: 'literal', value: 'LINESTRING(1 2, 3 4)' },
      clsLabel: { type: 'literal', value: 'UFO crash' },
    },
    {
      item: { type: 'uri', value: 'http://www.wikidata.org/entity/Q4' },
      itemLabel: { type: 'literal', value: 'Roswell-ish crash' },
      coord: { type: 'literal', value: 'Point(-104.5 33.39)' },
      clsLabel: { type: 'literal', value: 'UFO crash' },
      article: { type: 'uri', value: 'https://fr.wikipedia.org/wiki/Roswell' },
    },
  ];
  json.results.bindings.push(...extra);
  const incidents = normalizeWikidataUfoIncidents(json);
  const ids = incidents.map((incident) => incident.id);
  assert.equal(ids.includes('Q1'), false, 'a bare QID label is not a name');
  assert.equal(ids.includes('Q2'), false, 'out-of-range coordinates');
  assert.equal(ids.includes('Q3'), false, 'not a WKT point');
  assert.equal(ids.filter((id) => id === 'Q108803795').length, 1);
  assert.deepEqual(
    incidents.find((incident) => incident.id === 'Q108803795').kinds,
    ['sighting', 'ufo', 'close-encounter'],
  );
  const crash = incidents.find((incident) => incident.id === 'Q4');
  assert.deepEqual(crash.kinds, ['crash']);
  assert.equal(crash.wikipedia, null, 'only English Wikipedia articles link');
  assert.equal(normalizeWikidataUfoIncidents({ results: {} }), null);
  assert.equal(normalizeWikidataUfoIncidents(null), null);
});
