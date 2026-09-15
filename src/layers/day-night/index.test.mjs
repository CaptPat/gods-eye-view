import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY_NIGHT_META,
  DAY_NIGHT_REFRESH_MS,
  NIGHT_BAND_LEVELS,
  createDayNightLayer,
} from './index.js';
import { DataLayerManager } from '../../data/manager.js';

const T0 = Date.UTC(2026, 8, 22, 12, 0);
const BODIES = {
  sun: { lat: 0, lon: 0 },
  moon: { lat: -20, lon: 140 },
  illumination: 0.784,
  waxing: true,
};

function harness({ computeBodies } = {}) {
  const renders = [];
  const computed = [];
  const rendering = {
    options: null,
    bands: null,
    show: false,
    cleared: 0,
    destroyed: false,
  };
  const markers = { last: null, show: false, destroyed: false };
  const clock = { now: T0 };
  const layer = createDayNightLayer({
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
        },
        destroy: () => {
          rendering.destroyed = true;
        },
      };
    },
    createMarkers: () => ({
      set: (bodies) => {
        markers.last = bodies;
      },
      setShow: (show) => {
        markers.show = show;
      },
      destroy: () => {
        markers.destroyed = true;
      },
    }),
    computeBodies:
      computeBodies ??
      ((date) => {
        computed.push(date.getTime());
        return BODIES;
      }),
    requestRender: (reason) => renders.push(reason),
    now: () => clock.now,
  });
  return { layer, renders, computed, rendering, markers, clock, viewer: {} };
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

test('Day & Night identifies itself, recomputes every two minutes and shades four twilight steps', () => {
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
    ['day-night', 'Day & Night', '🌗', 'Sun & Moon', 0, 120_000],
  );
  assert.equal(DAY_NIGHT_META.id, 'day-night');
  assert.equal(DAY_NIGHT_REFRESH_MS, 120_000);
  assert.deepEqual(
    NIGHT_BAND_LEVELS.map(({ color, alpha }) => [color, alpha]),
    [
      ['#0b1633', 0.12],
      ['#0b1633', 0.2],
      ['#0b1633', 0.28],
      ['#0b1633', 0.36],
    ],
  );
});

test('an update shades the night side for the sun’s position and moves the sun and moon markers', async () => {
  const h = harness();
  assert.equal(await enabled(h), true);
  assert.deepEqual(h.computed, [T0]);
  assert.equal(h.rendering.options.id, 'day-night');
  assert.deepEqual(h.rendering.options.levels, NIGHT_BAND_LEVELS);
  assert.equal(h.rendering.show, true);
  assert.equal(h.markers.show, true);
  assert.deepEqual(h.markers.last, BODIES);
  const equatorRow = h.rendering.bands.filter(
    (band) => band.south === 0 && band.north === 1,
  );
  assert.equal(
    equatorRow.some((band) => band.west <= 0 && band.east > 0),
    false,
    'noon at Greenwich is daylight',
  );
  assert.ok(
    equatorRow.some((band) => band.level === 3 && band.east === 180),
    'midnight at the antimeridian is night',
  );
  assert.ok(h.renders.includes('day-night'));
  assert.deepEqual(h.layer.getStats(), {
    count: h.rendering.bands.length,
    lastUpdate: T0,
    loadingLabel: 'Moon 78% lit, waxing',
  });
  assert.equal(rowText(h.layer), 'Sun & Moon · Moon 78% lit, waxing');

  h.clock.now += DAY_NIGHT_REFRESH_MS;
  await h.layer.update(h.viewer, {});
  assert.deepEqual(h.computed, [T0, T0 + DAY_NIGHT_REFRESH_MS]);
});

test('a failed computation reports on the row without failing the layer', async () => {
  const h = harness({
    computeBodies: () => {
      throw new Error('no ephemeris');
    },
  });
  assert.equal(await enabled(h), true);
  assert.deepEqual(h.layer.getStats(), {
    count: 0,
    lastUpdate: null,
    error: 'Sun and moon positions unavailable',
  });
});

test('disabling hides and clears everything; destroy releases the rendering and markers', async () => {
  const h = harness();
  await enabled(h);
  h.layer.disable();
  assert.equal(h.rendering.show, false);
  assert.equal(h.rendering.cleared, 1);
  assert.equal(h.markers.show, false);
  assert.equal(await h.layer.update(h.viewer, {}), false);
  h.layer.destroy();
  assert.equal(h.rendering.destroyed, true);
  assert.equal(h.markers.destroyed, true);
});
