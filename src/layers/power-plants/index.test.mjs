import test from 'node:test';
import assert from 'node:assert/strict';
import { POWER_PLANTS_SNAPSHOT_URL, createPowerPlantsLayer } from './index.js';
import { POWER_PLANT_FIELDS } from './source.js';

const T0 = Date.UTC(2026, 8, 15, 14, 0);
const ATUCHA_ROW = [
  'ARG0000029',
  'ATUCHA I',
  'Nuclear',
  370,
  -33.967,
  -59.2059,
  'Argentina',
  1974,
  'NASA',
];

function scene() {
  const primitives = [];
  const pick = { result: null };
  const viewer = {
    scene: {
      preRender: { addEventListener: () => () => {} },
      primitives: {
        add: (primitive) => (primitives.push(primitive), primitive),
        remove: (primitive) => (
          primitives.splice(primitives.indexOf(primitive), 1),
          true
        ),
      },
      pick: () => pick.result,
    },
  };
  const entries = new Map();
  const overlayHost = {
    entries,
    setEntries: (sourceId, list) => entries.set(sourceId, list),
    clearSource: (sourceId) => entries.delete(sourceId),
    setVisible: () => {},
    hitTest: () => false,
  };
  return { viewer, primitives, pick, overlayHost, click: { handler: null } };
}

function build(s, answer) {
  const requests = [];
  const layer = createPowerPlantsLayer({
    overlayHost: s.overlayHost,
    fetchImpl: async (url, init) => {
      requests.push([url, init?.cache]);
      return answer();
    },
    createClickHandler: (_viewer, onClick) => {
      s.click.handler = onClick;
      return { destroy() {} };
    },
    now: () => T0,
  });
  return { layer, requests };
}

test('Power Plants loads its bundled snapshot into fuel-coloured points with unlinked cards', async () => {
  const s = scene();
  const { layer, requests } = build(s, () =>
    Response.json({
      source: 'WRI',
      fields: POWER_PLANT_FIELDS,
      rows: [ATUCHA_ROW],
    }),
  );
  assert.deepEqual(
    [layer.id, layer.name, layer.source],
    ['power-plants', 'Power Plants', 'WRI GPPD'],
  );
  layer.init(s.viewer);
  layer.enable(s.viewer);
  assert.equal(await layer.update(s.viewer, {}), true);
  assert.deepEqual(requests, [[POWER_PLANTS_SNAPSHOT_URL, 'force-cache']]);
  assert.match(
    POWER_PLANTS_SNAPSHOT_URL,
    /\/data\/local_data\/power_plants\/power-plants\.json$/,
  );
  assert.deepEqual(layer.getStats(), { count: 1, lastUpdate: T0 });
  assert.equal(s.primitives[0].get(0).color.toCssHexString(), '#ffd60a');
  s.pick.result = { primitive: { id: 'power-plants:ARG0000029' } };
  s.click.handler({ x: 1, y: 1 });
  const [card] = s.overlayHost.entries.get('power-plants-selected');
  assert.equal(card.title, 'ATUCHA I');
  assert.equal(card.interactive, false);
});

test('a missing snapshot reports Power Plants unavailable', async () => {
  const s = scene();
  const { layer } = build(s, () => new Response('gone', { status: 404 }));
  layer.init(s.viewer);
  layer.enable(s.viewer);
  await layer.update(s.viewer, {});
  assert.deepEqual(layer.getStats(), {
    count: 0,
    lastUpdate: null,
    error: 'Power plant data unavailable',
  });
});
