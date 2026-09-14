import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  APPLICATION_NAME,
  DATAGETTER_URL,
  beginHour,
  currentsUrl,
  hiloUrl,
  latestPredictionUrl,
  nearestTimeZone,
  normalizeCurrentStations,
  normalizeCurrents,
  normalizeHilo,
  normalizeTideStations,
  normalizeWaterLevel,
  parseGmtTime,
  predictionAt,
  stationListUrl,
  tideStationTimeZone,
  upstreamError,
  waterLevelUrl,
} from '../../server/providers/tides/normalize.js';

const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`./fixtures/tides-currents/${name}`, import.meta.url),
      'utf8',
    ),
  );
const NOW = Date.UTC(2026, 8, 14, 16, 10);

/** UTC offset in hours that Intl reports for a zone at an instant. */
function offsetHours(timeZone, ms) {
  const part = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  })
    .formatToParts(ms)
    .find((entry) => entry.type === 'timeZoneName').value;
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(part);
  if (!match) return 0;
  const hours = Number(match[2]) + Number(match[3]) / 60;
  return match[1] === '-' ? -hours : hours;
}

test('station list URLs ask the Metadata API for water-level or current-prediction stations', () => {
  assert.equal(
    stationListUrl('tide'),
    'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=waterlevels',
  );
  assert.equal(
    stationListUrl('current'),
    'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=currentpredictions',
  );
});

test('tide stations keep tidal and Great Lakes stations with an IANA zone, and drop non-tidal ones', () => {
  const stations = normalizeTideStations(fixture('mdapi-waterlevels.json'));
  assert.equal(stations.length, 12);
  assert.equal(
    stations.some((station) => station.id === '8761955'),
    false,
    'non-tidal Carrollton',
  );
  assert.equal(
    stations.some((station) => station.id === '9755968'),
    false,
    'non-tidal Salinas',
  );
  assert.deepEqual(
    stations.find((station) => station.id === '8454000'),
    {
      id: '8454000',
      name: 'Providence',
      lat: 41.80717,
      lon: -71.40067,
      state: 'RI',
      timeZone: 'America/New_York',
      greatLakes: false,
    },
  );
  assert.equal(
    stations.find((station) => station.id === '9063020').greatLakes,
    true,
  );
  assert.deepEqual(
    stations.map((station) => station.id),
    [...stations.map((station) => station.id)].sort(),
  );
  assert.equal(normalizeTideStations({}), null);
});

test('station zones reproduce the lst_ldt offsets measured from CO-OPS on 2026-09-14', () => {
  // lst_ldt minus gmt for each station's latest water level, measured live.
  const measured = {
    8454000: -4,
    9063020: -4,
    8729108: -5,
    9410170: -7,
    9450460: -8,
    9461380: -9,
    1612401: -10,
    1619910: -11,
    1630000: 10,
    1820000: 12,
    2695535: -3,
    9751364: -4,
  };
  const stations = normalizeTideStations(fixture('mdapi-waterlevels.json'));
  for (const station of stations) {
    assert.equal(
      offsetHours(station.timeZone, NOW),
      measured[station.id],
      `${station.id} ${station.timeZone}`,
    );
  }
  assert.equal(tideStationTimeZone('HAST', 'HI'), 'Pacific/Honolulu');
  assert.equal(tideStationTimeZone('HAST', 'AK'), 'America/Adak');
  assert.equal(tideStationTimeZone('AST', 'Bermuda'), 'Atlantic/Bermuda');
  assert.equal(tideStationTimeZone('AST', 'PR'), 'America/Puerto_Rico');
  assert.equal(tideStationTimeZone('MST', 'AZ'), null);
});

test('current stations group bins per id, drop weak-and-variable and bin 0, and borrow the nearest zone', () => {
  const tides = normalizeTideStations(fixture('mdapi-waterlevels.json'));
  const stations = normalizeCurrentStations(
    fixture('mdapi-currentpredictions.json'),
    tides,
  );
  assert.deepEqual(
    stations.map(({ id, bins, timeZone }) => ({ id, bins, timeZone })),
    [
      { id: 'ACT0311', bins: [1, 2], timeZone: 'America/New_York' },
      { id: 'ACT1616', bins: [1], timeZone: 'America/New_York' },
      { id: 'HAI1103', bins: [1, 12, 23], timeZone: 'Pacific/Honolulu' },
      { id: 'PCT0016', bins: [1], timeZone: 'America/Los_Angeles' },
    ],
  );
  const pollockRip = stations.find((station) => station.id === 'ACT1616');
  assert.equal(pollockRip.name, 'Pollock Rip Channel (Butler Hole)');
  assert.equal(pollockRip.lat, 41.55);
  assert.equal(pollockRip.lon, -69.9833);
  assert.equal(nearestTimeZone({ lat: 0, lon: 0 }, []), null);
  assert.equal(normalizeCurrentStations(null, tides), null);
});

test('datagetter URLs request metric GMT JSON over a 72-hour window starting this UTC hour', () => {
  assert.equal(beginHour(NOW), '20260914 16:00');
  const hilo = new URL(hiloUrl('8454000', NOW));
  assert.equal(hilo.origin + hilo.pathname, DATAGETTER_URL);
  assert.deepEqual(Object.fromEntries(hilo.searchParams), {
    product: 'predictions',
    station: '8454000',
    begin_date: '20260914 16:00',
    range: '72',
    datum: 'MLLW',
    interval: 'hilo',
    units: 'metric',
    time_zone: 'gmt',
    format: 'json',
    application: APPLICATION_NAME,
  });
  assert.deepEqual(
    Object.fromEntries(new URL(waterLevelUrl('9063020', 'IGLD')).searchParams),
    {
      product: 'water_level',
      station: '9063020',
      date: 'latest',
      datum: 'IGLD',
      units: 'metric',
      time_zone: 'gmt',
      format: 'json',
      application: APPLICATION_NAME,
    },
  );
  assert.equal(
    new URL(latestPredictionUrl('8454000')).searchParams.get('date'),
    'latest',
  );
  assert.deepEqual(
    Object.fromEntries(new URL(currentsUrl('ACT1616', 1, NOW)).searchParams),
    {
      product: 'currents_predictions',
      station: 'ACT1616',
      bin: '1',
      begin_date: '20260914 16:00',
      range: '72',
      interval: 'MAX_SLACK',
      units: 'metric',
      time_zone: 'gmt',
      format: 'json',
      application: APPLICATION_NAME,
    },
  );
});

test('upstream failures are recognised in all three measured shapes', () => {
  assert.equal(
    upstreamError(fixture('datagetter-hilo-greatlakes-9063020.json')),
    "Great Lakes stations don't have Predictions data.",
  );
  assert.match(
    upstreamError(fixture('datagetter-water-level-nodata-8551910.json')),
    /^No data was found/,
  );
  assert.equal(
    upstreamError(fixture('datagetter-currents-unavailable-ACT5971.json')),
    'Currents predictions are not available from the requested station.',
  );
  assert.equal(
    upstreamError(fixture('datagetter-forbidden.json')),
    'Forbidden',
  );
  assert.equal(upstreamError(fixture('datagetter-hilo-8454000.json')), null);
  assert.equal(upstreamError(null), 'malformed response');
});

test('high and low predictions, the latest observation and its matching prediction normalize to SI and epoch ms', () => {
  assert.equal(parseGmtTime('2026-09-14 16:06'), Date.UTC(2026, 8, 14, 16, 6));
  assert.equal(parseGmtTime('2026-09-14T16:06'), null);
  const hilo = normalizeHilo(fixture('datagetter-hilo-8454000.json'));
  assert.equal(hilo.length, 12);
  assert.deepEqual(hilo[0], {
    time: Date.UTC(2026, 8, 14, 2, 34),
    type: 'high',
    heightM: 1.445,
  });
  assert.deepEqual(hilo.at(-1), {
    time: Date.UTC(2026, 8, 16, 21, 37),
    type: 'low',
    heightM: 0.266,
  });
  const observed = normalizeWaterLevel(
    fixture('datagetter-water-level-8454000.json'),
  );
  assert.deepEqual(observed, {
    time: Date.UTC(2026, 8, 14, 16, 6),
    heightM: 1.474,
  });
  assert.equal(
    predictionAt(
      fixture('datagetter-predictions-latest-8454000.json'),
      observed.time,
    ),
    1.429,
  );
  assert.equal(
    predictionAt(fixture('datagetter-predictions-latest-8454000.json'), NOW),
    null,
  );
  assert.deepEqual(
    normalizeWaterLevel(fixture('datagetter-water-level-igld-9063020.json')),
    {
      time: Date.UTC(2026, 8, 14, 16, 6),
      heightM: 174.372,
    },
  );
  assert.equal(
    normalizeWaterLevel(fixture('datagetter-water-level-nodata-8551910.json')),
    null,
  );
  assert.equal(normalizeHilo({}), null);
});

test('current predictions keep flood, ebb and slack with speeds in m/s and the bin depth', () => {
  const currents = normalizeCurrents(
    fixture('datagetter-currents-ACT1616-bin1.json'),
  );
  assert.equal(currents.depthM, 4.6);
  assert.equal(currents.floodDirDeg, 37);
  assert.equal(currents.ebbDirDeg, 226);
  assert.equal(currents.events.length, 24);
  assert.deepEqual(currents.events[0], {
    time: Date.UTC(2026, 8, 14, 1, 3),
    type: 'flood',
    speedMs: 1.078,
  });
  assert.deepEqual(currents.events.at(-1), {
    time: Date.UTC(2026, 8, 16, 23, 47),
    type: 'slack',
    speedMs: 0,
  });
  assert.equal(
    normalizeCurrents({
      current_predictions: { units: 'feet, knots', cp: [] },
    }),
    null,
  );
  assert.equal(
    normalizeCurrents(fixture('datagetter-currents-unavailable-ACT5971.json')),
    null,
  );
});
