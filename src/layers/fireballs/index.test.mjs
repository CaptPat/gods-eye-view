import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FIREBALLS_ENDPOINT, createFireballsLayer } from './index.js';
import { fireballPixelSize } from './model.js';
import { normalizeFireballs } from '../../../server/providers/fireballs/normalize.js';

const T0 = Date.UTC(2026, 8, 15, 12, 0);
const FIREBALLS = normalizeFireballs(
  JSON.parse(
    readFileSync(
      new URL(
        '../../data/fixtures/fireballs/fireball-located-6.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ),
);

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
  const click = { handler: null };
  return { viewer, primitives, pick, overlayHost, click };
}

function build(s, answer) {
  const requests = [];
  const layer = createFireballsLayer({
    overlayHost: s.overlayHost,
    fetchImpl: async (url) => {
      requests.push(url);
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

test('Fireballs loads /api/fireballs into energy-sized points with CNEOS cards', async () => {
  const s = scene();
  const { layer, requests } = build(s, () =>
    Response.json({ generatedAt: T0, stale: false, fireballs: FIREBALLS }),
  );
  assert.deepEqual(
    [layer.id, layer.name, layer.source],
    ['fireballs', 'Fireballs', 'NASA/JPL CNEOS'],
  );
  layer.init(s.viewer);
  layer.enable(s.viewer);
  assert.equal(await layer.update(s.viewer, {}), true);
  assert.deepEqual(requests, ['/api/fireballs']);
  assert.equal(FIREBALLS_ENDPOINT, '/api/fireballs');
  assert.deepEqual(layer.getStats(), { count: 6, lastUpdate: T0 });
  assert.equal(s.primitives[0].get(0).pixelSize, fireballPixelSize(0.2));

  s.pick.result = { primitive: { id: 'fireballs:20260911101803' } };
  s.click.handler({ x: 1, y: 1 });
  const [card] = s.overlayHost.entries.get('fireballs-selected');
  assert.equal(card.title, 'Fireball · 11 Sep 2026');
  assert.equal(card.accent, '#ff8c00');
  assert.equal(card.interactive, true);
});

test('a stale proxy answer marks the row stale; a failed or broken answer reports unavailable', async () => {
  const stale = scene();
  const staleLayer = build(stale, () =>
    Response.json({ generatedAt: T0, stale: true, fireballs: FIREBALLS }),
  ).layer;
  staleLayer.init(stale.viewer);
  staleLayer.enable(stale.viewer);
  await staleLayer.update(stale.viewer, {});
  assert.deepEqual(staleLayer.getStats(), {
    stale: true,
    count: 6,
    lastUpdate: T0,
  });

  for (const answer of [
    () =>
      Response.json(
        { error: 'NASA/JPL fireball data unavailable' },
        { status: 502 },
      ),
    () => Response.json({ fireballs: 'nope' }),
  ]) {
    const s = scene();
    const { layer } = build(s, answer);
    layer.init(s.viewer);
    layer.enable(s.viewer);
    await layer.update(s.viewer, {});
    assert.deepEqual(layer.getStats(), {
      count: 0,
      lastUpdate: null,
      error: 'Fireball data unavailable',
    });
  }
});
