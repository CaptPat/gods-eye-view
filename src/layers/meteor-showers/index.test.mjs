import test from 'node:test';
import assert from 'node:assert/strict';
import {
  METEOR_POSITION_MAX_AGE_MS,
  createMeteorShowersLayer,
} from './index.js';

const T0 = Date.UTC(2026, 8, 15, 12);

function scene() {
  const primitives = [];
  const pick = { result: null };
  const viewer = {
    scene: {
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

test('Meteor Showers computes today’s radiants without a request and moves them as the Earth turns', async () => {
  const s = scene();
  const clock = { now: T0 };
  let fetched = 0;
  const layer = createMeteorShowersLayer({
    overlayHost: s.overlayHost,
    fetchImpl: async () => {
      fetched += 1;
      throw new Error('no network expected');
    },
    createClickHandler: (_viewer, onClick) => {
      s.click.handler = onClick;
      return { destroy() {} };
    },
    now: () => clock.now,
  });
  assert.deepEqual(
    [layer.id, layer.name, layer.source],
    ['meteor-showers', 'Meteor Showers', 'IMO calendar'],
  );
  assert.equal(METEOR_POSITION_MAX_AGE_MS, 120_000);
  assert.equal(layer.refreshInterval, 120_000);
  layer.init(s.viewer);
  layer.enable(s.viewer);
  assert.equal(await layer.update(s.viewer, {}), true);
  assert.equal(fetched, 0);
  assert.deepEqual(layer.getStats(), { count: 2, lastUpdate: T0 });
  const before = s.primitives[0].get(1).position.clone();

  s.pick.result = { primitive: { id: 'meteor-showers:september-lyncids' } };
  s.click.handler({ x: 1, y: 1 });
  const [card] = s.overlayHost.entries.get('meteor-showers-selected');
  assert.equal(card.title, 'September Lyncids');

  clock.now += METEOR_POSITION_MAX_AGE_MS;
  await layer.update(s.viewer, {});
  assert.equal(layer.getStats().lastUpdate, clock.now);
  assert.equal(
    s.primitives[0].get(1).position.equals(before),
    false,
    'two minutes of rotation moves the sub-radiant point',
  );
});
