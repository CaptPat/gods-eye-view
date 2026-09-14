import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CREDITS, UNITS_STORAGE_KEY, buildReportView, cardinal, formatClock, normalizeUnits, utcOffsetLabel,
} from './reportModel.js';

const T0 = Date.UTC(2026, 8, 14, 12, 10);
const REPORT = Object.freeze({
  point: { lat: 29.25, lon: -94.8 },
  place: 'Galveston, Texas',
  timeZone: 'America/Chicago',
  generatedAt: T0,
  stale: false,
  sources: { google: 'ok', openMeteoMarine: 'ok', openMeteoSolar: 'ok', place: 'ok' },
  now: {
    condition: 'Sunny', iconType: 'CLEAR', isDaytime: true, temperatureC: 29.8, feelsLikeC: 36.8,
    dewPointC: 26.1, humidityPct: 80, pressureHpa: 1017.56, windSpeedMs: 3.61, windGustMs: 3.89,
    windFromDeg: 166, cloudCoverPct: 9, visibilityM: 16000, uvIndex: 0, thunderstormPct: 0,
  },
  hourly: [
    { time: Date.parse('2026-09-14T12:00:00Z'), condition: 'Clear', iconType: 'CLEAR', temperatureC: 29.8, precipChancePct: 0, windSpeedMs: 3.61, windFromDeg: 166 },
  ],
  daily: [
    { date: '2026-09-14', dayCondition: 'Sunny', nightCondition: 'Clear', highC: 31.4, lowC: 29.4, precipChancePct: 45,
      sunrise: Date.parse('2026-09-14T12:03:33.388Z'), sunset: Date.parse('2026-09-15T00:25:23.308Z') },
  ],
  marine: { waveHeightM: 0.46, wavePeriodS: 4, waveFromDeg: 165, swellHeightM: 0.42, seaSurfaceTempC: 31,
    dailyMaxWaveM: [{ date: '2026-09-14', heightM: 0.52 }] },
  solar: { shortwaveWm2: 0, directWm2: 0, surfaceTempC: 28.8 },
});
const view = (patch = {}, options = {}) =>
  buildReportView({ ...REPORT, ...patch }, { units: 'imperial', now: T0, ...options });
const rows = (list) => Object.fromEntries(list.map((row) => [row.label, row.value]));

test('units, cardinals, clocks and offsets', () => {
  assert.equal(UNITS_STORAGE_KEY, 'gev.weatherReport.units');
  assert.equal(normalizeUnits('metric'), 'metric');
  assert.equal(normalizeUnits('kelvin'), 'imperial');
  assert.equal(normalizeUnits(undefined), 'imperial');
  assert.equal(cardinal(0), 'N');
  assert.equal(cardinal(166), 'SSE');
  assert.equal(cardinal(135), 'SE');
  assert.equal(cardinal(359), 'N');
  assert.equal(cardinal(null), '');
  assert.equal(formatClock(T0, 'America/Chicago'), '07:10');
  assert.equal(formatClock(T0, null), '12:10');
  assert.equal(utcOffsetLabel(T0, 'America/Chicago'), 'UTC−5');
  assert.equal(utcOffsetLabel(T0, 'Asia/Kolkata'), 'UTC+5:30');
  assert.equal(utcOffsetLabel(T0, 'UTC'), 'UTC');
});

test('imperial view: header, now grid, hourly, daily, marine, sun and surface, pin', () => {
  const v = view();
  assert.equal(v.title, 'Galveston, Texas');
  assert.equal(v.coordinates, '29.250, -94.800');
  assert.equal(v.updated, 'Updated 07:10 local (UTC−5)');
  assert.equal(v.status, null);
  assert.equal(v.now.temperature, '86°F');
  assert.equal(v.now.condition, 'Sunny');
  assert.equal(v.now.feelsLike, 'Feels like 98°F');
  assert.deepEqual(rows(v.now.grid), {
    Humidity: '80%', 'Dew point': '79°F', Pressure: '30.05 inHg', Wind: 'SSE 8 mph', Gusts: '9 mph',
    'Cloud cover': '9%', Visibility: '9.9 mi', 'UV index': '0', Thunderstorms: '0%',
  });
  assert.deepEqual(v.hourly[0], { time: '07:00', condition: 'Clear', temperature: '86°F', precip: '0%', wind: 'SSE 8 mph' });
  assert.deepEqual(v.daily[0], { day: 'Mon 14', dayCondition: 'Sunny', nightCondition: 'Clear', high: '89°F', low: '85°F', precip: '45%' });
  assert.deepEqual(rows(v.marine.rows), { Waves: '1.5 ft from SSE, 4 s', Swell: '1.4 ft', 'Sea surface': '88°F' });
  assert.deepEqual(v.marine.dailyMax, [{ day: 'Mon 14', value: '1.7 ft' }]);
  assert.deepEqual(rows(v.solar.rows), {
    'Shortwave radiation': '0 W/m²', 'Direct radiation': '0 W/m²', 'Surface temperature': '84°F',
    Sunrise: '07:03', Sunset: '19:25',
  });
  assert.deepEqual(v.sections, { forecast: null, marine: null, solar: null });
  assert.deepEqual(v.credits, CREDITS);
  assert.deepEqual(CREDITS, [
    'Source: Includes weather data from Google',
    'Marine, solar and surface: Weather data by Open-Meteo.com (CC BY 4.0)',
  ]);
  assert.deepEqual(v.pin, { title: '86°F · Sunny', details: ['Wind 8 mph SSE, gusts 9', 'Includes weather data from Google'] });
});

test('metric view converts every unit', () => {
  const v = view({}, { units: 'metric' });
  assert.equal(v.now.temperature, '30°C');
  assert.deepEqual(rows(v.now.grid), {
    Humidity: '80%', 'Dew point': '26°C', Pressure: '1018 hPa', Wind: 'SSE 13 km/h', Gusts: '14 km/h',
    'Cloud cover': '9%', Visibility: '16.0 km', 'UV index': '0', Thunderstorms: '0%',
  });
  assert.equal(rows(v.marine.rows).Waves, '0.5 m from SSE, 4 s');
  assert.equal(rows(v.marine.rows)['Sea surface'], '31°C');
  assert.equal(v.pin.details[0], 'Wind 13 km/h SSE, gusts 14');
});

test('per-section status text, stale line, missing place and missing time zone', () => {
  const googleDown = view({ sources: { ...REPORT.sources, google: 'unavailable' }, now: null, hourly: null, daily: null, timeZone: null });
  assert.equal(googleDown.sections.forecast, 'Google forecast unavailable');
  assert.equal(googleDown.now, null);
  assert.deepEqual(googleDown.hourly, []);
  assert.deepEqual(googleDown.daily, []);
  assert.equal(googleDown.updated, 'Updated 12:10 UTC');
  assert.deepEqual(rows(googleDown.solar.rows), {
    'Shortwave radiation': '0 W/m²', 'Direct radiation': '0 W/m²', 'Surface temperature': '84°F',
  });
  assert.deepEqual(googleDown.pin, { title: 'Weather unavailable', details: [] });

  assert.equal(view({ sources: { ...REPORT.sources, google: 'not-configured' }, now: null, hourly: null, daily: null }).sections.forecast,
    'Google weather not configured');

  const marineDown = view({ sources: { ...REPORT.sources, openMeteoMarine: 'unavailable' }, marine: null });
  assert.equal(marineDown.marine, null);
  assert.equal(marineDown.sections.marine, 'Open-Meteo unavailable');
  const inland = view({ marine: null });
  assert.equal(inland.marine, null);
  assert.equal(inland.sections.marine, null);

  const solarDown = view({ sources: { ...REPORT.sources, openMeteoSolar: 'unavailable' }, solar: null });
  assert.equal(solarDown.sections.solar, 'Open-Meteo unavailable');
  assert.deepEqual(rows(solarDown.solar.rows), { Sunrise: '07:03', Sunset: '19:25' });

  assert.equal(view({ stale: true }, { now: T0 + 45 * 60_000 }).status, 'Showing weather from 45 min ago');
  assert.equal(view({ place: null }).title, '29.250, -94.800');
  assert.equal(view({ now: { ...REPORT.now, humidityPct: null } }).now.grid[0].value, '—');
});
