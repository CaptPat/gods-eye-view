import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CARD_FAILED,
  CARD_LOADING,
  SELECTED_SOURCE_OPTIONS,
  STATION_LIST_MAX_AGE_MS,
  STATION_REFRESH_CHECK_MS,
  createCurrentStationsLayer,
  createTideStationsLayer,
} from './index.js';
import { SELECTED_PIXEL_SIZE } from './points.js';
import { DataLayerManager } from '../../data/manager.js';
import defaultLayers, {
  currentStationsLayer,
  tideStationsLayer,
} from '../../data/tides.js';
import { NOAA_COOPS_CREDIT } from '../../data/dataCredits.js';
import {
  normalizeCurrentStations,
  normalizeCurrents,
  normalizeHilo,
  normalizeTideStations,
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
const TIDES = normalizeTideStations(fixture('mdapi-waterlevels.json'));
const CURRENTS = normalizeCurrentStations(
  fixture('mdapi-currentpredictions.json'),
  TIDES,
);

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

function currentReport(id = 'ACT1616') {
  return {
    id,
    kind: 'current',
    bin: 1,
    generatedAt: T0,
    sources: { predictions: 'ok' },
    ...normalizeCurrents(fixture('datagetter-currents-ACT1616-bin1.json')),
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fakeOverlay() {
  const state = {
    entries: new Map(),
    options: new Map(),
    visible: new Map(),
    hit: null,
  };
  return {
    state,
    setEntries(sourceId, entries, options) {
      state.entries.set(sourceId, entries);
      state.options.set(sourceId, options);
    },
    clearSource(sourceId) {
      state.entries.delete(sourceId);
    },
    setVisible(sourceId, visible) {
      state.visible.set(sourceId, visible);
    },
    hitTest: () => state.hit,
  };
}

function harness(kind, { answers = {} } = {}) {
  const overlay = fakeOverlay();
  const requests = [];
  const renders = [];
  const opened = [];
  const credited = [];
  const clock = { now: T0 };
  const storage = {
    value: null,
    getItem: (key) =>
      key === 'gev.weatherReport.units' ? storage.value : null,
  };
  const documentTarget = new EventTarget();
  const primitives = [];
  const pick = { result: null };
  const viewer = {
    scene: {
      primitives: {
        add: (primitive) => {
          primitives.push(primitive);
          return primitive;
        },
        remove: (primitive) => {
          primitives.splice(primitives.indexOf(primitive), 1);
          return true;
        },
      },
      pick: () => pick.result,
    },
  };
  const click = { handler: null, destroyed: 0 };
  const table = {
    '/api/tides/stations?kind=tide': () => ({
      kind: 'tide',
      stations: TIDES,
      generatedAt: T0,
      stale: false,
    }),
    '/api/tides/stations?kind=current': () => ({
      kind: 'current',
      stations: CURRENTS,
      generatedAt: T0,
      stale: false,
    }),
    '/api/tides/tide?id=8454000': () => tideReport(),
    '/api/tides/current?id=ACT1616&bin=1': () => currentReport(),
    ...answers,
  };
  const options = {
    overlayHost: overlay,
    fetchImpl: async (url) => {
      requests.push(url);
      const answer = table[url];
      if (!answer) throw new Error(`unexpected ${url}`);
      const value = await answer();
      return value instanceof Response ? value : Response.json(value);
    },
    createClickHandler: (_viewer, onClick) => {
      click.handler = onClick;
      return {
        destroy: () => {
          click.destroyed += 1;
        },
      };
    },
    requestRender: (reason) => renders.push(reason),
    registerCredit: (_viewer, credit) => credited.push(credit?.key),
    credit: { key: 'noaa-coops', html: 'NOAA' },
    storage,
    openUrl: (url) => opened.push(url),
    documentTarget,
    now: () => clock.now,
  };
  const layer =
    kind === 'tide'
      ? createTideStationsLayer(options)
      : createCurrentStationsLayer(options);
  const setPick = (id) => {
    pick.result = id ? { primitive: { id } } : null;
  };
  const pointFor = (id) => {
    const collection = primitives[0];
    for (let i = 0; i < collection.length; i += 1)
      if (collection.get(i).id === id) return collection.get(i);
    return null;
  };
  return {
    layer,
    overlay,
    requests,
    renders,
    opened,
    credited,
    clock,
    storage,
    documentTarget,
    viewer,
    primitives,
    click,
    table,
    setPick,
    pointFor,
  };
}

async function enabled(h) {
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  assert.equal(await h.layer.update(h.viewer, {}), true);
}

/** The row text the Layers panel renders for this layer's current stats. */
const rowText = (layer) =>
  new DataLayerManager({})._buildMetaText({
    source: layer.source,
    stats: layer.getStats(),
    enabled: true,
    lifecycleState: 'enabled',
  });

test('both layers identify themselves and refresh hourly; the default instances carry the NOAA credit', () => {
  const tide = harness('tide').layer;
  const current = harness('current').layer;
  assert.deepEqual(
    [tide.id, tide.name, tide.icon, tide.source],
    ['tide-stations', 'Tide Stations', '🌊', 'NOAA CO-OPS'],
  );
  assert.deepEqual(
    [current.id, current.name, current.icon, current.source],
    ['current-stations', 'Current Stations', '🧭', 'NOAA CO-OPS'],
  );
  assert.equal(tide.updateInterval, 0);
  assert.equal(tide.refreshInterval, STATION_REFRESH_CHECK_MS);
  assert.equal(STATION_REFRESH_CHECK_MS, 3_600_000);
  assert.equal(STATION_LIST_MAX_AGE_MS, 21_600_000);
  assert.deepEqual(
    defaultLayers.map((layer) => layer.id),
    ['tide-stations', 'current-stations'],
  );
  assert.equal(tideStationsLayer, defaultLayers[0]);
  assert.equal(currentStationsLayer, defaultLayers[1]);
  assert.equal(
    NOAA_COOPS_CREDIT.html,
    'Tides and currents: <a href="https://tidesandcurrents.noaa.gov/" target="_blank" rel="noopener">NOAA CO-OPS</a>',
  );
  assert.throws(() => createTideStationsLayer({}), /overlay host/);
});

test('enabling credits NOAA, loads the station list into points and requests a render', async () => {
  const h = harness('tide');
  await enabled(h);
  assert.deepEqual(h.credited, ['noaa-coops']);
  assert.deepEqual(h.requests, ['/api/tides/stations?kind=tide']);
  assert.equal(h.primitives[0].length, 12);
  assert.equal(h.primitives[0].show, true);
  assert.ok(h.renders.includes('tide-stations'));
  assert.equal(h.overlay.state.visible.get('tide-stations-selected'), true);
  assert.deepEqual(h.layer.getStats(), { count: 12, lastUpdate: T0 });
  assert.match(rowText(h.layer), /^NOAA CO-OPS · /);
});

test('the list is refetched only after six hours, and failures report on the row without failing the layer', async () => {
  const h = harness('tide');
  await enabled(h);
  assert.equal(await h.layer.update(h.viewer, {}), true);
  assert.equal(h.requests.length, 1, 'a fresh list costs no request');
  h.clock.now += STATION_LIST_MAX_AGE_MS;
  h.table['/api/tides/stations?kind=tide'] = () =>
    new Response('{}', { status: 502 });
  assert.equal(await h.layer.update(h.viewer, {}), true);
  assert.equal(h.requests.length, 2);
  assert.deepEqual(h.layer.getStats(), {
    stale: true,
    count: 12,
    lastUpdate: T0,
    error: 'Station list refresh failed',
  });
  assert.equal(
    rowText(h.layer),
    'STALE · NOAA CO-OPS · Station list refresh failed',
  );
  assert.equal(
    h.primitives[0].length,
    12,
    'the last good stations stay on the globe',
  );

  const cold = harness('current', {
    answers: {
      '/api/tides/stations?kind=current': () =>
        new Response('{}', { status: 502 }),
    },
  });
  await enabled(cold);
  assert.deepEqual(cold.layer.getStats(), {
    count: 0,
    lastUpdate: null,
    error: 'Station list unavailable',
  });
  assert.equal(
    rowText(cold.layer),
    'UNAVAILABLE · NOAA CO-OPS · Station list unavailable',
  );

  const staleList = harness('tide', {
    answers: {
      '/api/tides/stations?kind=tide': () => ({
        kind: 'tide',
        stations: TIDES,
        generatedAt: T0,
        stale: true,
      }),
    },
  });
  await enabled(staleList);
  assert.deepEqual(staleList.layer.getStats(), {
    stale: true,
    count: 12,
    lastUpdate: T0,
  });
  assert.match(rowText(staleList.layer), /^STALE · NOAA CO-OPS · /);

  const gate = deferred();
  const slow = harness('tide', {
    answers: { '/api/tides/stations?kind=tide': () => gate.promise },
  });
  slow.layer.init(slow.viewer);
  slow.layer.enable(slow.viewer);
  const pending = slow.layer.update(slow.viewer, {});
  assert.equal(rowText(slow.layer), 'NOAA CO-OPS · Loading stations');
  gate.resolve({
    kind: 'tide',
    stations: TIDES,
    generatedAt: T0,
    stale: false,
  });
  assert.equal(await pending, true);

  const aborted = new AbortController();
  aborted.abort();
  assert.equal(
    await slow.layer.update(slow.viewer, { signal: aborted.signal }),
    false,
    'only a manager abort is a failure',
  );
});

test('clicking a tide station shows a loading card, then the NOAA report in the preferred units', async () => {
  const h = harness('tide');
  await enabled(h);
  h.storage.value = 'metric';
  h.setPick('tide-stations:8454000');
  const settled = h.click.handler({ x: 10, y: 20 });
  const [loading] = h.overlay.state.entries.get('tide-stations-selected');
  assert.equal(loading.id, 'tide-stations:8454000');
  assert.equal(loading.title, 'Providence · 8454000');
  assert.deepEqual(loading.details, [CARD_LOADING]);
  assert.equal(loading.variant, 'selected');
  assert.equal(loading.protected, true);
  assert.equal(loading.interactive, true);
  assert.equal(loading.accessibilityLabel, 'Open NOAA page for Providence');
  assert.equal(
    h.overlay.state.options.get('tide-stations-selected'),
    SELECTED_SOURCE_OPTIONS,
  );
  assert.equal(
    h.pointFor('tide-stations:8454000').pixelSize,
    SELECTED_PIXEL_SIZE,
  );
  const rendersBefore = h.renders.length;
  await settled;
  assert.equal(h.requests.at(-1), '/api/tides/tide?id=8454000');
  const [card] = h.overlay.state.entries.get('tide-stations-selected');
  assert.equal(card.details.length, 6);
  assert.equal(card.details[0], 'Low 0.12 m · Mon 16:11 EDT');
  assert.ok(rendersBefore > 2, 'selection restyling requested a render');
  card.activate();
  assert.deepEqual(h.opened, [
    'https://tidesandcurrents.noaa.gov/stationhome.html?id=8454000',
  ]);
  h.overlay.state.hit = {
    sourceId: 'tide-stations-selected',
    entryId: 'tide-stations:8454000',
  };
  h.click.handler({ x: 10, y: 20 });
  assert.equal(
    h.opened.length,
    2,
    'a click on the card opens the station page',
  );
});

test('current cards use the lowest bin, a newer click supersedes an older one, and a failed report says so', async () => {
  const gate = deferred();
  const h = harness('current', {
    answers: {
      '/api/tides/current?id=HAI1103&bin=1': () => gate.promise,
      '/api/tides/current?id=PCT0016&bin=1': () =>
        new Response('{}', { status: 502 }),
    },
  });
  await enabled(h);
  h.setPick('current-stations:HAI1103');
  const first = h.click.handler({ x: 1, y: 1 });
  h.setPick('current-stations:ACT1616');
  await h.click.handler({ x: 2, y: 2 });
  gate.resolve(currentReport('HAI1103'));
  await first;
  assert.ok(h.requests.includes('/api/tides/current?id=HAI1103&bin=1'));
  const [card] = h.overlay.state.entries.get('current-stations-selected');
  assert.equal(card.id, 'current-stations:ACT1616');
  assert.equal(card.details[1], 'Flood 2.0 kn NE (37°) · Mon 21:45 EDT');
  card.activate();
  assert.deepEqual(h.opened, [
    'https://tidesandcurrents.noaa.gov/noaacurrents/predictions?id=ACT1616_1',
  ]);
  h.setPick('current-stations:PCT0016');
  await h.click.handler({ x: 3, y: 3 });
  assert.deepEqual(
    h.overlay.state.entries.get('current-stations-selected')[0].details,
    [CARD_FAILED],
  );
});

test('empty clicks and Escape clear the card; disable hides everything and re-enabling needs no refetch', async () => {
  const h = harness('tide');
  await enabled(h);
  h.setPick('tide-stations:8454000');
  await h.click.handler({ x: 1, y: 1 });
  h.setPick(null);
  h.click.handler({ x: 5, y: 5 });
  assert.equal(h.overlay.state.entries.has('tide-stations-selected'), false);
  assert.equal(
    h.pointFor('tide-stations:8454000').pixelSize < SELECTED_PIXEL_SIZE,
    true,
  );
  h.setPick('tide-stations:8454000');
  await h.click.handler({ x: 1, y: 1 });
  h.documentTarget.dispatchEvent(
    Object.assign(new Event('keydown'), { key: 'Escape' }),
  );
  assert.equal(h.overlay.state.entries.has('tide-stations-selected'), false);

  h.layer.disable(h.viewer);
  assert.equal(h.primitives[0].show, false);
  assert.equal(h.primitives[0].length, 0);
  assert.equal(h.click.destroyed, 1);
  assert.equal(h.overlay.state.visible.get('tide-stations-selected'), false);
  assert.equal(
    h.click.handler({ x: 1, y: 1 }),
    undefined,
    'a disabled layer ignores clicks',
  );

  h.layer.enable(h.viewer);
  assert.equal(await h.layer.update(h.viewer, {}), true);
  assert.equal(
    h.requests.filter((url) => url.startsWith('/api/tides/stations')).length,
    1,
  );
  assert.equal(h.primitives[0].length, 12);
  h.layer.destroy(h.viewer);
  assert.equal(h.primitives.length, 0);
});

test('a storage failure falls back to imperial units', async () => {
  const h = harness('tide');
  h.storage.getItem = () => {
    throw new Error('denied');
  };
  await enabled(h);
  h.setPick('tide-stations:8454000');
  await h.click.handler({ x: 1, y: 1 });
  assert.equal(
    h.overlay.state.entries.get('tide-stations-selected')[0].details[0],
    'Low 0.4 ft · Mon 16:11 EDT',
  );
});
