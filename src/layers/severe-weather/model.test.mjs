import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LayerPanel, layerFeedState } from '../../ui/layerPanel.js';
import { simplifyGeometry } from '../../../server/providers/severe-weather/geometry.js';
import { normalizeNwsAlerts } from '../../../server/providers/severe-weather/nws.js';
import {
  attachCycloneShapes,
  normalizeGdacsCycloneShapes,
  normalizeGdacsEvents,
} from '../../../server/providers/severe-weather/gdacs.js';
import {
  CARD_LINE_MAX,
  GDACS_ALERT_COLORS,
  NWS_CATEGORY_COLORS,
  buildGdacsCard,
  buildNwsAreas,
  buildNwsCard,
  buildStats,
  capAreasToBudget,
  clampLine,
  forecastPageUrl,
  formatAlertTime,
  formatAlertWindow,
  formatGdacsDates,
  nwsAlertRank,
  nwsCategory,
  parseSevereWeatherPayload,
} from './model.js';

const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../../data/fixtures/severe-weather/${name}`, import.meta.url),
      'utf8',
    ),
  );

/** The proxy body for the recorded fixtures, built with the proxy's own normalizers. */
function fixturePayload() {
  const nws = normalizeNwsAlerts(fixture('nws-alerts-active.json'));
  const zones = Object.fromEntries(
    Object.entries(fixture('nws-zones.json')).map(([key, zone]) => [
      key,
      simplifyGeometry(zone.geometry),
    ]),
  );
  const events = attachCycloneShapes(
    normalizeGdacsEvents(fixture('gdacs-events4app.json')),
    normalizeGdacsCycloneShapes(fixture('gdacs-map-tc.json')),
  );
  return {
    generatedAt: 1,
    nws: {
      status: 'ok',
      updatedAt: nws.updatedAt,
      alerts: nws.alerts,
      zones,
      unmappedAlerts: 0,
    },
    gdacs: { status: 'ok', updatedAt: 1, events },
  };
}

const panel = { _timeAgo: LayerPanel.prototype._timeAgo };
const rowText = (stats) =>
  LayerPanel.prototype._buildMetaText.call(panel, {
    stats,
    enabled: true,
    lifecycleState: 'enabled',
    source: 'NWS · GDACS',
  });

test('NWS events map to warning, watch, advisory, statement and emergency colours and ranks', () => {
  assert.equal(nwsCategory('Tornado Warning'), 'warning');
  assert.equal(nwsCategory('Flood Watch'), 'watch');
  assert.equal(nwsCategory('Heat Advisory'), 'advisory');
  assert.equal(nwsCategory('Special Weather Statement'), 'statement');
  assert.equal(nwsCategory('Hydrologic Outlook'), 'statement');
  assert.equal(nwsCategory('Civil Emergency Message'), 'emergency');
  assert.deepEqual(NWS_CATEGORY_COLORS, {
    emergency: '#ff2d95',
    warning: '#ff3b30',
    watch: '#ff9500',
    advisory: '#ffcc00',
    statement: '#5ac8fa',
  });
  assert.deepEqual(GDACS_ALERT_COLORS, {
    Green: '#34c759',
    Orange: '#ff9500',
    Red: '#ff3b30',
  });
  assert.equal(nwsAlertRank({ event: 'Flood Watch', severity: 'Severe' }), 33);
  assert.ok(
    nwsAlertRank({ event: 'Red Flag Warning', severity: 'Minor' }) >
      nwsAlertRank({ event: 'Flood Watch', severity: 'Extreme' }),
  );
});

test('the payload parser keeps usable alerts and events and defaults missing shapes', () => {
  assert.equal(parseSevereWeatherPayload(null), null);
  assert.equal(parseSevereWeatherPayload({ nws: { alerts: [] } }), null);
  const parsed = parseSevereWeatherPayload({
    nws: {
      status: 'weird',
      alerts: [{ id: 'a', event: 'Heat Advisory' }, { id: 7 }],
      zones: null,
      unmappedAlerts: 2,
    },
    gdacs: {
      status: 'stale',
      events: [
        { id: 'FL-1', lon: 1, lat: 2 },
        { id: 'FL-2', lon: 'x', lat: 2 },
      ],
    },
  });
  assert.deepEqual(parsed, {
    nws: {
      status: 'unavailable',
      alerts: [{ id: 'a', event: 'Heat Advisory' }],
      zones: {},
      unmappedAlerts: 2,
    },
    gdacs: {
      status: 'stale',
      events: [{ id: 'FL-1', lon: 1, lat: 2, track: [], cone: [] }],
    },
  });
});

test('a zone shared by several alerts is one area coloured by its highest-ranked alert', () => {
  const payload = parseSevereWeatherPayload(fixturePayload());
  const areas = buildNwsAreas(payload.nws);
  assert.deepEqual(
    areas.map((area) => area.key),
    [
      'alert:urn:oid:2.49.0.1.840.0.a8cf6ef01a03c20165689da85615d4de7004b983.001.1',
      'zone:forecast/AKZ830',
      'zone:forecast/AKZ851',
      'zone:forecast/AKZ852',
      'zone:forecast/OKZ068',
      'zone:forecast/AKZ843',
      'zone:forecast/AKZ844',
      'zone:fire/NEZ434',
      'zone:fire/NEZ435',
      'zone:fire/NEZ436',
    ],
  );
  const fairbanks = areas.find((area) => area.key === 'zone:forecast/AKZ844');
  assert.deepEqual(
    fairbanks.alerts.map((alert) => alert.event),
    ['Flood Watch', 'Dense Fog Advisory'],
  );
  assert.equal(fairbanks.color, '#ff9500');
  assert.equal(areas[0].color, '#5ac8fa');
  assert.equal(areas.at(-1).color, '#ff3b30');
  assert.deepEqual(
    buildNwsAreas({
      alerts: [{ id: 'x', event: 'Wind Advisory', zones: ['forecast/NOPE'] }],
      zones: {},
    }),
    [],
    'a zone without a shape draws nothing',
  );
});

test('the position budget keeps the highest-ranked areas', () => {
  const square = [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ],
  ];
  const areas = ['low', 'mid', 'high'].map((key) => ({
    key,
    polygons: [square],
  }));
  assert.deepEqual(capAreasToBudget(areas, 10), {
    areas: [areas[1], areas[2]],
    dropped: 1,
  });
  assert.deepEqual(capAreasToBudget(areas, 100), { areas, dropped: 0 });
});

test('alert times read in the offset NWS wrote, from onset to the end of the hazard', () => {
  assert.deepEqual(formatAlertTime('2026-09-15T12:00:00-08:00'), {
    text: 'Sep 15 12:00',
    offset: 'UTC−8',
  });
  assert.deepEqual(formatAlertTime('2026-01-02T03:04:00+05:30'), {
    text: 'Jan 2 03:04',
    offset: 'UTC+5:30',
  });
  assert.deepEqual(formatAlertTime('2026-09-14T16:03:09+00:00'), {
    text: 'Sep 14 16:03',
    offset: 'UTC',
  });
  assert.equal(formatAlertTime('soon'), null);
  assert.equal(
    formatAlertWindow({
      onset: '2026-09-15T12:00:00-08:00',
      ends: '2026-09-19T16:00:00-08:00',
      expires: '2026-09-14T16:00:00-08:00',
    }),
    'Sep 15 12:00 – Sep 19 16:00 UTC−8',
    'ends, not the message expiry',
  );
  assert.equal(
    formatAlertWindow({
      onset: '2026-09-14T10:33:00-05:00',
      ends: null,
      expires: '2026-09-14T11:15:00-05:00',
    }),
    'Sep 14 10:33 – Sep 14 11:15 UTC−5',
  );
  assert.equal(
    formatAlertWindow({
      onset: '2026-09-14T10:33:00-05:00',
      ends: '2026-09-14T12:00:00-04:00',
    }),
    'Sep 14 10:33 UTC−5 – Sep 14 12:00 UTC−4',
  );
  assert.equal(
    formatAlertWindow({ onset: '2026-09-15T12:00:00-08:00' }),
    'From Sep 15 12:00 UTC−8',
  );
  assert.equal(
    formatAlertWindow({ expires: '2026-09-15T12:00:00-08:00' }),
    'Until Sep 15 12:00 UTC−8',
  );
  assert.equal(formatAlertWindow({}), null);
});

test('the NWS card shows event, headline, severity, urgency, certainty, times, area and the forecast link', () => {
  const areas = buildNwsAreas(parseSevereWeatherPayload(fixturePayload()).nws);
  const card = buildNwsCard(
    areas.find((area) => area.key === 'zone:forecast/AKZ844'),
    { lat: 64.8378, lon: -147.7164 },
  );
  assert.equal(card.title, 'Flood Watch');
  assert.deepEqual(card.details, [
    'Severe · Future · Possible',
    'Sep 15 12:00 – Sep 19 16:00 UTC−8',
    'Two Rivers; Fairbanks Metro Area',
    clampLine(
      'Flood Watch issued September 13 at 1:21PM AKDT until September 19 at 4:00PM AKDT by NWS Fairbanks AK',
    ),
    '+1 more: Dense Fog Advisory',
    'Open weather.gov forecast',
  ]);
  for (const line of card.details)
    assert.ok(line.length <= CARD_LINE_MAX, line);
  assert.ok(card.details[3].endsWith('…'));
  assert.equal(card.accent, '#ff9500');
  assert.equal(
    card.link,
    'https://forecast.weather.gov/MapClick.php?lat=64.8378&lon=-147.7164',
  );
  assert.equal(
    forecastPageUrl(1.5, -2),
    'https://forecast.weather.gov/MapClick.php?lat=1.5000&lon=-2.0000',
  );
  assert.equal(card.source, 'NWS');
  assert.deepEqual(card.properties.otherAlerts, ['Dense Fog Advisory']);
});

test('the GDACS card shows type, name, alert level, UTC dates and the report link', () => {
  const events = parseSevereWeatherPayload(fixturePayload()).gdacs.events;
  const card = buildGdacsCard(
    events.find((event) => event.id === 'DR-1018431'),
  );
  assert.deepEqual(card, {
    title: 'Drought in Madagascar',
    details: [
      'Orange alert · Drought',
      'Nov 21, 2025 – Sep 14, 2026 UTC',
      'Madagascar',
      'Open GDACS report',
    ],
    accent: '#ff9500',
    link: 'https://www.gdacs.org/report.aspx?eventid=1018431&episodeid=14&eventtype=DR',
    source: 'GDACS',
    label: 'Drought in Madagascar',
    properties: {
      type: 'Drought',
      alertLevel: 'Orange',
      country: 'Madagascar',
      fromDate: Date.UTC(2025, 10, 21),
      toDate: Date.UTC(2026, 8, 14, 14, 38, 32),
      reportUrl:
        'https://www.gdacs.org/report.aspx?eventid=1018431&episodeid=14&eventtype=DR',
    },
  });
  const brazil = buildGdacsCard(
    events.find((event) => event.id === 'DR-1023877'),
  );
  assert.ok(
    brazil.title.length <= CARD_LINE_MAX && brazil.details[2].endsWith('…'),
  );
  const bare = buildGdacsCard({
    ...events[0],
    reportUrl: null,
    fromDate: null,
  });
  assert.equal(bare.link, null);
  assert.equal(bare.details.includes('Open GDACS report'), false);
  assert.equal(
    formatGdacsDates({
      fromDate: Date.UTC(2026, 8, 14),
      toDate: Date.UTC(2026, 8, 14, 5),
    }),
    'Sep 14, 2026 UTC',
  );
  assert.equal(formatGdacsDates({}), null);
});

test('layer row text for every source state, as the Layers panel renders it', () => {
  const payload = parseSevereWeatherPayload(fixturePayload());
  const lastUpdate = Date.now() - 120_000;
  const ok = buildStats({ payload, lastUpdate });
  assert.deepEqual(ok, {
    status: 'ok',
    source: 'NWS 6 · GDACS 6',
    count: 12,
    lastUpdate,
  });
  assert.equal(rowText(ok), 'NWS 6 · GDACS 6 · 2m ago');
  assert.equal(layerFeedState(ok), 'nominal');

  const gdacsDown = buildStats({
    payload: { ...payload, gdacs: { status: 'unavailable', events: [] } },
    lastUpdate,
  });
  assert.equal(rowText(gdacsDown), 'NWS 6 · GDACS unavailable · 2m ago');
  assert.equal(layerFeedState(gdacsDown), 'degraded');
  assert.equal(
    gdacsDown.error,
    undefined,
    'one source down is not a failed refresh',
  );

  const nwsStale = buildStats({
    payload: { ...payload, nws: { ...payload.nws, status: 'stale' } },
    lastUpdate,
  });
  assert.equal(rowText(nwsStale), 'STALE · NWS 6 (stale) · GDACS 6 · 2m ago');

  const notes = buildStats({
    payload: { ...payload, nws: { ...payload.nws, unmappedAlerts: 2 } },
    lastUpdate,
    droppedAreas: 1,
  });
  assert.equal(
    rowText(notes),
    'NWS 6 (2 unmapped, 1 hidden) · GDACS 6 · 2m ago',
  );

  const refreshFailed = buildStats({ payload, lastUpdate, error: 'HTTP 502' });
  assert.equal(
    rowText(refreshFailed),
    'STALE · NWS 6 · GDACS 6 · Severe weather refresh failed',
  );

  const nothing = buildStats({ payload: null, error: 'HTTP 502' });
  assert.equal(
    rowText(nothing),
    'UNAVAILABLE · NWS · GDACS · Severe weather sources unavailable',
  );
  assert.equal(rowText(buildStats({ payload: null })), 'NWS · GDACS · never');
});
