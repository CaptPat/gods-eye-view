import test from 'node:test';
import assert from 'node:assert/strict';
import {
  QUERY_REUSE_MS,
  REQUEST_DEBOUNCE_MS,
  createOsmInfrastructureLayer,
} from './layer.js';

const META = Object.freeze({
  id: 'transmission-lines',
  name: 'Transmission Lines',
  icon: '🗼',
  source: 'OpenStreetMap',
  color: '#fb5607',
  selectedSourceId: 'transmission-lines-selected',
  zoomMessage: 'Zoom in to load power lines',
  loadingLabel: 'loading power lines',
  emptyMessage: 'No mapped power lines here',
  saturatedMessage: 'Showing the first lines — zoom in for all',
});
const QUERY = {
  selectors: ['way["power"="line"]', 'node["power"="substation"]'],
  cap: 3,
  maxViewDegrees: 1.5,
};
const LINE_ELEMENT = {
  type: 'way',
  id: 1,
  tags: { power: 'line' },
  geometry: [
    { lat: 30.1, lon: -97.1 },
    { lat: 30.2, lon: -97.2 },
  ],
};
const NODE_ELEMENT = {
  type: 'node',
  id: 2,
  lat: 30.15,
  lon: -97.15,
  tags: { power: 'substation', name: 'North' },
};
const SMALL = { south: 30.02, west: -97.33, north: 30.41, east: -96.98 };
const ELSEWHERE = { south: 32.02, west: -97.33, north: 32.41, east: -96.98 };
const CREDIT = { key: 'osm', html: 'OSM' };
const flush = () => new Promise((resolve) => setImmediate(resolve));

function harness(overrides = {}) {
  const state = {
    rect: SMALL,
    elements: [LINE_ELEMENT, NODE_ELEMENT],
    stale: false,
    fetchError: null,
    hang: false,
    clock: 1_000_000,
    timers: [],
    fetches: [],
    renders: [],
    visible: [],
    selected: [],
    entries: [],
    cleared: [],
    opened: [],
    credits: [],
    owners: new Map(),
    pick: null,
    hit: false,
    moveEnd: null,
    click: null,
    ...overrides,
  };
  const rendering = {
    render: (features) => state.renders.push(features),
    featureIdFromPick: (picked) => picked?.featureId ?? null,
    positionOf: (id) => ({ anchorFor: id }),
    setSelected: (id) => state.selected.push(id),
    setVisible: (visible) => state.visible.push(visible),
    clear: () => state.renders.push('clear'),
    destroy: () => state.renders.push('destroy'),
  };
  const source = {
    fetch(query, signal) {
      state.fetches.push({ query, signal });
      if (state.hang)
        return new Promise((_, reject) =>
          signal.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          ),
        );
      if (state.fetchError) return Promise.reject(state.fetchError);
      return Promise.resolve({ elements: state.elements, stale: state.stale });
    },
  };
  const viewer = {
    camera: {
      moveEnd: {
        addEventListener(listener) {
          state.moveEnd = listener;
          return () => {
            state.moveEnd = null;
          };
        },
      },
    },
    scene: { pick: () => state.pick },
  };
  const layer = createOsmInfrastructureLayer({
    meta: META,
    query: QUERY,
    classifyLine: (tags) =>
      tags.power === 'line'
        ? { kind: 'line', color: '#ffffff', width: 2 }
        : null,
    classifyPoint: (tags) =>
      tags.power === 'substation'
        ? { kind: 'substation', color: '#cccccc', pixelSize: 6 }
        : null,
    buildCard: (feature) => ({
      title: feature.tags.name ?? 'Power line',
      details: [feature.kind],
      url: `https://www.openstreetmap.org/${feature.id}`,
      accessibilityLabel: `Open ${feature.id}`,
    }),
    legend: [{ label: 'Lines', color: '#ffffff' }],
    source,
    overlayHost: {
      setEntries: (id, entries) => state.entries.push({ id, entries }),
      setVisible: () => {},
      clearSource: (id) => state.cleared.push(id),
      hitTest: () => state.hit,
    },
    picking: {
      registerPickOwner: (id, owns) => state.owners.set(id, owns),
      unregisterPickOwner: (id) => state.owners.delete(id),
      resolvePickId: (picked) => picked?.otherId ?? null,
      isOwnedByOtherLayer: (_layerId, id) => id.startsWith('flights:'),
    },
    registerCredit: (_viewer, credit) => state.credits.push(credit),
    credit: CREDIT,
    openUrl: (url) => state.opened.push(url),
    viewRectangle: () => state.rect,
    pickAnchor: () => ({ ground: true }),
    createRendering: () => rendering,
    createClickHandler: (_viewer, onClick) => {
      state.click = onClick;
      return {
        destroy: () => {
          state.click = null;
        },
      };
    },
    timers: {
      setTimeout: (fn, ms) => state.timers.push({ fn, ms }),
      clearTimeout: (handle) => {
        if (state.timers[handle - 1]) state.timers[handle - 1].cancelled = true;
      },
    },
    now: () => state.clock,
    documentTarget: null,
  });
  layer.init(viewer);
  layer.enable(viewer);
  return { layer, state };
}

test('a view too large, or looking past the horizon, asks to zoom in without fetching', async () => {
  for (const rect of [{ south: 29, west: -99, north: 31, east: -96 }, null]) {
    const { layer, state } = harness({ rect });
    assert.equal(await layer.update(), true);
    assert.equal(state.fetches.length, 0);
    assert.deepEqual(layer.getStats(), {
      status: 'zoom-in',
      statusMessage: META.zoomMessage,
      count: 0,
      lastUpdate: null,
    });
  }
});

test('a small view fetches its snapped box, draws classified features and reports saturation and staleness', async () => {
  const { layer, state } = harness();
  assert.equal(layer.id, META.id);
  assert.deepEqual(state.credits, [CREDIT]);
  await layer.update();
  assert.equal(
    state.fetches[0].query,
    '[out:json][timeout:25];(way["power"="line"](30,-97.35,30.45,-96.95);node["power"="substation"](30,-97.35,30.45,-96.95););out tags geom 3;',
  );
  const [{ lines, points }] = state.renders;
  assert.deepEqual(
    [lines.map((line) => line.id), points.map((point) => point.id)],
    [['way/1'], ['node/2']],
  );
  assert.deepEqual(layer.getStats(), {
    count: 2,
    lastUpdate: 1_000_000,
    stale: false,
    saturated: false,
    loadingLabel: '',
  });

  const capped = harness({
    elements: [
      LINE_ELEMENT,
      NODE_ELEMENT,
      { type: 'node', id: 3, lat: 30, lon: -97, tags: {} },
    ],
    stale: true,
  });
  await capped.layer.update();
  assert.deepEqual(capped.layer.getStats(), {
    count: 2,
    lastUpdate: 1_000_000,
    stale: true,
    saturated: true,
    loadingLabel: META.saturatedMessage,
  });

  const empty = harness({ elements: [] });
  await empty.layer.update();
  assert.deepEqual(empty.layer.getStats(), {
    status: 'empty',
    statusMessage: META.emptyMessage,
    count: 0,
    lastUpdate: 1_000_000,
  });
});

test('views inside the last box reuse it for ten minutes; camera moves are debounced', async () => {
  const { layer, state } = harness();
  await layer.update();
  state.rect = { south: 30.05, west: -97.3, north: 30.4, east: -97 };
  await layer.update();
  assert.equal(state.fetches.length, 1);
  state.clock += QUERY_REUSE_MS + 1;
  await layer.update();
  assert.equal(state.fetches.length, 2);

  state.rect = ELSEWHERE;
  state.moveEnd();
  state.moveEnd();
  assert.equal(state.timers.length, 2);
  assert.equal(state.timers[0].cancelled, true);
  assert.equal(state.timers[1].ms, REQUEST_DEBOUNCE_MS);
  state.timers[1].fn();
  await flush();
  assert.equal(state.fetches.length, 3);
});

test('failures keep drawn features and report the error; disabling aborts quietly', async () => {
  const { layer, state } = harness();
  await layer.update();
  state.rect = ELSEWHERE;
  state.fetchError = new Error('Overpass timed out');
  await layer.update();
  assert.equal(state.renders.length, 1);
  assert.deepEqual(layer.getStats(), {
    stale: true,
    count: 2,
    lastUpdate: 1_000_000,
    error: 'Overpass timed out',
  });

  const failing = harness({ fetchError: new Error('Overpass rate-limited') });
  await failing.layer.update();
  assert.deepEqual(failing.layer.getStats(), {
    count: 0,
    lastUpdate: null,
    error: 'Overpass rate-limited',
  });

  const hanging = harness({ hang: true });
  const pending = hanging.layer.update();
  assert.equal(hanging.layer.getStats().loading, true);
  hanging.layer.disable();
  await pending;
  assert.equal(hanging.state.fetches[0].signal.aborted, true);
  assert.deepEqual(hanging.layer.getStats(), { count: 0, lastUpdate: null });
});

test('clicking a feature opens its card; the card opens OpenStreetMap; empty space clears it', async () => {
  const { layer, state } = harness();
  await layer.update();
  const owns = state.owners.get(META.id);
  assert.equal(owns('transmission-lines:way/1'), true);
  assert.equal(owns('oil-gas:way/1'), false);

  state.pick = { featureId: 'node/2' };
  state.click({ x: 5, y: 6 });
  assert.deepEqual(state.selected, ['node/2']);
  let [entry] = state.entries.at(-1).entries;
  assert.equal(state.entries.at(-1).id, META.selectedSourceId);
  assert.equal(entry.title, 'North');
  assert.deepEqual(entry.details, ['substation']);
  assert.equal(entry.accent, META.color);
  assert.deepEqual(entry.position, { anchorFor: 'node/2' });
  assert.equal(entry.activate(), true);
  assert.deepEqual(state.opened, ['https://www.openstreetmap.org/node/2']);

  state.hit = true;
  state.click({ x: 5, y: 6 });
  assert.equal(state.opened.length, 2);
  state.hit = false;

  state.pick = { featureId: 'way/1' };
  state.click({ x: 7, y: 8 });
  [entry] = state.entries.at(-1).entries;
  assert.equal(entry.title, 'Power line');
  assert.deepEqual(
    entry.position,
    { ground: true },
    'a line card sits where it was clicked',
  );

  state.pick = { otherId: 'flights:abc' };
  state.click({ x: 1, y: 1 });
  assert.equal(state.selected.at(-1), 'way/1');
  assert.deepEqual(state.cleared, []);

  state.rect = ELSEWHERE;
  state.elements = [NODE_ELEMENT];
  await layer.update();
  assert.deepEqual(
    state.cleared,
    [META.selectedSourceId],
    'a card whose feature left the data closes',
  );
  assert.equal(state.selected.at(-1), null);

  state.pick = { featureId: 'node/2' };
  state.click({ x: 5, y: 6 });
  state.pick = null;
  state.click({ x: 9, y: 9 });
  assert.equal(state.cleared.length, 2);
});

test('disabling clears the scene, the pick owner and the click handler; the legend lists styles', async () => {
  const { layer, state } = harness();
  await layer.update();
  assert.deepEqual(layer.getRowControls(), {
    legend: [{ label: 'Lines', color: '#ffffff', count: 1 }],
  });
  layer.disable();
  assert.equal(state.renders.at(-1), 'clear');
  assert.equal(state.visible.at(-1), false);
  assert.equal(state.owners.has(META.id), false);
  assert.equal(state.click, null);
  assert.deepEqual(layer.getStats(), { count: 0, lastUpdate: null });
  state.moveEnd();
  assert.equal(state.timers.length, 0, 'a disabled layer ignores camera moves');
  layer.destroy();
  assert.equal(state.moveEnd, null);
  assert.equal(state.renders.at(-1), 'destroy');
});
