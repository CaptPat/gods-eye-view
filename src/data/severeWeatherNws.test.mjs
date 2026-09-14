import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SIMPLIFY_TOLERANCE_DEG,
  countPositions,
  simplifyGeometry,
  simplifyRing,
} from '../../server/providers/severe-weather/geometry.js';
import {
  isZoneKey,
  normalizeNwsAlerts,
  zoneKeyFromUrl,
  zoneUrl,
} from '../../server/providers/severe-weather/nws.js';

const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`./fixtures/severe-weather/${name}`, import.meta.url),
      'utf8',
    ),
  );

test('zone keys come only from api.weather.gov forecast, county and fire zone URLs', () => {
  assert.equal(
    zoneKeyFromUrl('https://api.weather.gov/zones/forecast/AKZ844'),
    'forecast/AKZ844',
  );
  assert.equal(
    zoneKeyFromUrl('https://api.weather.gov/zones/county/MDC031'),
    'county/MDC031',
  );
  assert.equal(
    zoneKeyFromUrl('https://api.weather.gov/zones/fire/NEZ434'),
    'fire/NEZ434',
  );
  for (const bad of [
    'https://api.weather.gov/zones/forecast/../x',
    'https://evil.example/zones/forecast/AKZ844',
    'https://api.weather.gov/zones/offshore/AKZ844',
    'https://api.weather.gov/zones/forecast/akz844',
    null,
  ]) {
    assert.equal(zoneKeyFromUrl(bad), null, String(bad));
  }
  assert.equal(isZoneKey('fire/NEZ434'), true);
  assert.equal(isZoneKey('fire/NEZ434/x'), false);
  assert.equal(
    zoneUrl('forecast/AKZ844'),
    'https://api.weather.gov/zones/forecast/AKZ844',
  );
});

test('rings are simplified within the tolerance, rounded to 4 decimals, and stay closed', () => {
  assert.equal(SIMPLIFY_TOLERANCE_DEG, 0.01);
  const ring = [
    [0, 0],
    [0.5, 0.004],
    [1, 0],
    [1, 1],
    [0.5, 1.3],
    [0, 1],
    [0.000001, 0.0000004],
    [0, 0],
  ];
  assert.deepEqual(
    simplifyRing(ring),
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0.5, 1.3],
      [0, 1],
      [0, 0],
    ],
    'a 0.004° bump goes, a 0.3° bump stays',
  );
  assert.deepEqual(
    simplifyRing([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]),
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ],
    'an open ring is closed',
  );
  assert.equal(
    simplifyRing([
      [0, 0],
      [0.001, 0],
      [0, 0.001],
      [0, 0],
    ]),
    null,
    'a sliver below the tolerance collapses',
  );
  assert.equal(
    simplifyRing([
      [0, 0],
      [1, 0],
      [0, 0],
    ]),
    null,
  );
  assert.deepEqual(
    simplifyRing([
      [10.123456, 20.987654],
      [11, 20],
      [11, 21],
      [10.123456, 20.987654],
    ])[0],
    [10.1235, 20.9877],
  );
});

test('real zone geometry shrinks under simplification and every ring stays valid', () => {
  const zones = fixture('nws-zones.json');
  let raw = 0;
  let simplified = 0;
  for (const [key, zone] of Object.entries(zones)) {
    const polygons = simplifyGeometry(zone.geometry);
    assert.ok(polygons.length > 0, key);
    for (const polygon of polygons) {
      for (const ring of polygon) {
        assert.ok(ring.length >= 4, key);
        assert.deepEqual(ring[0], ring.at(-1), `${key} ring closed`);
        for (const [lon, lat] of ring) {
          assert.equal(lon, Math.round(lon * 1e4) / 1e4);
          assert.equal(lat, Math.round(lat * 1e4) / 1e4);
        }
      }
    }
    raw += zone.geometry.coordinates.flat().length;
    simplified += countPositions(polygons);
  }
  assert.equal(raw, 605);
  assert.ok(simplified < raw, `${simplified} < ${raw}`);
  const akz843 = zones['forecast/AKZ843'].geometry;
  assert.deepEqual(
    simplifyGeometry({
      type: 'GeometryCollection',
      geometries: [akz843, { type: 'Point', coordinates: [0, 0] }],
    }),
    simplifyGeometry(akz843),
  );
  assert.deepEqual(
    simplifyGeometry({
      type: 'MultiPolygon',
      coordinates: [akz843.coordinates],
    }),
    simplifyGeometry(akz843),
  );
  assert.deepEqual(simplifyGeometry(null), []);
});

test('active alerts keep Actual messages with their own polygons or zone keys', () => {
  const result = normalizeNwsAlerts(fixture('nws-alerts-active.json'));
  assert.equal(result.updatedAt, Date.parse('2026-09-14T16:05:29+00:00'));
  assert.deepEqual(
    result.alerts.map((alert) => alert.event),
    [
      'Flood Watch',
      'Dense Fog Advisory',
      'Wind Advisory',
      'Special Weather Statement',
      'Red Flag Warning',
      'Heat Advisory',
    ],
    'the Test Message is dropped',
  );
  assert.deepEqual(result.alerts[0], {
    id: 'urn:oid:2.49.0.1.840.0.72c6ec33bfeaa6b7c7b00e6f14f58fc54f222fe4.001.1',
    event: 'Flood Watch',
    headline:
      'Flood Watch issued September 13 at 1:21PM AKDT until September 19 at 4:00PM AKDT by NWS Fairbanks AK',
    severity: 'Severe',
    urgency: 'Future',
    certainty: 'Possible',
    onset: '2026-09-15T12:00:00-08:00',
    ends: '2026-09-19T16:00:00-08:00',
    expires: '2026-09-14T16:00:00-08:00',
    areaDesc: 'Two Rivers; Fairbanks Metro Area',
    senderName: 'NWS Fairbanks AK',
    zones: ['forecast/AKZ843', 'forecast/AKZ844'],
    polygons: null,
  });
  const statement = result.alerts[3];
  assert.deepEqual(
    statement.zones,
    [],
    'an alert with its own polygon needs no zones',
  );
  assert.equal(statement.polygons.length, 1);
  assert.equal(statement.ends, null);
  assert.deepEqual(result.alerts[4].zones, [
    'fire/NEZ434',
    'fire/NEZ435',
    'fire/NEZ436',
  ]);
  assert.equal(normalizeNwsAlerts({}), null);
  assert.deepEqual(
    normalizeNwsAlerts({
      features: [
        {
          properties: {
            status: 'Actual',
            id: 'x',
            event: 'Tornado Warning',
            severity: 'Apocalyptic',
            onset: 'soon',
            affectedZones: ['https://api.weather.gov/zones/forecast/../../x'],
          },
        },
      ],
    }).alerts[0],
    {
      id: 'x',
      event: 'Tornado Warning',
      headline: null,
      severity: 'Unknown',
      urgency: 'Unknown',
      certainty: 'Unknown',
      onset: null,
      ends: null,
      expires: null,
      areaDesc: null,
      senderName: null,
      zones: [],
      polygons: null,
    },
  );
});
