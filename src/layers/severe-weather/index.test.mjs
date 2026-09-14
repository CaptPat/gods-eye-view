// src/layers/severe-weather/index.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Cesium from 'cesium';
import {
  REFRESH_MS,
  SEVERE_WEATHER_ENDPOINT,
  createSevereWeatherLayer,
} from './index.js';
import defaultLayer from '../../data/severeWeather.js';
import { GDACS_CREDIT, NWS_ALERTS_CREDIT } from '../../data/dataCredits.js';
import { simplifyGeometry } from '../../../server/providers/severe-weather/geometry.js';
import { normalizeNwsAlerts } from '../../../server/providers/severe-weather/nws.js';
import {
  attachCycloneShapes,
  normalizeGdacsCycloneShapes,
  normalizeGdacsEvents,
} from '../../../server/providers/severe-weather/gdacs.js';

const T = Date.UTC(2026, 8, 14, 16, 10);
const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../../data/fixtures/severe-weather/${name}`, import.meta.url),
      'utf8',
    ),
  );

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
    generatedAt: T,
    nws: {
      status: 'ok',
      updatedAt: nws.updatedAt,
      alerts: nws.alerts,
      zones,
      unmappedAlerts: 0,
    },
    gdacs: { status: 'ok', updatedAt: T, events },
  };
}

function harness({
  answer = () => Response.json(fixturePayload()),
  renderImpl,
} = {}) {
  const calls = [];
  const requests = [];
  const renders = [];
  const credited = [];
  let action = null;
  const state = { visible: true, answer };
  const rendering = {
    render: renderImpl ?? ((data) => renders.push(data)),
    targetFor: (picked) =>
      picked?.id === 'fairbanks'
        ? { kind: 'nws', key: 'zone:forecast/AKZ844' }
        : null,
    setSelected: (key) => calls.push(['highlight', key]),
    setVisible: (visible) => calls.push(['renderVisible', visible]),
    clear: () => calls.push(['renderClear']),
    destroy: () => calls.push(['renderDestroy']),
  };
  const layer = createSevereWeatherLayer({
    fetchImpl: async (url, init) => {
      requests.push(url);
      if (init?.signal?.aborted)
        throw new DOMException('aborted', 'AbortError');
      return state.answer();
    },
    overlayHost: {
      setVisible: (...args) => calls.push(['visible', ...args]),
      setEntries: (...args) => calls.push(['entries', ...args]),
      clearSource: (...args) => calls.push(['clearSource', ...args]),
      hitTest: () => null,
    },
    context: {
      registerEntityContext: (entity, metadata) => {
        entity.__gevContextId = metadata.id;
      },
      selectEntityContext: () => {},
      clearSelectedEntityContextForLayer: () => {},
      removeEntityContextsForLayer: () => {},
    },
    picking: {
      resolvePickId: () => null,
      isOwnedByOtherLayer: () => false,
      registerPickOwner: (id) => calls.push(['pickOwner', id]),
      unregisterPickOwner: (id) => calls.push(['pickOwnerRemoved', id]),
    },
    pickGround: () => ({ lat: 64.8378, lon: -147.7164 }),
    registerCredit: (_viewer, credit) => credited.push(credit.key),
    credits: [{ key: 'nws' }, { key: 'gdacs' }],
    isVisible: () => state.visible,
    now: () => T,
    createRendering: (viewer, options) => {
      calls.push(['createRendering', typeof options.requestRender]);
      return rendering;
    },
    screenSpaceEventHandlerFactory: () => ({
      setInputAction(fn) {
        action = fn;
      },
      destroy() {
        calls.push(['handlerDestroyed']);
      },
    }),
  });
  const viewer = { scene: { pick: () => ({ id: 'fairbanks' }) } };
  return {
    layer,
    viewer,
    state,
    calls,
    requests,
    renders,
    credited,
    click: () => action({ position: new Cesium.Cartesian2(5, 5) }),
    count: (name) => calls.filter(([entry]) => entry === name).length,
  };
}

async function enabled(h) {
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  return h.layer.update(h.viewer, {});
}

test('the layer identifies itself, refreshes every five minutes and credits both sources', () => {
  const { layer } = harness();
  assert.equal(layer.id, 'severe-weather');
  assert.equal(layer.name, 'Severe Weather');
  assert.equal(layer.icon, '⚠️');
  assert.equal(layer.updateInterval, REFRESH_MS);
  assert.equal(REFRESH_MS, 300_000);
  assert.equal(SEVERE_WEATHER_ENDPOINT, '/api/severe-weather');
  assert.equal(defaultLayer.id, 'severe-weather');
  assert.equal(
    NWS_ALERTS_CREDIT.html,
    'US weather alerts: <a href="https://www.weather.gov/" target="_blank" rel="noopener">National Weather Service</a> (NOAA, public domain)',
  );
  assert.equal(
    GDACS_CREDIT.html,
    'Global disaster alerts: <a href="https://www.gdacs.org/" target="_blank" rel="noopener">GDACS</a>, European Commission JRC and UN OCHA (indicative, not official warnings)',
  );
  assert.throws(() => createSevereWeatherLayer({}), /requires overlay/);
});

test('enabling credits the sources, installs the click handler and draws the fetched alerts and events', async () => {
  const h = harness();
  assert.equal(await enabled(h), true);
  assert.deepEqual(h.credited, ['nws', 'gdacs']);
  assert.deepEqual(h.calls.slice(0, 3), [
    ['createRendering', 'function'],
    ['renderVisible', false],
    ['renderVisible', true],
  ]);
  assert.equal(h.count('pickOwner'), 1);
  assert.deepEqual(h.requests, ['/api/severe-weather']);
  const drawn = h.renders.at(-1);
  assert.equal(drawn.areas.length, 10);
  assert.equal(drawn.events.length, 6);
  assert.equal(drawn.droppedAreas, 0);
  assert.deepEqual(h.layer.getStats(), {
    status: 'ok',
    source: 'NWS 6 · GDACS 6',
    count: 12,
    lastUpdate: T,
  });
});

test('a hidden tab skips refreshes; a failed refresh keeps the drawing and reports it; no data is unavailable', async () => {
  const h = harness();
  await enabled(h);
  h.state.visible = false;
  assert.equal(await h.layer.update(h.viewer, {}), true);
  assert.equal(h.requests.length, 1);

  h.state.visible = true;
  h.state.answer = () =>
    Response.json(
      { error: 'Severe weather sources unavailable' },
      { status: 502 },
    );
  assert.equal(
    await h.layer.update(h.viewer, {}),
    true,
    'handled: the manager reads stats.error',
  );
  assert.equal(h.renders.length, 1);
  assert.deepEqual(h.layer.getStats(), {
    status: 'ok',
    source: 'NWS 6 · GDACS 6',
    count: 12,
    lastUpdate: T,
    stale: true,
    error: 'Severe weather refresh failed',
  });

  const cold = harness({
    answer: () => Response.json({ error: 'down' }, { status: 502 }),
  });
  await enabled(cold);
  assert.deepEqual(cold.layer.getStats(), {
    status: 'unavailable',
    source: 'NWS · GDACS',
    error: 'Severe weather sources unavailable',
  });

  const aborted = new AbortController();
  aborted.abort();
  assert.equal(
    await h.layer.update(h.viewer, { signal: aborted.signal }),
    false,
    'only a manager abort is a failure',
  );
});

test('a render exception surfaces through getStats().error without committing the failed payload', async () => {
  let shouldThrow = false;
  const renders = [];
  const h = harness({
    renderImpl: (data) => {
      if (shouldThrow) throw new Error('boom: broken geometry');
      renders.push(data);
    },
  });
  assert.equal(await enabled(h), true);
  const goodStats = h.layer.getStats();
  assert.equal(goodStats.status, 'ok');
  assert.equal(goodStats.lastUpdate, T);
  assert.equal(renders.length, 1);

  // The next fetch answers with a smaller, distinguishable payload; if it
  // were committed despite the draw throwing, getStats() would change.
  const quiet = fixturePayload();
  quiet.nws.alerts = quiet.nws.alerts.slice(0, 1);
  shouldThrow = true;
  h.state.answer = () => Response.json(quiet);
  assert.equal(
    await h.layer.update(h.viewer, {}),
    true,
    'a handled draw failure still resolves true',
  );
  assert.equal(renders.length, 1, 'the failed draw did not commit a render');
  assert.deepEqual(h.layer.getStats(), {
    ...goodStats,
    stale: true,
    error: 'Severe weather refresh failed',
  });

  // The next, successful update is not skipped: the failure did not poison
  // future draws, and the smaller payload from the failed round is gone —
  // this fetch's own (large) payload commits normally.
  shouldThrow = false;
  h.state.answer = () => Response.json(fixturePayload());
  assert.equal(await h.layer.update(h.viewer, {}), true);
  assert.equal(renders.length, 2);
  assert.deepEqual(h.layer.getStats(), goodStats);
});

test('new data refreshes the selected card, and drops it when its alert has ended', async () => {
  const h = harness();
  await enabled(h);
  h.click();
  assert.equal(
    h.calls.filter(([name]) => name === 'entries').at(-1)[2][0].title,
    'Flood Watch',
  );
  const quiet = fixturePayload();
  quiet.nws.alerts = quiet.nws.alerts.filter(
    (alert) =>
      alert.event !== 'Flood Watch' && alert.event !== 'Dense Fog Advisory',
  );
  h.state.answer = () => Response.json(quiet);
  await h.layer.update(h.viewer, {});
  assert.equal(h.count('clearSource'), 1);
  assert.deepEqual(h.calls.filter(([name]) => name === 'highlight').at(-1), [
    'highlight',
    null,
  ]);
});

test('disable releases drawings, selection and data; destroy releases the rendering', async () => {
  const h = harness();
  await enabled(h);
  h.layer.disable(h.viewer);
  assert.equal(h.count('renderClear'), 1);
  assert.equal(h.count('handlerDestroyed'), 1);
  assert.equal(h.count('pickOwnerRemoved'), 1);
  assert.deepEqual(h.layer.getStats(), {
    status: 'ok',
    source: 'NWS · GDACS',
    count: 0,
    lastUpdate: null,
  });
  assert.equal(
    await h.layer.update(h.viewer, {}),
    false,
    'a disabled layer does not refresh',
  );
  h.layer.destroy(h.viewer);
  assert.equal(h.count('renderDestroy'), 1);
});
