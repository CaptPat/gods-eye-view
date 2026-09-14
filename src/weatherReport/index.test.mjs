// src/weatherReport/index.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDocument } from '../testSupport/fakeDom.mjs';
import { REPORT_ENDPOINT, createWeatherReport } from './index.js';

const T0 = Date.UTC(2026, 8, 14, 12, 10);
const POINT = { lat: 29.3, lon: -94.8 };
const REPORT = {
  point: { lat: 29.3, lon: -94.8 },
  place: 'Galveston, Texas',
  timeZone: 'America/Chicago',
  generatedAt: T0,
  stale: false,
  sources: { google: 'ok', openMeteoMarine: 'ok', openMeteoSolar: 'ok', place: 'ok' },
  now: { condition: 'Sunny', temperatureC: 29.8, feelsLikeC: 36.8, dewPointC: 26.1, humidityPct: 80, pressureHpa: 1017.56,
    windSpeedMs: 3.61, windGustMs: 3.89, windFromDeg: 166, cloudCoverPct: 9, visibilityM: 16000, uvIndex: 0, thunderstormPct: 0 },
  hourly: [],
  daily: [],
  marine: null,
  solar: { shortwaveWm2: 0, directWm2: 0, surfaceTempC: 28.8 },
};
const settle = async () => {
  for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

function setup(t, { storage = new Map(), rail = true } = {}) {
  const document = installFakeDocument(t);
  if (rail) {
    const aside = document.createElement('aside');
    aside.id = 'right-context-rail';
    document.body.appendChild(aside);
  }
  const requests = [];
  const pinCalls = [];
  const panels = [];
  let menuOptions = null;
  let pinOptions = null;
  const menu = { destroyed: false, destroy() { this.destroyed = true; } };
  const fetchImpl = (url, { signal }) =>
    new Promise((resolve, reject) => {
      requests.push({ url, signal, resolve });
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
  const respond = (index, status, body) =>
    requests[index].resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
  const store = storage instanceof Map
    ? { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }
    : storage;
  const report = createWeatherReport({
    viewer: { id: 'viewer' },
    overlayHost: { id: 'host' },
    document,
    fetchImpl,
    storage: store,
    requestRender: () => {},
    now: () => T0,
    createMenu: (options) => { menuOptions = options; return menu; },
    createPin: (options) => {
      pinOptions = options;
      return {
        show: (...args) => pinCalls.push(['show', ...args]),
        update: (...args) => pinCalls.push(['update', ...args]),
        clear: () => pinCalls.push(['clear']),
        destroy: () => pinCalls.push(['destroy']),
      };
    },
    createPanel: (options) => {
      const calls = [];
      const panel = {
        options,
        calls,
        setUnits: (...args) => calls.push(['setUnits', ...args]),
        showLoading: (...args) => calls.push(['showLoading', ...args]),
        showError: (...args) => calls.push(['showError', ...args]),
        render: (view) => calls.push(['render', view]),
        reveal: () => calls.push(['reveal']),
        destroy: () => calls.push(['destroy']),
      };
      panels.push(panel);
      return panel;
    },
  });
  return { document, report, requests, respond, pinCalls, panels, menu, storage, menuOptions: () => menuOptions, pinOptions: () => pinOptions };
}

test('a pick pins the spot, shows loading, fetches the report and renders it', async (t) => {
  const s = setup(t);
  s.menuOptions().onPick(POINT);
  assert.deepEqual(s.pinCalls[0], ['show', POINT, { title: 'Loading weather', details: [] }]);
  assert.equal(s.panels.length, 1);
  assert.deepEqual(s.panels[0].calls[0], ['showLoading', { title: '29.300, -94.800', coordinates: '29.300, -94.800' }]);
  assert.equal(s.panels[0].options.units, 'imperial');
  assert.equal(s.requests[0].url, `${REPORT_ENDPOINT}?lat=29.3000&lon=-94.8000`);
  s.respond(0, 200, REPORT);
  await settle();
  const render = s.panels[0].calls.find(([name]) => name === 'render');
  assert.equal(render[1].title, 'Galveston, Texas');
  assert.equal(render[1].now.temperature, '86°F');
  assert.deepEqual(s.pinCalls.at(-1), ['update', { title: '86°F · Sunny', details: ['Wind 8 mph SSE, gusts 9', 'Includes weather data from Google'] }]);
});

test('a second pick aborts the first request and ignores its result', async (t) => {
  const s = setup(t);
  s.menuOptions().onPick(POINT);
  s.menuOptions().onPick({ lat: 30.25, lon: -97.75 });
  assert.equal(s.requests[0].signal.aborted, true);
  s.respond(0, 200, REPORT);
  s.respond(1, 200, { ...REPORT, place: 'Austin, Texas' });
  await settle();
  const renders = s.panels[0].calls.filter(([name]) => name === 'render');
  assert.equal(renders.length, 1);
  assert.equal(renders[0][1].title, 'Austin, Texas');
  assert.equal(s.panels.length, 1, 'the open panel is reused');
});

test('an error response shows the panel status and an unavailable pin', async (t) => {
  const s = setup(t);
  s.menuOptions().onPick(POINT);
  s.respond(0, 502, { error: 'Weather sources unavailable' });
  await settle();
  assert.deepEqual(s.panels[0].calls.at(-1), ['showError', 'Weather sources unavailable', { title: '29.300, -94.800', coordinates: '29.300, -94.800' }]);
  assert.deepEqual(s.pinCalls.at(-1), ['update', { title: 'Weather unavailable', details: [] }]);
});

test('closing aborts, clears the pin and destroys the panel; the next pick builds a new panel', async (t) => {
  const s = setup(t);
  s.menuOptions().onPick(POINT);
  s.panels[0].options.onClose();
  assert.equal(s.requests[0].signal.aborted, true);
  assert.deepEqual(s.pinCalls.at(-1), ['clear']);
  assert.deepEqual(s.panels[0].calls.at(-1), ['destroy']);
  s.menuOptions().onPick(POINT);
  assert.equal(s.panels.length, 2);
});

test('the units preference persists, re-renders, and survives broken storage', async (t) => {
  const storage = new Map([['gev.weatherReport.units', 'metric']]);
  const s = setup(t, { storage });
  s.menuOptions().onPick(POINT);
  assert.equal(s.panels[0].options.units, 'metric');
  s.respond(0, 200, REPORT);
  await settle();
  s.panels[0].options.onUnitsChange('imperial');
  assert.equal(storage.get('gev.weatherReport.units'), 'imperial');
  assert.deepEqual(s.panels[0].calls.filter(([name]) => name === 'setUnits'), [['setUnits', 'imperial']]);
  assert.equal(s.panels[0].calls.filter(([name]) => name === 'render').at(-1)[1].now.temperature, '86°F');
  assert.equal(s.report.getUnits(), 'imperial');

  const broken = setup(t, { storage: { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } } });
  assert.equal(broken.report.getUnits(), 'imperial');
  assert.doesNotThrow(() => broken.report.setUnits('metric'));
  assert.equal(broken.report.getUnits(), 'metric');
});

test('refresh re-requests the same point, pin activation reveals the panel, destroy cleans up', async (t) => {
  const s = setup(t);
  s.menuOptions().onPick(POINT);
  s.respond(0, 200, REPORT);
  await settle();
  s.panels[0].options.onRefresh();
  assert.equal(s.requests.length, 2);
  assert.equal(s.requests[1].url, s.requests[0].url);
  s.pinOptions().onActivate();
  assert.deepEqual(s.panels[0].calls.at(-1), ['reveal']);
  s.report.destroy();
  assert.equal(s.menu.destroyed, true);
  assert.deepEqual(s.pinCalls.slice(-2), [['clear'], ['destroy']]);
  s.menuOptions().onPick(POINT);
  assert.equal(s.requests.length, 2, 'no request after destroy');
});
