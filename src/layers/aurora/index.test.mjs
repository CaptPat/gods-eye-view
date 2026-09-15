import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AURORA_ENDPOINT,
  AURORA_REFRESH_MS,
  createAuroraLayer,
} from './index.js';
import { AURORA_BAND_LEVELS } from './model.js';
import { DataLayerManager } from '../../data/manager.js';

const T0 = Date.UTC(2026, 8, 15, 12, 40);
const FORECAST = Date.parse('2026-09-15T12:36:00Z');
const BANDS = [
  { level: 1, west: -10, south: 68.5, east: 20, north: 69.5 },
  { level: 0, west: 100, south: -60.5, east: 130, north: -59.5 },
];
const payload = (overrides = {}) => ({
  generatedAt: T0,
  stale: false,
  observationTime: FORECAST - 3_600_000,
  forecastTime: FORECAST,
  maxProbability: 12,
  bands: BANDS,
  ...overrides,
});

function harness(answer = () => Response.json(payload())) {
  const requests = [];
  const renders = [];
  const credited = [];
  const rendering = {
    options: null,
    bands: [],
    show: false,
    destroyed: false,
    cleared: 0,
  };
  const state = { answer };
  const layer = createAuroraLayer({
    fetchImpl: async (url, init) => {
      requests.push({ url, signal: init?.signal });
      return state.answer();
    },
    createRendering: (_viewer, options) => {
      rendering.options = options;
      return {
        setBands: (bands) => {
          rendering.bands = bands;
          return bands.length;
        },
        setShow: (show) => {
          rendering.show = show;
        },
        clear: () => {
          rendering.cleared += 1;
          rendering.bands = [];
        },
        destroy: () => {
          rendering.destroyed = true;
        },
      };
    },
    requestRender: (reason) => renders.push(reason),
    registerCredit: (_viewer, credit) => credited.push(credit?.key),
    credit: { key: 'noaa-swpc-aurora', html: 'NOAA SWPC' },
    now: () => T0,
  });
  const viewer = {};
  return { layer, requests, renders, credited, rendering, state, viewer };
}

async function enabled(h) {
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  return h.layer.update(h.viewer, {});
}

const rowText = (layer) =>
  new DataLayerManager({})._buildMetaText({
    source: layer.source,
    stats: layer.getStats(),
    enabled: true,
    lifecycleState: 'enabled',
  });

test('Aurora Forecast identifies itself and checks the proxy every five minutes', () => {
  const { layer } = harness();
  assert.deepEqual(
    [
      layer.id,
      layer.name,
      layer.source,
      layer.updateInterval,
      layer.refreshInterval,
    ],
    ['aurora-forecast', 'Aurora Forecast', 'NOAA SWPC', 0, 300_000],
  );
  assert.equal(AURORA_REFRESH_MS, 300_000);
  assert.equal(AURORA_ENDPOINT, '/api/aurora');
});

test('enabling credits SWPC and draws the forecast bands with the aurora colours', async () => {
  const h = harness();
  assert.equal(await enabled(h), true);
  assert.deepEqual(h.credited, ['noaa-swpc-aurora']);
  assert.equal(h.requests[0].url, '/api/aurora');
  assert.ok(h.requests[0].signal instanceof AbortSignal);
  assert.equal(h.rendering.options.id, 'aurora-forecast');
  assert.deepEqual(h.rendering.options.levels, AURORA_BAND_LEVELS);
  assert.deepEqual(h.rendering.bands, BANDS);
  assert.equal(h.rendering.show, true);
  assert.ok(h.renders.includes('aurora-forecast'));
  assert.deepEqual(h.layer.getStats(), {
    count: 2,
    lastUpdate: T0,
    loadingLabel: 'Peak 12% · forecast 12:36 UTC',
  });
  assert.equal(rowText(h.layer), 'NOAA SWPC · Peak 12% · forecast 12:36 UTC');
});

test('every refresh asks the proxy again; failures keep the last bands and report on the row', async () => {
  const h = harness();
  await enabled(h);
  h.state.answer = () => new Response('{}', { status: 502 });
  assert.equal(await h.layer.update(h.viewer, {}), true);
  assert.equal(h.requests.length, 2);
  assert.deepEqual(h.rendering.bands, BANDS);
  assert.deepEqual(h.layer.getStats(), {
    stale: true,
    count: 2,
    lastUpdate: T0,
    error: 'Aurora forecast refresh failed',
  });

  const cold = harness(() => Response.json({ bands: 'nope' }));
  assert.equal(await enabled(cold), true);
  assert.deepEqual(cold.layer.getStats(), {
    count: 0,
    lastUpdate: null,
    error: 'Aurora forecast unavailable',
  });

  const stale = harness(() => Response.json(payload({ stale: true })));
  await enabled(stale);
  assert.equal(stale.layer.getStats().stale, true);
  assert.match(rowText(stale.layer), /^STALE · NOAA SWPC · /);

  const aborted = new AbortController();
  aborted.abort();
  assert.equal(
    await h.layer.update(h.viewer, { signal: aborted.signal }),
    false,
  );
});

test('disabling hides and clears the bands; destroy releases the rendering', async () => {
  const h = harness();
  await enabled(h);
  h.layer.disable();
  assert.equal(h.rendering.show, false);
  assert.equal(h.rendering.cleared, 1);
  assert.equal(
    await h.layer.update(h.viewer, {}),
    false,
    'a disabled layer does not fetch',
  );
  h.layer.destroy();
  assert.equal(h.rendering.destroyed, true);
});
