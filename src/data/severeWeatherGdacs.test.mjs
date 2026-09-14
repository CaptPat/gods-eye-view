import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GDACS_CYCLONES_URL,
  GDACS_EVENTS_URL,
  attachCycloneShapes,
  joinTrackSegments,
  normalizeGdacsCycloneShapes,
  normalizeGdacsEvents,
  parseGdacsDate,
} from '../../server/providers/severe-weather/gdacs.js';

const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`./fixtures/severe-weather/${name}`, import.meta.url),
      'utf8',
    ),
  );

test('the GDACS endpoints are the app event list and the cyclone map', () => {
  assert.equal(
    GDACS_EVENTS_URL,
    'https://www.gdacs.org/gdacsapi/api/events/geteventlist/EVENTS4APP',
  );
  assert.equal(
    GDACS_CYCLONES_URL,
    'https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP?eventtype=TC',
  );
  assert.equal(
    parseGdacsDate('2026-09-14T14:38:32'),
    Date.UTC(2026, 8, 14, 14, 38, 32),
  );
  assert.equal(parseGdacsDate('2026-09-14'), null);
  assert.equal(parseGdacsDate(null), null);
});

test('GDACS events exclude earthquakes and carry UTC dates, alert level and the report link', () => {
  const events = normalizeGdacsEvents(fixture('gdacs-events4app.json'));
  assert.deepEqual(
    events.map((event) => event.id),
    [
      'TC-1001320',
      'TC-1001321',
      'FL-1103888',
      'DR-1023877',
      'DR-1018431',
      'WF-1031964',
    ],
  );
  assert.deepEqual(events[4], {
    id: 'DR-1018431',
    type: 'DR',
    typeName: 'Drought',
    eventId: 1018431,
    name: 'Drought in Madagascar',
    alertLevel: 'Orange',
    country: 'Madagascar',
    fromDate: Date.UTC(2025, 10, 21),
    toDate: Date.UTC(2026, 8, 14, 14, 38, 32),
    lon: 47.017,
    lat: -19.34,
    reportUrl:
      'https://www.gdacs.org/report.aspx?eventid=1018431&episodeid=14&eventtype=DR',
    track: [],
    cone: [],
  });
  assert.equal(events[0].country, null, 'an off-shore cyclone has no country');
  assert.equal(normalizeGdacsEvents({ features: 'x' }), null);
  const odd = normalizeGdacsEvents({
    features: [
      {
        geometry: { type: 'Point', coordinates: [1, 2] },
        properties: {
          eventtype: 'VO',
          eventid: 7,
          name: 'Etna',
          alertlevel: 'Purple',
        },
      },
      {
        geometry: { type: 'Point', coordinates: [1, 2] },
        properties: {
          eventtype: 'VO',
          eventid: 8,
          name: 'Etna',
          alertlevel: 'Red',
          fromdate: '2026-09-14',
          url: { report: 'https://evil.example/report' },
        },
      },
      {
        geometry: { type: 'Point', coordinates: [500, 2] },
        properties: { eventtype: 'FL', eventid: 9, alertlevel: 'Red' },
      },
    ],
  });
  assert.deepEqual(
    odd.map((event) => [event.id, event.fromDate, event.reportUrl]),
    [['VO-8', null, null]],
  );
});

test('cyclone tracks are joined across out-of-order segments and cones are simplified', () => {
  const shapes = normalizeGdacsCycloneShapes(fixture('gdacs-map-tc.json'));
  assert.deepEqual([...shapes.keys()], [1001321]);
  const { track, cone } = shapes.get(1001321);
  assert.equal(track.length, 1, 'ten segments form one line');
  assert.equal(track[0].length, 11);
  assert.deepEqual(track[0][0], [-117.2, 17.2]);
  assert.deepEqual(track[0].at(-1), [-137, 15.2]);
  assert.equal(cone.length, 1);
  assert.ok(
    cone[0][0].length >= 4 && cone[0][0].length < 210,
    `${cone[0][0].length} cone positions`,
  );
  assert.deepEqual(
    joinTrackSegments([
      [
        [0, 0],
        [1, 1],
      ],
      [
        [5, 5],
        [6, 6],
      ],
      [
        [-1, -1],
        [0, 0],
      ],
    ]),
    [
      [
        [-1, -1],
        [0, 0],
        [1, 1],
      ],
      [
        [5, 5],
        [6, 6],
      ],
    ],
  );
  const events = attachCycloneShapes(
    normalizeGdacsEvents(fixture('gdacs-events4app.json')),
    shapes,
  );
  assert.equal(events[1].track.length, 1);
  assert.equal(events[1].cone.length, 1);
  assert.deepEqual(
    events[0].track,
    [],
    'NORBERT has no shapes in this fixture',
  );
  assert.equal(normalizeGdacsCycloneShapes(null).size, 0);
});
