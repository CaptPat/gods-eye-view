import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CARD_LOADING,
  STATION_LAYERS,
  UNITS_STORAGE_KEY,
  buildCurrentCard,
  buildPendingCard,
  buildTideCard,
  cardinal,
  formatDepth,
  formatHeight,
  formatSpeed,
  formatStationTime,
  noaaStationUrl,
  normalizeUnits,
  parseStationsPayload,
  stationTitle,
} from './model.js';
import {
  normalizeCurrents,
  normalizeHilo,
  normalizeWaterLevel,
  predictionAt,
} from '../../../server/providers/tides/normalize.js';

const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../../data/fixtures/tides-currents/${name}`, import.meta.url),
      'utf8',
    ),
  );
const T0 = Date.UTC(2026, 8, 14, 16, 10);
const PROVIDENCE = {
  id: '8454000',
  name: 'Providence',
  lat: 41.80717,
  lon: -71.40067,
  timeZone: 'America/New_York',
  greatLakes: false,
};
const BUFFALO = {
  id: '9063020',
  name: 'Buffalo',
  lat: 42.87739,
  lon: -78.89037,
  timeZone: 'America/New_York',
  greatLakes: true,
};
const POLLOCK_RIP = {
  id: 'ACT1616',
  name: 'Pollock Rip Channel (Butler Hole)',
  lat: 41.55,
  lon: -69.9833,
  timeZone: 'America/New_York',
  bins: [1],
};

function tideReport() {
  const observed = normalizeWaterLevel(
    fixture('datagetter-water-level-8454000.json'),
  );
  return {
    id: '8454000',
    kind: 'tide',
    datum: 'MLLW',
    generatedAt: T0,
    sources: { predictions: 'ok', observed: 'ok' },
    predictions: normalizeHilo(fixture('datagetter-hilo-8454000.json')),
    observed: {
      ...observed,
      predictedM: predictionAt(
        fixture('datagetter-predictions-latest-8454000.json'),
        observed.time,
      ),
    },
  };
}

function currentReport() {
  return {
    id: 'ACT1616',
    kind: 'current',
    bin: 1,
    generatedAt: T0,
    sources: { predictions: 'ok' },
    ...normalizeCurrents(fixture('datagetter-currents-ACT1616-bin1.json')),
  };
}

test('layer identities, units preference and formatting helpers', () => {
  assert.deepEqual(
    Object.values(STATION_LAYERS).map(({ id, name, selectedSourceId }) => [
      id,
      name,
      selectedSourceId,
    ]),
    [
      ['tide-stations', 'Tide Stations', 'tide-stations-selected'],
      ['current-stations', 'Current Stations', 'current-stations-selected'],
    ],
  );
  assert.equal(UNITS_STORAGE_KEY, 'gev.weatherReport.units');
  assert.equal(normalizeUnits('metric'), 'metric');
  assert.equal(normalizeUnits(null), 'imperial');
  assert.equal(cardinal(37), 'NE');
  assert.equal(cardinal(226), 'SW');
  assert.equal(cardinal(null), '');
  assert.equal(formatHeight(1.474, 'imperial'), '4.8 ft');
  assert.equal(formatHeight(1.474, 'metric'), '1.47 m');
  assert.equal(formatSpeed(1.042, 'imperial'), '2.0 kn');
  assert.equal(formatSpeed(1.042, 'metric'), '1.04 m/s');
  assert.equal(formatDepth(4.6, 'imperial'), '15 ft');
  assert.equal(formatDepth(4.6, 'metric'), '4.6 m');
  assert.equal(formatHeight(null, 'metric'), '—');
});

test('station times read in the station zone, falling back to UTC', () => {
  assert.equal(
    formatStationTime(Date.UTC(2026, 8, 14, 20, 11), 'America/New_York'),
    'Mon 16:11 EDT',
  );
  assert.equal(
    formatStationTime(Date.UTC(2026, 8, 14, 20, 11), 'Pacific/Honolulu'),
    'Mon 10:11 HST',
  );
  assert.equal(
    formatStationTime(Date.UTC(2026, 8, 14, 20, 11), null),
    'Mon 20:11 UTC',
  );
  assert.equal(
    formatStationTime(Date.UTC(2026, 8, 14, 20, 11), 'Not/AZone'),
    'Mon 20:11 UTC',
  );
});

test('station list payloads are validated per kind', () => {
  const parsed = parseStationsPayload(
    {
      kind: 'current',
      stale: true,
      stations: [
        {
          id: 'ACT1616',
          name: 'Pollock Rip Channel (Butler Hole)',
          lat: 41.55,
          lon: -69.9833,
          bins: [1],
          timeZone: 'America/New_York',
        },
        { id: 'NOBINS', name: 'x', lat: 1, lon: 1, bins: [] },
        { id: '', lat: 1, lon: 1, bins: [1] },
        { id: 'BAD', lat: 'x', lon: 1, bins: [1] },
      ],
    },
    'current',
  );
  assert.deepEqual(parsed, { stale: true, stations: [POLLOCK_RIP] });
  assert.equal(
    parseStationsPayload({ kind: 'tide', stations: [] }, 'current'),
    null,
  );
  assert.deepEqual(
    parseStationsPayload(
      { kind: 'tide', stations: [{ ...PROVIDENCE, greatLakes: 'yes' }] },
      'tide',
    ).stations[0].greatLakes,
    false,
  );
});

test('NOAA links and card titles', () => {
  assert.equal(
    noaaStationUrl('tide', '8454000'),
    'https://tidesandcurrents.noaa.gov/stationhome.html?id=8454000',
  );
  assert.equal(
    noaaStationUrl('current', 'ACT1616', 1),
    'https://tidesandcurrents.noaa.gov/noaacurrents/predictions?id=ACT1616_1',
  );
  assert.equal(stationTitle(PROVIDENCE), 'Providence · 8454000');
  assert.equal(
    stationTitle(POLLOCK_RIP),
    'Pollock Rip Channel (Butler H… · ACT1616',
  );
  assert.deepEqual(buildPendingCard(PROVIDENCE, CARD_LOADING), {
    title: 'Providence · 8454000',
    details: ['Loading NOAA CO-OPS…'],
  });
});

test('a tide card lists the next four highs and lows and the observation against its prediction', () => {
  assert.deepEqual(
    buildTideCard(PROVIDENCE, tideReport(), { units: 'imperial', now: T0 }),
    {
      title: 'Providence · 8454000',
      details: [
        'Low 0.4 ft · Mon 16:11 EDT',
        'High 4.4 ft · Mon 23:19 EDT',
        'Low 0.3 ft · Tue 04:18 EDT',
        'High 4.8 ft · Tue 11:45 EDT',
        'Obs 4.8 ft vs pred 4.7 ft · Mon 12:06 EDT',
        'Datum MLLW · click card for NOAA page',
      ],
    },
  );
  const metric = buildTideCard(PROVIDENCE, tideReport(), {
    units: 'metric',
    now: T0,
  }).details;
  assert.equal(metric[0], 'Low 0.12 m · Mon 16:11 EDT');
  assert.equal(metric[4], 'Obs 1.47 m vs pred 1.43 m · Mon 12:06 EDT');
});

test('tide cards report Great Lakes, missing predictions and missing observations honestly', () => {
  const greatLakes = {
    id: '9063020',
    kind: 'tide',
    datum: 'IGLD',
    generatedAt: T0,
    sources: { predictions: 'none', observed: 'ok' },
    predictions: null,
    observed: {
      time: Date.UTC(2026, 8, 14, 16, 6),
      heightM: 174.372,
      predictedM: null,
    },
  };
  assert.deepEqual(
    buildTideCard(BUFFALO, greatLakes, { units: 'metric', now: T0 }).details,
    [
      'Great Lakes: no tide predictions',
      'Obs 174.37 m · Mon 12:06 EDT',
      'Datum IGLD · click card for NOAA page',
    ],
  );
  const partial = {
    ...tideReport(),
    sources: { predictions: 'unavailable', observed: 'unavailable' },
    predictions: null,
    observed: null,
  };
  assert.deepEqual(
    buildTideCard(PROVIDENCE, partial, { units: 'imperial', now: T0 }).details,
    [
      'Tide predictions unavailable',
      'Latest observation unavailable',
      'Datum MLLW · click card for NOAA page',
    ],
  );
  const late = buildTideCard(PROVIDENCE, tideReport(), {
    units: 'imperial',
    now: Date.UTC(2026, 8, 20),
  }).details;
  assert.equal(late[0], 'No upcoming tides in range');
});

test('a current card shows the next flood and ebb with direction, the next slack and the bin depth', () => {
  assert.deepEqual(
    buildCurrentCard(POLLOCK_RIP, currentReport(), {
      units: 'imperial',
      now: T0,
    }),
    {
      title: 'Pollock Rip Channel (Butler H… · ACT1616',
      details: [
        'Bin 1 · depth 15 ft',
        'Flood 2.0 kn NE (37°) · Mon 21:45 EDT',
        'Ebb 1.8 kn SW (226°) · Mon 15:12 EDT',
        'Slack · Mon 12:27 EDT',
        'Click card for NOAA predictions',
      ],
    },
  );
  const metric = buildCurrentCard(
    { ...POLLOCK_RIP, bins: [1, 12, 23] },
    currentReport(),
    { units: 'metric', now: T0 },
  ).details;
  assert.equal(metric[0], 'Bin 1 · depth 4.6 m · 3 bins');
  assert.equal(metric[1], 'Flood 1.04 m/s NE (37°) · Mon 21:45 EDT');
  const failed = {
    id: 'ACT1616',
    kind: 'current',
    bin: 1,
    generatedAt: T0,
    sources: { predictions: 'unavailable' },
    depthM: null,
    floodDirDeg: null,
    ebbDirDeg: null,
    events: null,
  };
  assert.deepEqual(
    buildCurrentCard(POLLOCK_RIP, failed, { units: 'imperial', now: T0 })
      .details,
    [
      'Bin 1',
      'Current predictions unavailable',
      'Click card for NOAA predictions',
    ],
  );
});

test('a missing flow direction omits the parenthetical instead of showing (0°)', () => {
  const noDirection = {
    ...currentReport(),
    floodDirDeg: null,
    ebbDirDeg: undefined,
  };
  const details = buildCurrentCard(POLLOCK_RIP, noDirection, {
    units: 'imperial',
    now: T0,
  }).details;
  assert.equal(details[1], 'Flood 2.0 kn · Mon 21:45 EDT');
  assert.equal(details[2], 'Ebb 1.8 kn · Mon 15:12 EDT');
});
