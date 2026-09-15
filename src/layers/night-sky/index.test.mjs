import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  NIGHT_SKY_DATA_URLS,
  NIGHT_SKY_REFRESH_MS,
  createNightSkyLayer,
} from './index.js';
import { skyPosition } from '../sky-sphere/sphere.js';
import { raDecToUnit } from '../sky-sphere/celestial.js';

const T0 = Date.UTC(2026, 8, 15, 22, 0);
const DATA = {
  stars: [
    [101.287, -16.716, -1.44, 0.009],
    [279.235, 38.784, 0.03, null],
  ],
  names: [[101.287, -16.716, -1.44, 'Sirius']],
  constellations: {
    lines: [
      [
        [30.975, 42.33],
        [17.433, 35.621],
        [9.832, 30.861],
      ],
    ],
    labels: [
      ['Andromeda', 0.75, 43],
      ['Lyra', 283, 36],
    ],
  },
};

function fakeCollection() {
  const added = [];
  return {
    added,
    add(options) {
      added.push(options);
      return options;
    },
    removeAll() {
      added.length = 0;
    },
  };
}

function harness(answer) {
  const requests = [];
  const renders = [];
  const credited = [];
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
  const state = {
    answer:
      answer ??
      ((url) =>
        Response.json(
          url === NIGHT_SKY_DATA_URLS.stars
            ? DATA.stars
            : url === NIGHT_SKY_DATA_URLS.names
              ? DATA.names
              : DATA.constellations,
        )),
  };
  const layer = createNightSkyLayer({
    fetchImpl: async (url, init) => {
      requests.push({ url, cache: init?.cache });
      return state.answer(url);
    },
    createSphere: (_viewer, options) => {
      sphere.options = options;
      return sphere;
    },
    requestRender: (reason) => renders.push(reason),
    registerCredit: (_viewer, credit) => credited.push(credit?.key),
    credit: { key: 'd3-celestial', html: 'd3-celestial' },
    // Cesium materials need HTMLCanvasElement, which Node lacks.
    createLineMaterial: (color) => ({ type: 'Color', color }),
    now: () => T0,
  });
  return { layer, requests, renders, credited, sphere, state, viewer: {} };
}

async function enabled(h) {
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  return h.layer.update(h.viewer, {});
}

test('Night Sky identifies itself and loads its bundled catalogue once a day at most', () => {
  const { layer } = harness();
  assert.deepEqual(
    [
      layer.id,
      layer.name,
      layer.source,
      layer.updateInterval,
      layer.refreshInterval,
    ],
    ['night-sky', 'Night Sky', 'Hipparcos · IAU', 0, NIGHT_SKY_REFRESH_MS],
  );
  assert.equal(NIGHT_SKY_REFRESH_MS, 86_400_000);
  assert.match(
    NIGHT_SKY_DATA_URLS.stars,
    /\/data\/local_data\/night_sky\/stars\.json$/,
  );
  assert.match(
    NIGHT_SKY_DATA_URLS.names,
    /\/data\/local_data\/night_sky\/star-names\.json$/,
  );
  assert.match(
    NIGHT_SKY_DATA_URLS.constellations,
    /\/data\/local_data\/night_sky\/constellations\.json$/,
  );
});

test('enabling attaches the sky sphere; the catalogue fills it with stars, figures and names', async () => {
  const h = harness();
  assert.equal(await enabled(h), true);
  assert.equal(h.sphere.options.id, 'night-sky');
  assert.deepEqual(h.credited, ['d3-celestial']);
  assert.equal(h.sphere.attached, 1);
  assert.equal(h.sphere.visible, true);
  assert.deepEqual(
    h.requests.map((request) => request.url).sort(),
    Object.values(NIGHT_SKY_DATA_URLS).sort(),
  );
  assert.ok(h.requests.every((request) => request.cache === 'force-cache'));

  const [sirius, vega] = h.sphere.points.added;
  assert.equal(h.sphere.points.added.length, 2);
  assert.ok(
    Cesium.Cartesian3.equalsEpsilon(
      sirius.position,
      skyPosition(raDecToUnit(101.287, -16.716)),
      0,
      1e-3,
    ),
  );
  assert.equal(sirius.pixelSize, 7);
  assert.ok(
    sirius.color.equals(
      Cesium.Color.fromCssColorString('#cad7ff').withAlpha(1),
    ),
  );
  assert.equal(vega.pixelSize, 5.97);

  assert.equal(h.sphere.lines.added.length, 1);
  assert.equal(h.sphere.lines.added[0].positions.length, 3);
  assert.equal(h.sphere.lines.added[0].width, 1);
  assert.ok(
    h.sphere.lines.added[0].material.color.equals(
      Cesium.Color.fromCssColorString('#6ea8ff').withAlpha(0.35),
    ),
  );
  assert.deepEqual(
    h.sphere.labels.added.map((label) => label.text),
    ['Sirius', 'Andromeda', 'Lyra'],
  );
  assert.deepEqual(h.layer.getStats(), {
    count: 2,
    lastUpdate: T0,
    loadingLabel: '2 stars · 2 constellations',
  });
  assert.ok(h.renders.includes('night-sky'));

  assert.equal(await h.layer.update(h.viewer, {}), true);
  assert.equal(h.requests.length, 3, 'the catalogue loads once');
});

test('a missing catalogue reports the layer unavailable without failing it', async () => {
  const h = harness(() => new Response('gone', { status: 404 }));
  assert.equal(await enabled(h), true);
  assert.deepEqual(h.layer.getStats(), {
    count: 0,
    lastUpdate: null,
    error: 'Night sky data unavailable',
  });
});

test('disabling hides and detaches the sphere; destroy releases it', async () => {
  const h = harness();
  await enabled(h);
  h.layer.disable();
  assert.equal(h.sphere.visible, false);
  assert.equal(h.sphere.detached, 1);
  assert.equal(await h.layer.update(h.viewer, {}), false);
  h.layer.enable(h.viewer);
  assert.equal(h.sphere.attached, 2);
  assert.equal(
    h.sphere.points.added.length,
    2,
    'stars stay built across a toggle',
  );
  h.layer.destroy();
  assert.equal(h.sphere.destroyed, true);
});
