// src/weatherReport/reportPanel.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDocument } from '../testSupport/fakeDom.mjs';
import { CREDITS, buildReportView } from './reportModel.js';
import { PANEL_ID, createReportPanel } from './reportPanel.js';

const T0 = Date.UTC(2026, 8, 14, 12, 10);
const REPORT = {
  point: { lat: 29.25, lon: -94.8 },
  place: 'Galveston, Texas',
  timeZone: 'America/Chicago',
  generatedAt: T0,
  stale: false,
  sources: { google: 'ok', openMeteoMarine: 'ok', openMeteoSolar: 'ok', place: 'ok' },
  now: { condition: 'Sunny', temperatureC: 29.8, feelsLikeC: 36.8, dewPointC: 26.1, humidityPct: 80, pressureHpa: 1017.56,
    windSpeedMs: 3.61, windGustMs: 3.89, windFromDeg: 166, cloudCoverPct: 9, visibilityM: 16000, uvIndex: 0, thunderstormPct: 0 },
  hourly: [{ time: Date.parse('2026-09-14T12:00:00Z'), condition: 'Clear', temperatureC: 29.8, precipChancePct: 0, windSpeedMs: 3.61, windFromDeg: 166 }],
  daily: [{ date: '2026-09-14', dayCondition: 'Sunny', nightCondition: 'Clear', highC: 31.4, lowC: 29.4, precipChancePct: 45,
    sunrise: Date.parse('2026-09-14T12:03:33.388Z'), sunset: Date.parse('2026-09-15T00:25:23.308Z') }],
  marine: { waveHeightM: 0.46, wavePeriodS: 4, waveFromDeg: 165, swellHeightM: 0.42, seaSurfaceTempC: 31, dailyMaxWaveM: [] },
  solar: { shortwaveWm2: 0, directWm2: 0, surfaceTempC: 28.8 },
};
const viewOf = (patch = {}, options = {}) => buildReportView({ ...REPORT, ...patch }, { units: 'imperial', now: T0, ...options });

function setup(t, options = {}) {
  const document = installFakeDocument(t);
  const rail = document.createElement('aside');
  rail.id = 'right-context-rail';
  rail.appendChild(document.createElement('div'));
  document.body.appendChild(rail);
  const events = [];
  const panel = createReportPanel({
    document,
    rail,
    onClose: () => events.push('close'),
    onRefresh: () => events.push('refresh'),
    onUnitsChange: (units) => events.push(`units:${units}`),
    ...options,
  });
  const el = panel.element;
  const texts = (selector) => el.querySelectorAll(selector).map((node) => node.textContent);
  return { document, rail, panel, el, events, texts };
}

test('the panel is inserted first in the rail with the shared panel markup and permanent credits', (t) => {
  const s = setup(t);
  assert.equal(s.rail.children[0], s.el);
  assert.equal(PANEL_ID, 'weather-report-panel');
  assert.equal(s.el.id, 'weather-report-panel');
  assert.equal(s.el.getAttribute('data-panel-id'), 'weather-report-panel');
  assert.equal(s.el.classList.contains('panel-collapsible'), true);
  assert.ok(s.el.querySelector('.panel-glow'));
  assert.deepEqual(s.texts('.panel-title'), ['WEATHER']);
  s.panel.showLoading({ title: '29.250, -94.800', coordinates: '29.250, -94.800' });
  assert.deepEqual(s.texts('.weather-report-status'), ['Loading weather']);
  assert.equal(s.el.querySelector('.weather-report-status').getAttribute('aria-live'), 'polite');
  assert.equal(s.el.querySelector('.weather-report-refresh').disabled, true);
  const credits = s.el.querySelector('.weather-report-credits').textContent;
  assert.ok(credits.includes(CREDITS[0]));
  assert.ok(credits.includes(CREDITS[1]));
});

test('a full view renders every section in order', (t) => {
  const s = setup(t);
  s.panel.render(viewOf());
  assert.deepEqual(s.texts('h3'), ['Now', 'Next 48 hours', '10 days', 'Marine', 'Sun and surface']);
  assert.deepEqual(s.texts('.weather-report-place'), ['Galveston, Texas']);
  assert.deepEqual(s.texts('.weather-report-updated'), ['29.250, -94.800 · Updated 07:10 local (UTC−5)']);
  assert.deepEqual(s.texts('.weather-report-status'), ['']);
  assert.deepEqual(s.texts('.weather-report-now-temp'), ['86°F']);
  assert.deepEqual(s.texts('.weather-report-now-condition'), ['Sunny · Feels like 98°F']);
  assert.ok(s.texts('dd').includes('30.05 inHg'));
  assert.deepEqual(s.texts('.weather-report-hour'), ['07:00Clear86°F0%SSE 8 mph']);
  assert.deepEqual(s.texts('.weather-report-day'), ['Mon 14Sunny / Clear89°F / 85°F45%']);
  assert.ok(s.texts('dd').includes('07:03'));
  assert.deepEqual(s.texts('.weather-report-section-status'), []);
  assert.equal(s.el.querySelector('.weather-report-refresh').disabled, false);
});

test('section statuses, inland marine and stale reports', (t) => {
  const s = setup(t);
  s.panel.render(viewOf({
    sources: { ...REPORT.sources, google: 'unavailable', openMeteoMarine: 'unavailable' },
    now: null, hourly: null, daily: null, marine: null, timeZone: null,
  }));
  assert.deepEqual(s.texts('h3'), ['Now', 'Marine', 'Sun and surface']);
  assert.deepEqual(s.texts('.weather-report-section-status'), ['Google forecast unavailable', 'Open-Meteo unavailable']);
  assert.equal(s.el.querySelector('.weather-report-section-status').getAttribute('aria-live'), 'polite');

  s.panel.render(viewOf({ marine: null }));
  assert.deepEqual(s.texts('h3'), ['Now', 'Next 48 hours', '10 days', 'Sun and surface']);

  s.panel.render(viewOf({ stale: true }, { now: T0 + 45 * 60_000 }));
  assert.deepEqual(s.texts('.weather-report-status'), ['Showing weather from 45 min ago']);
});

test('units, refresh, close, errors and destroy', (t) => {
  const s = setup(t);
  const units = s.el.querySelector('.weather-report-units');
  assert.equal(units.textContent, '°F');
  units.click();
  s.panel.setUnits('metric');
  assert.equal(units.textContent, '°C');
  units.click();
  s.el.querySelector('.weather-report-refresh').click();
  s.el.querySelector('.weather-report-close').click();
  assert.deepEqual(s.events, ['units:metric', 'units:imperial', 'refresh', 'close']);
  s.panel.render(viewOf());
  s.panel.showError('Weather sources unavailable', { title: 'Galveston, Texas', coordinates: '29.250, -94.800' });
  assert.deepEqual(s.texts('.weather-report-status'), ['Weather sources unavailable']);
  assert.deepEqual(s.texts('h3'), []);
  s.panel.destroy();
  assert.equal(s.rail.children.includes(s.el), false);
});

test('place names are rendered as text, never markup', (t) => {
  const s = setup(t);
  s.panel.render(viewOf({ place: '<img src=x onerror=alert(1)>' }));
  assert.deepEqual(s.texts('.weather-report-place'), ['<img src=x onerror=alert(1)>']);
  assert.equal(s.el.querySelector('img'), null);
});
