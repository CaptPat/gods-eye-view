import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AIRPORTS_META,
  buildAirportCard,
  parseAirportSnapshot,
} from './model.js';
import { AIRPORT_FIELDS } from './source.js';

const JFK = {
  id: 'KJFK',
  size: 'large',
  name: 'John F. Kennedy International Airport',
  icao: 'KJFK',
  iata: 'JFK',
  lat: 40.6394,
  lon: -73.7793,
  elevationFt: 13,
  city: 'New York',
  country: 'US',
  scheduled: true,
  wikipedia:
    'https://en.wikipedia.org/wiki/John_F._Kennedy_International_Airport',
};

test('the layer meta names an Airports layer from OurAirports', () => {
  assert.deepEqual(
    [
      AIRPORTS_META.id,
      AIRPORTS_META.name,
      AIRPORTS_META.icon,
      AIRPORTS_META.source,
    ],
    ['airports', 'Airports', '✈️', 'OurAirports'],
  );
});

test('a card gives ICAO and IATA codes, size and service, place and elevation, linking to Wikipedia', () => {
  assert.deepEqual(buildAirportCard(JFK), {
    title: 'John F. Kennedy International Air…',
    details: [
      'ICAO KJFK · IATA JFK',
      'Large airport · scheduled service',
      'New York, US · 13 ft',
    ],
    url: 'https://en.wikipedia.org/wiki/John_F._Kennedy_International_Airport',
    accessibilityLabel:
      'Open the Wikipedia article on John F. Kennedy International Airport',
  });
});

test('an airport without an IATA code or article still reads clearly and links to OurAirports', () => {
  assert.deepEqual(
    buildAirportCard({
      ...JFK,
      id: 'AE-0221',
      size: 'medium',
      name: 'Sas Al Nakheel Air Base',
      icao: 'OMNK',
      iata: null,
      elevationFt: 14,
      city: 'Sas Al Nakheel',
      country: 'AE',
      scheduled: false,
      wikipedia: null,
    }),
    {
      title: 'Sas Al Nakheel Air Base',
      details: ['ICAO OMNK', 'Medium airport', 'Sas Al Nakheel, AE · 14 ft'],
      url: 'https://ourairports.com/airports/AE-0221/',
      accessibilityLabel:
        'Open the OurAirports page for Sas Al Nakheel Air Base',
    },
  );
  assert.deepEqual(
    buildAirportCard({
      ...JFK,
      icao: null,
      iata: null,
      city: null,
      elevationFt: null,
    }).details,
    ['No ICAO or IATA code', 'Large airport · scheduled service', 'US'],
  );
});

test('snapshot rows become records styled by size; mismatched fields are refused', () => {
  const parsed = parseAirportSnapshot({
    fields: AIRPORT_FIELDS,
    rows: [
      [
        'KJFK',
        'large',
        JFK.name,
        'KJFK',
        'JFK',
        40.6394,
        -73.7793,
        13,
        'New York',
        'US',
        true,
        JFK.wikipedia,
      ],
      [
        'AGGM',
        'medium',
        'Munda Airport',
        'AGGM',
        'MUA',
        -8.328,
        157.263,
        10,
        'Munda',
        'SB',
        true,
        null,
      ],
      [
        'BAD',
        'large',
        'Nowhere',
        null,
        null,
        91,
        0,
        null,
        null,
        'XX',
        false,
        null,
      ],
    ],
  });
  assert.equal(parsed.stale, false);
  assert.deepEqual(parsed.records[0], {
    ...JFK,
    color: '#ffffff',
    pixelSize: 7,
  });
  assert.equal(parsed.records[1].color, '#9ec5ff');
  assert.equal(parsed.records[1].pixelSize, 5);
  assert.equal(parsed.records.length, 2);
  assert.equal(parseAirportSnapshot({ fields: ['id'], rows: [] }), null);
});
