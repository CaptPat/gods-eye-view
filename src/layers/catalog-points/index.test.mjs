import test from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogPointsLayer } from './index.js';
import { DEFAULT_PIXEL_SIZE, SELECTED_PIXEL_GROWTH } from './points.js';
import { DataLayerManager } from '../../data/manager.js';

const T0 = Date.UTC(2026, 8, 15, 12, 0);
const MAX_AGE_MS = 6 * 60 * 60_000;
const META = Object.freeze({
  id: 'test-catalog',
  name: 'Test Catalog',
  icon: '🛸',
  source: 'Test Source',
  color: '#39ff14',
  selectedSourceId: 'test-catalog-selected',
  loadingLabel: 'Loading things',
  unavailableText: 'Things unavailable',
  refreshFailedText: 'Things refresh failed',
});
const RECORDS = [
  { id: 'a', lat: 10, lon: 20, name: 'Alpha', url: 'https://example.org/a' },
  { id: 'b', lat: -5, lon: 100, name: 'Beta', url: null },
];

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fakeOverlay() {
  const state = { entries: new Map(), visible: new Map(), hit: null };
  return {
    state,
    setEntries(sourceId, entries) {
      state.entries.set(sourceId, entries);
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

function fakePicking() {
  const owners = new Map();
  return {
    owners,
    registerPickOwner: (layerId, predicate) => owners.set(layerId, predicate),
    unregisterPickOwner: (layerId) => owners.delete(layerId),
    resolvePickId: (picked) => picked?.primitive?.id ?? picked?.id ?? null,
    isOwnedByOtherLayer: (layerId, pickedId) => {
      for (const [ownerId, predicate] of owners)
        if (ownerId !== layerId && predicate(pickedId)) return true;
      return false;
    },
  };
}

function harness({ load } = {}) {
  const overlay = fakeOverlay();
  const loads = [];
  const renders = [];
  const opened = [];
  const credited = [];
  const clock = { now: T0 };
  const primitives = [];
  const pick = { result: null };
  const picking = fakePicking();
  const documentTarget = new EventTarget();
  const viewer = {
    scene: {
      preRender: { addEventListener: () => () => {} },
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
  const state = {
    load: load ?? (() => ({ records: RECORDS, stale: false })),
  };
  const layer = createCatalogPointsLayer({
    meta: META,
    maxAgeMs: MAX_AGE_MS,
    refreshInterval: 60 * 60_000,
    loadRecords: async (context) => {
      loads.push(context);
      return state.load(context);
    },
    buildCard: (record, { now }) => ({
      title: record.name,
      details: [`seen ${now === T0 ? 'at T0' : 'later'}`],
      url: record.url,
      accessibilityLabel: `Open ${record.name}`,
    }),
    overlayHost: overlay,
    fetchImpl: 'the fetch',
    createClickHandler: (_viewer, onClick) => {
      click.handler = onClick;
      return { destroy: () => (click.destroyed += 1) };
    },
    requestRender: (reason) => renders.push(reason),
    registerCredit: (_viewer, credit) => credited.push(credit?.key),
    credit: { key: 'test-credit', html: 'Test' },
    openUrl: (url) => opened.push(url),
    documentTarget,
    now: () => clock.now,
    picking,
  });
  const setPick = (id) => {
    pick.result = id ? { primitive: { id } } : null;
  };
  const card = () => overlay.state.entries.get(META.selectedSourceId)?.[0];
  return {
    layer,
    overlay,
    loads,
    renders,
    opened,
    credited,
    clock,
    primitives,
    picking,
    documentTarget,
    viewer,
    click,
    state,
    setPick,
    card,
  };
}

async function enabled(h) {
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  assert.equal(await h.layer.update(h.viewer, {}), true);
}

const rowText = (layer) =>
  new DataLayerManager({})._buildMetaText({
    source: layer.source,
    stats: layer.getStats(),
    enabled: true,
    lifecycleState: 'enabled',
  });

test('the layer takes its identity from meta and refuses to build without its collaborators', () => {
  const { layer } = harness();
  assert.deepEqual(
    [
      layer.id,
      layer.name,
      layer.icon,
      layer.source,
      layer.updateInterval,
      layer.refreshInterval,
    ],
    ['test-catalog', 'Test Catalog', '🛸', 'Test Source', 0, 3_600_000],
  );
  const base = {
    meta: META,
    loadRecords: async () => ({ records: [] }),
    buildCard: () => ({ title: '', details: [] }),
    overlayHost: fakeOverlay(),
  };
  assert.throws(
    () => createCatalogPointsLayer({ ...base, overlayHost: null }),
    /overlay host/,
  );
  assert.throws(
    () => createCatalogPointsLayer({ ...base, meta: null }),
    /meta/,
  );
  assert.throws(
    () => createCatalogPointsLayer({ ...base, loadRecords: null }),
    /loadRecords/,
  );
  assert.throws(
    () => createCatalogPointsLayer({ ...base, buildCard: null }),
    /buildCard/,
  );
});

test('enabling credits the source, loads records into visible points, owns its picks and requests a render', async () => {
  const h = harness();
  await enabled(h);
  assert.deepEqual(h.credited, ['test-credit']);
  assert.equal(h.loads.length, 1);
  assert.equal(h.loads[0].fetchImpl, 'the fetch');
  assert.ok(h.loads[0].signal instanceof AbortSignal);
  assert.equal(h.primitives[0].length, 2);
  assert.equal(h.primitives[0].show, true);
  assert.ok(h.renders.includes('test-catalog'));
  assert.equal(h.overlay.state.visible.get('test-catalog-selected'), true);
  assert.equal(h.picking.owners.get('test-catalog')('test-catalog:a'), true);
  assert.equal(h.picking.owners.get('test-catalog')('other:a'), false);
  assert.deepEqual(h.layer.getStats(), { count: 2, lastUpdate: T0 });
  assert.match(rowText(h.layer), /^Test Source · /);
});

test('records reload only after their max age; failures report on the row and keep the last records', async () => {
  const h = harness();
  await enabled(h);
  assert.equal(await h.layer.update(h.viewer, {}), true);
  assert.equal(h.loads.length, 1, 'fresh records cost no load');
  h.clock.now += MAX_AGE_MS;
  h.state.load = () => {
    throw new Error('HTTP 502');
  };
  assert.equal(await h.layer.update(h.viewer, {}), true);
  assert.equal(h.loads.length, 2);
  assert.deepEqual(h.layer.getStats(), {
    stale: true,
    count: 2,
    lastUpdate: T0,
    error: 'Things refresh failed',
  });
  assert.equal(rowText(h.layer), 'STALE · Test Source · Things refresh failed');
  assert.equal(h.primitives[0].length, 2);

  const cold = harness({
    load: () => {
      throw new Error('offline');
    },
  });
  await enabled(cold);
  assert.deepEqual(cold.layer.getStats(), {
    count: 0,
    lastUpdate: null,
    error: 'Things unavailable',
  });

  const stale = harness({ load: () => ({ records: RECORDS, stale: true }) });
  await enabled(stale);
  assert.deepEqual(stale.layer.getStats(), {
    stale: true,
    count: 2,
    lastUpdate: T0,
  });

  const gate = deferred();
  const slow = harness({ load: () => gate.promise });
  slow.layer.init(slow.viewer);
  slow.layer.enable(slow.viewer);
  const pending = slow.layer.update(slow.viewer, {});
  assert.equal(rowText(slow.layer), 'Test Source · Loading things');
  gate.resolve({ records: RECORDS, stale: false });
  assert.equal(await pending, true);
  assert.deepEqual(slow.layer.getStats(), { count: 2, lastUpdate: T0 });

  const aborted = new AbortController();
  aborted.abort();
  assert.equal(
    await h.layer.update(h.viewer, { signal: aborted.signal }),
    false,
  );
});

test('clicking a point selects it and publishes its card; the card opens its link', async () => {
  const h = harness();
  await enabled(h);
  h.renders.length = 0;
  h.setPick('test-catalog:a');
  h.click.handler({ x: 5, y: 5 });
  const entry = h.card();
  assert.equal(entry.id, 'test-catalog:a');
  assert.equal(entry.title, 'Alpha');
  assert.deepEqual(entry.details, ['seen at T0']);
  assert.equal(entry.accent, '#39ff14');
  assert.equal(entry.interactive, true);
  assert.equal(entry.accessibilityLabel, 'Open Alpha');
  assert.ok(entry.position, 'the card anchors on the point');
  assert.equal(
    h.primitives[0].get(0).pixelSize,
    DEFAULT_PIXEL_SIZE + SELECTED_PIXEL_GROWTH,
  );
  assert.deepEqual(h.renders, ['test-catalog']);
  assert.equal(entry.activate(), true);
  assert.deepEqual(h.opened, ['https://example.org/a']);
  h.overlay.state.hit = true;
  h.click.handler({ x: 5, y: 5 });
  assert.deepEqual(h.opened, [
    'https://example.org/a',
    'https://example.org/a',
  ]);
});

test('a record without a link gets a card that opens nothing', async () => {
  const h = harness();
  await enabled(h);
  h.setPick('test-catalog:b');
  h.click.handler({ x: 1, y: 1 });
  const entry = h.card();
  assert.equal(entry.interactive, false);
  assert.equal(entry.activate(), false);
  h.overlay.state.hit = true;
  h.click.handler({ x: 1, y: 1 });
  assert.deepEqual(h.opened, []);
});

test("empty space and Escape clear the selection; another layer's pick leaves it alone", async () => {
  const h = harness();
  await enabled(h);
  h.picking.registerPickOwner('aircraft', (id) => id.startsWith('aircraft:'));
  h.setPick('test-catalog:a');
  h.click.handler({ x: 1, y: 1 });
  h.setPick('aircraft:abc123');
  h.click.handler({ x: 2, y: 2 });
  assert.ok(h.card(), 'a sibling layer pick keeps the card');
  h.setPick(null);
  h.click.handler({ x: 3, y: 3 });
  assert.equal(h.card(), undefined);
  assert.equal(h.primitives[0].get(0).pixelSize, DEFAULT_PIXEL_SIZE);
  h.setPick('test-catalog:a');
  h.click.handler({ x: 1, y: 1 });
  h.documentTarget.dispatchEvent(
    Object.assign(new Event('keydown'), { key: 'Escape' }),
  );
  assert.equal(h.card(), undefined);
});

test('a refresh that drops the selected record clears its card', async () => {
  const h = harness();
  await enabled(h);
  h.setPick('test-catalog:a');
  h.click.handler({ x: 1, y: 1 });
  h.clock.now += MAX_AGE_MS;
  h.state.load = () => ({ records: RECORDS.slice(1), stale: false });
  await h.layer.update(h.viewer, {});
  assert.equal(h.card(), undefined);
  assert.equal(h.primitives[0].length, 1);
});

test('disabling releases clicks, keys, picks, points and the card; destroy clears the overlay source', async () => {
  const h = harness();
  await enabled(h);
  h.setPick('test-catalog:a');
  h.click.handler({ x: 1, y: 1 });
  h.layer.disable();
  assert.equal(h.card(), undefined);
  assert.equal(h.click.destroyed, 1);
  assert.equal(h.picking.owners.has('test-catalog'), false);
  assert.equal(h.primitives[0].show, false);
  assert.equal(h.overlay.state.visible.get('test-catalog-selected'), false);
  h.setPick('test-catalog:a');
  h.documentTarget.dispatchEvent(
    Object.assign(new Event('keydown'), { key: 'Escape' }),
  );
  h.layer.enable(h.viewer);
  assert.equal(h.primitives[0].length, 2, 'records come back without a reload');
  h.layer.destroy();
  assert.equal(h.primitives.length, 0);
  assert.equal(h.overlay.state.entries.has('test-catalog-selected'), false);
});
