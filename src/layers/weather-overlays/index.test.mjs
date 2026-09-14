import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REFRESH_MS,
  SWAP_CHECK_MS,
  createWeatherOverlaysLayer,
} from './index.js';
import defaultLayer from '../../data/weatherOverlays.js';
import {
  GOOGLE_AIR_QUALITY_CREDIT,
  GOOGLE_POLLEN_CREDIT,
  NOAA_GFS_CREDIT,
  NOAA_GMGSI_CREDIT,
} from '../../data/dataCredits.js';
import { LayerPanel } from '../../ui/layerPanel.js';

const T15 = Date.UTC(2026, 8, 14, 15);
const T16 = Date.UTC(2026, 8, 14, 16);
const NOW = Date.UTC(2026, 8, 14, 16, 20);

function fakeImagery() {
  const calls = [];
  const ready = new Set();
  const layers = new Set();
  let shown = null;
  let source = null;
  const api = {
    setSource(next) {
      calls.push(['setSource', next]);
      if (next !== source) {
        layers.clear();
        ready.clear();
        shown = null;
      }
      source = next;
    },
    preload(times) {
      calls.push(['preload', [...times]]);
      for (const time of times) layers.add(time);
    },
    show(time) {
      calls.push(['show', time]);
      layers.add(time);
      shown = time;
    },
    setAlpha(alpha) {
      calls.push(['setAlpha', alpha]);
    },
    release(keep) {
      calls.push(['release', [...keep]]);
      for (const time of [...layers])
        if (!keep.includes(time)) layers.delete(time);
    },
    isReady: (time) => ready.has(time),
    readyCount: () => [...layers].filter((time) => ready.has(time)).length,
    shownTime: () => shown,
    clear() {
      calls.push(['clear']);
      layers.clear();
      shown = null;
    },
    reseat() {
      calls.push(['reseat']);
    },
    destroy() {
      calls.push(['destroy']);
    },
  };
  return { api, calls, ready, layers, source: () => source };
}

function fakeTimers() {
  let pending = [];
  return {
    setTimeout(fn, ms) {
      const timer = { fn, ms };
      pending.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      pending = pending.filter((t) => t !== timer);
    },
    delays: () => pending.map((t) => t.ms),
    run(ms) {
      const timer = pending.find((t) => t.ms === ms);
      assert.ok(timer, `no pending ${ms} ms timer`);
      pending = pending.filter((t) => t !== timer);
      timer.fn();
    },
  };
}

const manifest = (mode, time, extra = {}) => ({
  mode,
  googleConfigured: true,
  available: true,
  time,
  stale: false,
  ...extra,
});

/** Answers are keyed by the manifest `mode` query; an answer may be an Error, a Promise, or `{ status, body }`. */
function harness({ answers = {}, visible = true } = {}) {
  const imagery = fakeImagery();
  const timers = fakeTimers();
  const credited = [];
  const requests = [];
  const renderRequests = [];
  const events = new EventTarget();
  const clock = { now: NOW, visible };
  const table = {
    clouds: manifest('clouds', T15),
    temperature: manifest('temperature', T15),
    'air-quality': manifest('air-quality', T16),
    'pollen-tree': manifest('pollen-tree', T16),
    'pollen-grass': manifest('pollen-grass', T16),
    'pollen-weed': manifest('pollen-weed', T16),
    ...answers,
  };
  const layer = createWeatherOverlaysLayer({
    fetchImpl: async (url) => {
      requests.push(url);
      const answer =
        await table[new URL(url, 'http://app.local').searchParams.get('mode')];
      if (answer instanceof Error) throw answer;
      if (answer?.status)
        return Response.json(answer.body, { status: answer.status });
      return Response.json(answer);
    },
    createImagery: () => imagery.api,
    registerCredit: (_viewer, credit) => credited.push(credit.key),
    credits: {
      clouds: { key: 'clouds' },
      temperature: { key: 'temperature' },
      'air-quality': { key: 'air-quality' },
      pollen: { key: 'pollen' },
    },
    eventTarget: events,
    isVisible: () => clock.visible,
    timers,
    now: () => clock.now,
    requestRender: (reason) => renderRequests.push(reason),
  });
  return {
    layer,
    imagery,
    timers,
    credited,
    requests,
    renderRequests,
    events,
    clock,
    table,
    viewer: {},
  };
}

async function enabled(h) {
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  await h.layer.update(h.viewer, {});
}

test('the layer identifies itself, refreshes every ten minutes and ships real credits', () => {
  const { layer } = harness();
  assert.equal(layer.id, 'weather-overlays');
  assert.equal(layer.name, 'Weather Overlays');
  assert.equal(layer.icon, '🌡️');
  assert.equal(layer.updateInterval, REFRESH_MS);
  assert.equal(REFRESH_MS, 600_000);
  assert.equal(defaultLayer.id, 'weather-overlays');
  assert.equal(
    NOAA_GMGSI_CREDIT.html,
    'Clouds: <a href="https://nowcoast.noaa.gov/" target="_blank" rel="noopener">NOAA nowCOAST</a> GMGSI geostationary satellite mosaic',
  );
  assert.equal(
    NOAA_GFS_CREDIT.html,
    'Temperature: NOAA NCEP GFS via <a href="https://pae-paha.pacioos.hawaii.edu/erddap/griddap/ncep_global.html" target="_blank" rel="noopener">PacIOOS ERDDAP</a>',
  );
  assert.equal(
    GOOGLE_AIR_QUALITY_CREDIT.html,
    'Air quality overlay: Source: Includes air quality data from Google',
  );
  assert.equal(
    GOOGLE_POLLEN_CREDIT.html,
    'Pollen overlay: Source: Includes pollen data from Google',
  );
});

test('enabling credits the mode, fetches its manifest and shows the cloud image with its age', async () => {
  const h = harness();
  await enabled(h);
  assert.deepEqual(h.credited, ['clouds']);
  assert.deepEqual(h.requests, ['/api/weather-overlays/manifest?mode=clouds']);
  assert.equal(h.imagery.source(), 'clouds');
  assert.equal(h.imagery.api.shownTime(), T15);
  assert.deepEqual(h.layer.getStats(), {
    status: 'ok',
    source: 'NOAA GMGSI satellite · 15:00 UTC · 80 min old',
    lastUpdate: NOW,
    countLabel: 'CLOUDS',
  });
  assert.ok(h.renderRequests.includes('weather-overlays'));
});

test('temperature shows its model valid time and the temperature legend', async () => {
  const h = harness();
  assert.notEqual(
    h.layer.setParams({ mode: 'temperature' }, { origin: 'local-restore' }),
    false,
  );
  await enabled(h);
  assert.deepEqual(h.credited, ['temperature']);
  assert.equal(h.layer.getStats().source, 'NOAA GFS model · valid 15:00 UTC');
  assert.equal(h.layer.getStats().countLabel, 'TEMP');
  assert.equal(h.layer.getRowControls().legend[0].label, '-30°C');
});

test('switching mode clears imagery, credits the new source and refetches; pollen type changes the key', async () => {
  const h = harness();
  await enabled(h);
  const renders = h.renderRequests.length;
  assert.notEqual(
    h.layer.setParams({ mode: 'pollen' }, { origin: 'user' }),
    false,
  );
  assert.equal(h.imagery.source(), 'pollen-tree');
  assert.equal(
    h.imagery.api.shownTime(),
    null,
    'the old mode is cleared at once',
  );
  assert.ok(h.renderRequests.length > renders, 'clearing requests a render');
  assert.deepEqual(h.credited, ['clouds', 'pollen']);
  assert.equal(
    h.requests.at(-1),
    '/api/weather-overlays/manifest?mode=pollen-tree',
  );
  assert.equal(await h.layer.update(h.viewer, {}), true);
  assert.equal(h.imagery.api.shownTime(), T16);
  assert.deepEqual(h.layer.getStats(), {
    status: 'ok',
    source: 'Google Pollen · Tree',
    lastUpdate: NOW,
    countLabel: 'POLLEN',
  });

  h.layer.setParams({ pollenType: 'grass' }, { origin: 'user' });
  assert.equal(h.imagery.source(), 'pollen-grass');
  assert.deepEqual(
    h.credited,
    ['clouds', 'pollen'],
    'same credit for another pollen type',
  );
  assert.equal(
    h.requests.at(-1),
    '/api/weather-overlays/manifest?mode=pollen-grass',
  );
  await h.layer.update(h.viewer, {});
  assert.deepEqual(h.layer.getParams(), {
    mode: 'pollen',
    pollenType: 'grass',
    opacity: 0.7,
  });

  assert.equal(h.layer.setParams({ mode: 'fog' }, { origin: 'user' }), false);
  assert.equal(
    h.layer.setParams({ pollenType: 'pine' }, { origin: 'user' }),
    false,
  );
  assert.equal(h.layer.setParams({ opacity: 0.5 }, { origin: 'user' }), false);
  const before = h.renderRequests.length;
  assert.notEqual(
    h.layer.setParams({ opacity: 0.4 }, { origin: 'user' }),
    false,
  );
  assert.deepEqual(
    h.imagery.calls.filter(([name]) => name === 'setAlpha').at(-1),
    ['setAlpha', 0.4],
  );
  assert.ok(
    h.renderRequests.length > before,
    'an alpha change requests a render',
  );
  assert.deepEqual(h.layer.getParams(), {
    mode: 'pollen',
    pollenType: 'grass',
    opacity: 0.4,
  });
});

test('a Google mode without a server key reports unavailable, draws nothing, and disables Google chips', async () => {
  const h = harness({
    answers: {
      'air-quality': {
        mode: 'air-quality',
        googleConfigured: false,
        available: false,
        reason: 'not-configured',
        time: null,
        stale: false,
      },
    },
  });
  h.layer.setParams({ mode: 'air-quality' }, { origin: 'share-restore' });
  await enabled(h);
  assert.deepEqual(h.layer.getStats(), {
    status: 'unavailable',
    source: 'Google Air Quality',
    error: 'Google Maps API key not configured',
    countLabel: 'AQI',
  });
  assert.equal(h.imagery.api.shownTime(), null);
  const chips = h.layer.getRowControls().chips;
  assert.equal(
    chips.find((chip) => chip.id === 'mode-air-quality').disabled,
    true,
  );
  assert.equal(chips.find((chip) => chip.id === 'mode-clouds').disabled, false);
});

test('loading, a hidden-tab skip, stale with an image, and unavailable without one', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const h = harness({ answers: { clouds: gate } });
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  const pending = h.layer.update(h.viewer, {});
  assert.deepEqual(h.layer.getStats(), {
    loading: true,
    source: 'NOAA GMGSI satellite',
    loadingLabel: 'Loading',
    countLabel: 'CLOUDS',
  });
  release(manifest('clouds', T15));
  assert.equal(await pending, true);
  assert.equal(h.layer.getStats().status, 'ok');

  h.clock.visible = false;
  assert.equal(
    await h.layer.update(h.viewer, {}),
    true,
    'a skipped refresh is not a failure',
  );
  assert.equal(h.requests.length, 1);

  h.clock.visible = true;
  h.table.clouds = new Error('offline');
  assert.equal(
    await h.layer.update(h.viewer, {}),
    true,
    'failures are reported through stats',
  );
  assert.deepEqual(h.layer.getStats(), {
    stale: true,
    source: 'NOAA GMGSI satellite · 15:00 UTC',
    error: 'Overlay source unavailable — showing 15:00 UTC',
    lastUpdate: NOW,
    countLabel: 'CLOUDS',
  });

  h.table.clouds = manifest('clouds', T15, { stale: true });
  await h.layer.update(h.viewer, {});
  assert.equal(h.layer.getStats().stale, true, 'a stale manifest reads stale');

  const cold = harness({
    answers: {
      clouds: {
        status: 502,
        body: { error: 'upstream unavailable', googleConfigured: false },
      },
    },
  });
  await enabled(cold);
  assert.deepEqual(cold.layer.getStats(), {
    status: 'unavailable',
    source: 'NOAA GMGSI satellite',
    error: 'Overlay source unavailable',
    countLabel: 'CLOUDS',
  });
  assert.equal(
    cold.layer.getRowControls().chips.find((chip) => chip.id === 'mode-pollen')
      .disabled,
    true,
    'key state is read from error bodies too',
  );
});

test('a newer image is shown only once its tiles are ready, and the delayed swap requests a render', async () => {
  const h = harness();
  await enabled(h);
  h.table.clouds = manifest('clouds', T16);
  h.clock.now = Date.UTC(2026, 8, 14, 17, 5);
  await h.layer.update(h.viewer, {});
  assert.equal(h.imagery.api.shownTime(), T15, 'still showing the older image');
  assert.ok(h.timers.delays().includes(SWAP_CHECK_MS));
  h.timers.run(SWAP_CHECK_MS);
  assert.equal(h.imagery.api.shownTime(), T15, 'not ready yet');
  assert.ok(h.timers.delays().includes(SWAP_CHECK_MS), 're-armed');
  h.imagery.ready.add(T16);
  const renders = h.renderRequests.length;
  h.timers.run(SWAP_CHECK_MS);
  assert.equal(h.imagery.api.shownTime(), T16);
  assert.deepEqual([...h.imagery.layers], [T16], 'the older image is released');
  assert.ok(h.renderRequests.length > renders);
});

test('Google 3D is reported from the attached controller and from map-stack events', async () => {
  const h = harness();
  let active = 'photoreal';
  h.layer.attachMapStack({ getActiveId: () => active });
  await enabled(h);
  assert.deepEqual(h.layer.getStats(), {
    status: 'idle',
    source: 'NOAA GMGSI satellite',
    statusMessage: 'Hidden by Google 3D map source',
    countLabel: 'CLOUDS',
  });
  active = 'esri-imagery';
  assert.equal(h.layer.getStats().status, 'ok');

  const evented = harness();
  await enabled(evented);
  evented.events.dispatchEvent(
    new CustomEvent('gev:map-stack-changed', {
      detail: { activeStack: { id: 'photoreal' } },
    }),
  );
  assert.equal(evented.layer.getStats().status, 'idle');
});

test('a map-stack change re-seats the overlay imagery and requests a render', async () => {
  const h = harness();
  await enabled(h);
  const renders = h.renderRequests.length;
  h.events.dispatchEvent(
    new CustomEvent('gev:map-stack-changed', {
      detail: { activeStack: { id: 'esri-imagery' } },
    }),
  );
  assert.deepEqual(h.imagery.calls.at(-1), ['reseat']);
  assert.ok(h.renderRequests.length > renders);
  assert.equal(h.renderRequests.at(-1), 'weather-overlays');
});

test('row listeners are notified; disable clears imagery with a render; destroy unsubscribes', async () => {
  const h = harness();
  let notified = 0;
  h.layer.setRowControlsListener(() => {
    notified += 1;
  });
  await enabled(h);
  assert.ok(notified > 0);
  const renders = h.renderRequests.length;
  h.layer.disable(h.viewer);
  assert.equal(h.imagery.calls.at(-1)[0], 'clear');
  assert.ok(h.renderRequests.length > renders);
  assert.equal(
    await h.layer.update(h.viewer, {}),
    false,
    'a disabled layer cannot refresh',
  );
  h.layer.destroy(h.viewer);
  assert.equal(h.imagery.calls.at(-1)[0], 'destroy');
  h.events.dispatchEvent(
    new CustomEvent('gev:map-stack-changed', {
      detail: { activeStack: { id: 'photoreal' } },
    }),
  );
  assert.notEqual(
    h.layer.getStats().status,
    'idle',
    'a destroyed layer no longer listens',
  );
});

/** The Layers row text, rendered by the real panel with a fixed "just now". */
function rowText(stats) {
  return LayerPanel.prototype._buildMetaText.call(
    { _timeAgo: () => 'just now' },
    {
      id: 'weather-overlays',
      source: 'NOAA GMGSI satellite',
      enabled: true,
      lifecycleState: 'enabled',
      stats,
    },
  );
}

test('the Layers panel renders every status shape as the spec states', async () => {
  const h = harness();
  await enabled(h);
  assert.equal(
    rowText(h.layer.getStats()),
    'NOAA GMGSI satellite · 15:00 UTC · 80 min old · just now',
  );
  h.table.clouds = new Error('offline');
  await h.layer.update(h.viewer, {});
  assert.equal(
    rowText(h.layer.getStats()),
    'STALE · NOAA GMGSI satellite · 15:00 UTC · Overlay source unavailable — showing 15:00 UTC',
  );

  const temperature = harness();
  temperature.layer.setParams(
    { mode: 'temperature' },
    { origin: 'local-restore' },
  );
  await enabled(temperature);
  assert.equal(
    rowText(temperature.layer.getStats()),
    'NOAA GFS model · valid 15:00 UTC · just now',
  );

  const keyless = harness({
    answers: {
      'air-quality': {
        mode: 'air-quality',
        googleConfigured: false,
        available: false,
        reason: 'not-configured',
        time: null,
        stale: false,
      },
    },
  });
  keyless.layer.setParams({ mode: 'air-quality' }, { origin: 'user' });
  await enabled(keyless);
  assert.equal(
    rowText(keyless.layer.getStats()),
    'UNAVAILABLE · Google Air Quality · Google Maps API key not configured',
  );

  const cold = harness({ answers: { clouds: new Error('offline') } });
  await enabled(cold);
  assert.equal(
    rowText(cold.layer.getStats()),
    'UNAVAILABLE · NOAA GMGSI satellite · Overlay source unavailable',
  );

  const loading = harness({ answers: { clouds: new Promise(() => {}) } });
  loading.layer.init(loading.viewer);
  loading.layer.enable(loading.viewer);
  void loading.layer.update(loading.viewer, {});
  assert.equal(
    rowText(loading.layer.getStats()),
    'NOAA GMGSI satellite · Loading',
  );

  const hidden = harness();
  hidden.layer.attachMapStack({ getActiveId: () => 'photoreal' });
  await enabled(hidden);
  assert.equal(
    rowText(hidden.layer.getStats()),
    'NOAA GMGSI satellite · Hidden by Google 3D map source',
  );
});
