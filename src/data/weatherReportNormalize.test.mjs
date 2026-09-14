import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  googleCurrentUrl, googleDailyUrl, googleHourlyUrl, googleTimeZone, isOpenMeteoPayload,
  marineUrl, normalizeGoogleDaily, normalizeGoogleHourly, normalizeGoogleNow, normalizeMarine,
  normalizeSolar, parseReportQuery, reportCacheKey, roundToGrid, solarUrl,
} from '../../server/providers/weather-report/normalize.js';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/weather-report/${name}`, import.meta.url), 'utf8'));
const POINT = { lat: 29.3, lon: -94.8 };

test('queries are validated and snapped to the 0.05° grid', () => {
  const q = (lat, lon) => parseReportQuery(new URLSearchParams({ lat, lon }));
  assert.deepEqual(q('29.27', '-94.82'), { lat: 29.25, lon: -94.8 });
  assert.deepEqual(q('90', '180'), { lat: 90, lon: 180 });
  assert.match(parseReportQuery(new URLSearchParams({ lon: '1' })).error, /lat/);
  assert.match(q('91', '0').error, /lat/);
  assert.match(q('abc', '0').error, /lat/);
  assert.match(q('10', '-181').error, /lon/);
  assert.match(q('10', '').error, /lon/);
  assert.equal(roundToGrid(29.28), 29.3);
  assert.equal(roundToGrid(0.01), 0);
  assert.equal(reportCacheKey(POINT), '29.30,-94.80');
});

test('upstream URLs carry the documented parameters', () => {
  const current = new URL(googleCurrentUrl(POINT, 'K'));
  assert.equal(current.origin + current.pathname, 'https://weather.googleapis.com/v1/currentConditions:lookup');
  assert.equal(current.searchParams.get('location.latitude'), '29.30');
  assert.equal(current.searchParams.get('location.longitude'), '-94.80');
  assert.equal(current.searchParams.get('unitsSystem'), 'METRIC');
  assert.equal(current.searchParams.get('languageCode'), 'en');
  assert.equal(current.searchParams.get('key'), 'K');

  const hours = new URL(googleHourlyUrl(POINT, 'K'));
  assert.equal(hours.pathname, '/v1/forecast/hours:lookup');
  assert.equal(hours.searchParams.get('hours'), '48');
  assert.equal(hours.searchParams.get('pageSize'), '24');
  assert.equal(hours.searchParams.has('pageToken'), false);
  assert.equal(new URL(googleHourlyUrl(POINT, 'K', 'fixture-page-2')).searchParams.get('pageToken'), 'fixture-page-2');

  const days = new URL(googleDailyUrl(POINT, 'K'));
  assert.equal(days.pathname, '/v1/forecast/days:lookup');
  assert.equal(days.searchParams.get('days'), '10');
  assert.equal(days.searchParams.get('pageSize'), '10');

  const marine = new URL(marineUrl(POINT));
  assert.equal(marine.origin + marine.pathname, 'https://marine-api.open-meteo.com/v1/marine');
  assert.deepEqual(Object.fromEntries(marine.searchParams), {
    latitude: '29.30', longitude: '-94.80',
    current: 'wave_height,wave_period,wave_direction,swell_wave_height,sea_surface_temperature',
    daily: 'wave_height_max', forecast_days: '7', timezone: 'GMT',
  });
  const solar = new URL(solarUrl(POINT));
  assert.equal(solar.origin + solar.pathname, 'https://api.open-meteo.com/v1/forecast');
  assert.deepEqual(Object.fromEntries(solar.searchParams), {
    latitude: '29.30', longitude: '-94.80', current: 'shortwave_radiation,direct_radiation',
    hourly: 'soil_temperature_0cm', forecast_hours: '1', timezone: 'GMT',
  });
});

test('Google current conditions normalize to SI', () => {
  const json = fixture('google-current.json');
  assert.equal(googleTimeZone(json), 'America/Chicago');
  assert.deepEqual(normalizeGoogleNow(json), {
    condition: 'Sunny', iconType: 'CLEAR', isDaytime: true,
    temperatureC: 29.8, feelsLikeC: 36.8, dewPointC: 26.1, humidityPct: 80, pressureHpa: 1017.56,
    windSpeedMs: 3.61, windGustMs: 3.89, windFromDeg: 166, cloudCoverPct: 9,
    visibilityM: 16000, uvIndex: 0, thunderstormPct: 0,
  });
  assert.equal(normalizeGoogleNow(null), null);
  assert.equal(googleTimeZone({}), null);
  const imperial = normalizeGoogleNow({
    temperature: { unit: 'FAHRENHEIT', degrees: 68 },
    wind: { speed: { unit: 'MILES_PER_HOUR', value: 10 } },
    visibility: { unit: 'MILES', distance: 1 },
  });
  assert.equal(imperial.temperatureC, 20);
  assert.equal(imperial.windSpeedMs, 4.47);
  assert.equal(imperial.visibilityM, 1609);
});

test('hourly pages are joined and capped at 48 entries', () => {
  const pages = [fixture('google-hourly-page1.json'), fixture('google-hourly-page2.json')];
  const hourly = normalizeGoogleHourly(pages);
  assert.equal(hourly.length, 48);
  assert.deepEqual(hourly[0], {
    time: Date.parse('2026-09-14T12:00:00Z'), condition: 'Clear', iconType: 'CLEAR',
    temperatureC: 29.8, precipChancePct: 0, windSpeedMs: 3.61, windFromDeg: 166,
  });
  assert.deepEqual(hourly[47], {
    time: Date.parse('2026-09-16T11:00:00Z'), condition: 'Partly cloudy', iconType: 'PARTLY_CLOUDY',
    temperatureC: 29, precipChancePct: 0, windSpeedMs: 1.67, windFromDeg: 108,
  });
  assert.equal(normalizeGoogleHourly([...pages, pages[0]]).length, 48);
});

test('daily forecast normalizes dates, the larger precip chance and sun events', () => {
  const daily = normalizeGoogleDaily(fixture('google-daily.json'));
  assert.equal(daily.length, 10);
  assert.deepEqual(daily[0], {
    date: '2026-09-14', dayCondition: 'Sunny', nightCondition: 'Clear', highC: 31.4, lowC: 29.4,
    precipChancePct: 45, sunrise: Date.parse('2026-09-14T12:03:33.388Z'),
    sunset: Date.parse('2026-09-15T00:25:23.308Z'),
  });
  assert.equal(daily[9].date, '2026-09-23');
  assert.equal(daily[9].precipChancePct, 65);
});

test('marine is null inland; solar reads current radiation and surface temperature', () => {
  const coastal = normalizeMarine(fixture('open-meteo-marine-coastal.json'));
  assert.deepEqual({ ...coastal, dailyMaxWaveM: coastal.dailyMaxWaveM.slice(0, 1) }, {
    waveHeightM: 0.46, wavePeriodS: 4, waveFromDeg: 165, swellHeightM: 0.42, seaSurfaceTempC: 31,
    dailyMaxWaveM: [{ date: '2026-09-14', heightM: 0.52 }],
  });
  assert.equal(coastal.dailyMaxWaveM.length, 7);
  const inland = fixture('open-meteo-marine-inland.json');
  assert.equal(isOpenMeteoPayload(inland), true);
  assert.equal(normalizeMarine(inland), null);
  assert.equal(isOpenMeteoPayload({ error: true, reason: 'x' }), false);
  assert.deepEqual(normalizeSolar(fixture('open-meteo-solar.json')), {
    shortwaveWm2: 0, directWm2: 0, surfaceTempC: 28.8,
  });
});
