import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UFO_INCIDENTS_META,
  buildUfoCard,
  formatIncidentDate,
  parseUfoSnapshot,
} from './model.js';

const RUWA = {
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
};

test('the layer meta names a green UFO layer sourced from Wikidata', () => {
  assert.deepEqual(
    [
      UFO_INCIDENTS_META.id,
      UFO_INCIDENTS_META.name,
      UFO_INCIDENTS_META.icon,
      UFO_INCIDENTS_META.source,
    ],
    ['ufo-incidents', 'UFO Incidents', '🛸', 'Wikidata'],
  );
  assert.equal(UFO_INCIDENTS_META.selectedSourceId, 'ufo-incidents-selected');
});

test('dates read as a day, or as a bare year when Wikidata only knows the year', () => {
  assert.equal(formatIncidentDate('1994-09-16'), '16 Sep 1994');
  assert.equal(formatIncidentDate('1969-01-01'), '1969');
  assert.equal(formatIncidentDate(null), 'Date unknown');
  assert.equal(formatIncidentDate('garbage'), 'Date unknown');
});

test('a card names the incident, what kind it was, when and where, and links to Wikipedia', () => {
  assert.deepEqual(buildUfoCard(RUWA), {
    title: 'Ruwa UFO incident',
    details: ['Sighting · 16 Sep 1994', 'Ruwa', '1994 sighting in Zimbabwe'],
    url: 'https://en.wikipedia.org/wiki/Ariel_School_UFO_incident',
    accessibilityLabel: 'Open the Wikipedia article on Ruwa UFO incident',
  });
});

test('approximate, unplaced, multi-kind and link-poor incidents still read clearly', () => {
  const card = buildUfoCard({
    ...RUWA,
    name: 'A very long incident name that will not fit on one card line',
    kinds: ['ufo', 'abduction'],
    date: null,
    place: 'Arizona',
    approximate: true,
    description: null,
    wikipedia: null,
  });
  assert.equal(card.title, 'A very long incident name that wi…');
  assert.deepEqual(card.details, [
    'UFO / Abduction claim · Date unknown',
    'Somewhere in Arizona (approximate)',
  ]);
  assert.equal(card.url, 'https://www.wikidata.org/wiki/Q108803795');
  assert.match(
    card.accessibilityLabel,
    /^Open the Wikidata entry on A very long/,
  );

  const bare = buildUfoCard({
    ...RUWA,
    kinds: [],
    place: null,
    lat: 39.75,
    lon: -118.626,
  });
  assert.deepEqual(bare.details.slice(0, 2), [
    'Incident · 16 Sep 1994',
    '39.75°N 118.63°W',
  ]);
});

test('a bundled snapshot becomes catalog records; a broken one is refused', () => {
  const parsed = parseUfoSnapshot({
    source: 'Wikidata',
    license: 'CC0-1.0',
    incidents: [RUWA, { ...RUWA, id: 'Q1', lat: 'north' }, { id: 'Q2' }],
  });
  assert.equal(parsed.stale, false);
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].id, 'Q108803795');
  assert.equal(parsed.records[0].lat, -17.86352);
  assert.equal(parsed.records[0].name, 'Ruwa UFO incident');
  assert.equal(parseUfoSnapshot({ incidents: 'nope' }), null);
  assert.equal(parseUfoSnapshot(null), null);
});
