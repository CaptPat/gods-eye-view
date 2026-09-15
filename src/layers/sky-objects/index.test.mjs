import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  SKY_OBJECTS_MESSIER_URL,
  SKY_OBJECTS_REFRESH_MS,
  createSkyObjectsLayer,
} from './index.js';
import { skyPosition } from '../sky-sphere/sphere.js';
import { raDecToUnit } from '../sky-sphere/celestial.js';

const T0 = Date.UTC(2026, 8, 15, 22, 0);
const MESSIER = [
  ['M31', 'Andromeda', 's', 3.4, 10.675, 41.267],
  ['M13', '', 'gc', 5.8, 250.425, 36.467],
];

function fakeCollection() {
  const added = [];
  return {
    added,
    add(options) {
      const item = { ...options };
      added.push(item);
      return item;
    },
  };
}

/** A stand-in ephemeris: every planet sits along +x until `turn` rotates it to +y. */
function fakeAstronomy() {
  const state = { calls: 0, turn: false };
  return {
    state,
    Body: Object.fromEntries(
      [
        'Mercury',
        'Venus',
        'Mars',
        'Jupiter',
        'Saturn',
        'Uranus',
        'Neptune',
      ].map((name) => [name, name]),
    ),
    GeoVector: () => {
      state.calls += 1;
      return state.turn ? { x: 0, y: 2, z: 0 } : { x: 3, y: 0, z: 0 };
    },
  };
}

function harness({ answer } = {}) {
  const requests = [];
  const renders = [];
  const astronomy = fakeAstronomy();
  let loads = 0;
  const clock = { now: T0 };
  const sphere = {
    points: fakeCollection(),
    lines: fakeCollection(),
    labels: fakeCollection(),
    visible: false,
    attached: 0,
    detached: 0,
    destroyed: false,
    options: null,
    show(visible) {
      this.visible = visible;
    },
    attach() {
      this.attached += 1;
    },
    detach() {
      this.detached += 1;
    },
    destroy() {
      this.destroyed = true;
    },
  };
  const layer = createSkyObjectsLayer({
    fetchImpl: async (url, init) => {
      requests.push({ url, cache: init?.cache });
      return (answer ?? (() => Response.json(MESSIER)))();
    },
    loadAstronomy: async () => {
      loads += 1;
      return astronomy;
    },
    createSphere: (_viewer, options) => {
      sphere.options = options;
      return sphere;
    },
    requestRender: (reason) => renders.push(reason),
    now: () => clock.now,
  });
  return {
    layer,
    requests,
    renders,
    astronomy,
    sphere,
    clock,
    loads: () => loads,
    viewer: {},
  };
}

async function enabled(h) {
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  return h.layer.update(h.viewer, {});
}

test('Planets & Deep Sky identifies itself and repositions planets every ten minutes', () => {
  const { layer } = harness();
  assert.deepEqual(
    [
      layer.id,
      layer.name,
      layer.source,
      layer.updateInterval,
      layer.refreshInterval,
    ],
    [
      'sky-objects',
      'Planets & Deep Sky',
      'astronomy-engine · Messier',
      0,
      600_000,
    ],
  );
  assert.equal(SKY_OBJECTS_REFRESH_MS, 600_000);
  assert.match(
    SKY_OBJECTS_MESSIER_URL,
    /\/data\/local_data\/night_sky\/messier\.json$/,
  );
});

test('an update places the seven planets and the Messier catalogue on the sky sphere', async () => {
  const h = harness();
  assert.equal(await enabled(h), true);
  assert.equal(h.sphere.options.id, 'sky-objects');
  assert.equal(h.sphere.attached, 1);
  assert.equal(h.sphere.visible, true);
  assert.deepEqual(h.requests, [
    { url: SKY_OBJECTS_MESSIER_URL, cache: 'force-cache' },
  ]);
  assert.equal(h.loads(), 1);
  assert.equal(h.sphere.points.added.length, 9);
  assert.deepEqual(
    h.sphere.labels.added.map((label) => label.text),
    [
      'Mercury',
      'Venus',
      'Mars',
      'Jupiter',
      'Saturn',
      'Uranus',
      'Neptune',
      'M31 Andromeda',
      'M13',
    ],
  );
  const [mercury] = h.sphere.points.added;
  assert.ok(mercury.color.equals(Cesium.Color.fromCssColorString('#b5b5b5')));
  assert.ok(
    Cesium.Cartesian3.equalsEpsilon(
      mercury.position,
      skyPosition({ x: 1, y: 0, z: 0 }),
      0,
      1e-3,
    ),
  );
  const andromeda = h.sphere.points.added[7];
  assert.ok(
    Cesium.Cartesian3.equalsEpsilon(
      andromeda.position,
      skyPosition(raDecToUnit(10.675, 41.267)),
      0,
      1e-3,
    ),
  );
  assert.ok(andromeda.color.equals(Cesium.Color.fromCssColorString('#ff7ad9')));
  assert.deepEqual(h.layer.getStats(), {
    count: 9,
    lastUpdate: T0,
    loadingLabel: '7 planets · 2 Messier objects',
  });
});

test('later updates move the same planet primitives without reloading the catalogue or the ephemeris', async () => {
  const h = harness();
  await enabled(h);
  h.astronomy.state.turn = true;
  h.clock.now += SKY_OBJECTS_REFRESH_MS;
  assert.equal(await h.layer.update(h.viewer, {}), true);
  assert.equal(h.requests.length, 1);
  assert.equal(h.loads(), 1);
  assert.equal(h.astronomy.state.calls, 14);
  assert.equal(
    h.sphere.points.added.length,
    9,
    'planets move rather than multiply',
  );
  const [mercury] = h.sphere.points.added;
  assert.ok(
    Cesium.Cartesian3.equalsEpsilon(
      mercury.position,
      skyPosition({ x: 0, y: 1, z: 0 }),
      0,
      1e-3,
    ),
  );
  assert.ok(
    Cesium.Cartesian3.equalsEpsilon(
      h.sphere.labels.added[0].position,
      mercury.position,
      0,
      1e-3,
    ),
    'each planet label follows its point',
  );
  assert.equal(h.layer.getStats().lastUpdate, T0 + SKY_OBJECTS_REFRESH_MS);
});

test('a missing catalogue reports unavailable; disabling detaches and destroy releases the sphere', async () => {
  const cold = harness({ answer: () => new Response('gone', { status: 404 }) });
  assert.equal(await enabled(cold), true);
  assert.deepEqual(cold.layer.getStats(), {
    count: 0,
    lastUpdate: null,
    error: 'Planet and Messier data unavailable',
  });

  const h = harness();
  await enabled(h);
  h.layer.disable();
  assert.equal(h.sphere.visible, false);
  assert.equal(h.sphere.detached, 1);
  assert.equal(await h.layer.update(h.viewer, {}), false);
  h.layer.destroy();
  assert.equal(h.sphere.destroyed, true);
});
