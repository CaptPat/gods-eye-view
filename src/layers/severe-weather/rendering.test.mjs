import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  CONE_FILL_ALPHA,
  NWS_FILL_ALPHA,
  READY_POLL_LIMIT,
  READY_POLL_MS,
  createSevereWeatherRendering,
  isSevereWeatherPickId,
} from './rendering.js';

const T = Cesium.JulianDate.now();
const ring = (lon, lat, size = 1) => [
  [lon, lat],
  [lon + size, lat],
  [lon + size, lat + size],
  [lon, lat + size],
  [lon, lat],
];
const AREAS = [
  {
    key: 'zone:forecast/AKZ844',
    color: '#ff9500',
    polygons: [[ring(-148, 64)]],
    alerts: [],
  },
  {
    key: 'alert:urn:x',
    color: '#5ac8fa',
    polygons: [[ring(-95, 41), ring(-94.8, 41.2, 0.2)], [ring(-90, 41)]],
    alerts: [],
  },
];
const EVENTS = [
  {
    id: 'TC-1001321',
    alertLevel: 'Green',
    lon: -119.7,
    lat: 16.3,
    track: [
      [
        [-117.2, 17.2],
        [-118.3, 17],
        [-119.7, 16.3],
      ],
    ],
    cone: [[ring(-125, 14, 4)]],
  },
  {
    id: 'DR-1018431',
    alertLevel: 'Orange',
    lon: 47.017,
    lat: -19.34,
    track: [],
    cone: [],
  },
];

function fakeViewer() {
  const state = { pending: false };
  const sources = [];
  return {
    state,
    sources,
    dataSources: {
      add(source) {
        sources.push(source);
        return Promise.resolve(source);
      },
      remove(source) {
        const index = sources.indexOf(source);
        if (index >= 0) sources.splice(index, 1);
        return index >= 0;
      },
    },
    dataSourceDisplay: {
      getBoundingSphere: () =>
        state.pending
          ? Cesium.BoundingSphereState.PENDING
          : Cesium.BoundingSphereState.DONE,
    },
  };
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
      pending = pending.filter((entry) => entry !== timer);
    },
    count: () => pending.length,
    runNext() {
      const timer = pending.shift();
      timer.fn();
      return timer.ms;
    },
  };
}

function harness() {
  const viewer = fakeViewer();
  const timers = fakeTimers();
  const renders = [];
  const rendering = createSevereWeatherRendering(viewer, {
    requestRender: (reason) => renders.push(reason),
    timers,
  });
  const entity = (id) => rendering.dataSource.entities.getById(id);
  return { viewer, timers, renders, rendering, entity };
}

const colorOf = (property) =>
  property.getValue(T).color ?? property.getValue(T);

test('NWS areas become ground fills with outlines; GDACS events become points, tracks and cones', () => {
  const { viewer, rendering, renders, entity } = harness();
  assert.equal(viewer.sources.length, 1);
  assert.equal(rendering.render({ areas: AREAS, events: EVENTS }), true);
  assert.equal(rendering.dataSource.entities.values.length, 11);

  const fill = entity('severe-weather:nws:zone:forecast/AKZ844:0');
  assert.equal(
    fill.polygon.height,
    undefined,
    'no height: Cesium clamps the fill to the ground',
  );
  assert.equal(
    fill.polygon.classificationType.getValue(T),
    Cesium.ClassificationType.BOTH,
  );
  assert.ok(
    fill.polygon.material.color
      .getValue(T)
      .equals(
        Cesium.Color.fromCssColorString('#ff9500').withAlpha(NWS_FILL_ALPHA),
      ),
  );
  const outline = entity('severe-weather:nws:zone:forecast/AKZ844:0:outline');
  assert.equal(outline.polyline.clampToGround.getValue(T), true);
  assert.equal(outline.polyline.width.getValue(T), 2);
  assert.equal(
    entity('severe-weather:nws:alert:urn:x:0').polygon.hierarchy.getValue(T)
      .holes.length,
    1,
  );
  assert.ok(
    entity('severe-weather:nws:alert:urn:x:1'),
    'a second polygon of the same alert',
  );

  const drought = entity('severe-weather:gdacs:DR-1018431');
  assert.equal(
    drought.point.heightReference.getValue(T),
    Cesium.HeightReference.CLAMP_TO_GROUND,
  );
  assert.equal(
    drought.point.disableDepthTestDistance.getValue(T),
    Number.POSITIVE_INFINITY,
  );
  assert.ok(
    drought.point.color
      .getValue(T)
      .equals(Cesium.Color.fromCssColorString('#ff9500')),
  );
  assert.equal(
    entity('severe-weather:gdacs:TC-1001321:track:0').polyline.width.getValue(
      T,
    ),
    3,
  );
  assert.ok(
    colorOf(
      entity('severe-weather:gdacs:TC-1001321:cone:0').polygon.material,
    ).equals(
      Cesium.Color.fromCssColorString('#34c759').withAlpha(CONE_FILL_ALPHA),
    ),
  );

  assert.deepEqual(rendering.targetFor({ id: fill }), {
    kind: 'nws',
    key: 'zone:forecast/AKZ844',
  });
  assert.deepEqual(rendering.targetFor({ id: outline }), {
    kind: 'nws',
    key: 'zone:forecast/AKZ844',
  });
  assert.deepEqual(
    rendering.targetFor({ id: 'severe-weather:gdacs:TC-1001321:track:0' }),
    { kind: 'gdacs', key: 'TC-1001321' },
  );
  assert.equal(
    rendering.targetFor({ id: new Cesium.Entity({ id: 'flight:abc' }) }),
    null,
  );
  assert.equal(rendering.targetFor(undefined), null);
  assert.equal(isSevereWeatherPickId('severe-weather:gdacs:DR-1018431'), true);
  assert.equal(isSevereWeatherPickId('flight:abc'), false);
  assert.ok(renders.includes('severe-weather-render'));
});

test('an unchanged drawn set is not rebuilt; a changed one is', () => {
  const { rendering, entity } = harness();
  rendering.render({ areas: AREAS, events: EVENTS });
  const before = entity('severe-weather:gdacs:DR-1018431');
  assert.equal(rendering.render({ areas: AREAS, events: EVENTS }), false);
  assert.equal(entity('severe-weather:gdacs:DR-1018431'), before);
  assert.equal(
    rendering.render({
      areas: AREAS,
      events: [EVENTS[0], { ...EVENTS[1], alertLevel: 'Red' }],
    }),
    true,
  );
  assert.notEqual(entity('severe-weather:gdacs:DR-1018431'), before);
});

test('selection turns the chosen outlines, track and point white and requests a render', () => {
  const { rendering, renders, entity } = harness();
  rendering.render({ areas: AREAS, events: EVENTS });
  rendering.setSelected('gdacs:TC-1001321');
  assert.ok(renders.includes('severe-weather-selection'));
  const track = entity('severe-weather:gdacs:TC-1001321:track:0');
  assert.equal(track.polyline.width.getValue(T), 5);
  assert.ok(colorOf(track.polyline.material).equals(Cesium.Color.WHITE));
  assert.equal(
    entity('severe-weather:gdacs:TC-1001321').point.pixelSize.getValue(T),
    15,
  );
  assert.equal(
    entity(
      'severe-weather:nws:zone:forecast/AKZ844:0:outline',
    ).polyline.width.getValue(T),
    2,
    'others unchanged',
  );

  rendering.setSelected('nws:zone:forecast/AKZ844');
  assert.equal(track.polyline.width.getValue(T), 3);
  assert.equal(
    entity(
      'severe-weather:nws:zone:forecast/AKZ844:0:outline',
    ).polyline.width.getValue(T),
    4,
  );
  rendering.render({ areas: AREAS, events: [EVENTS[1]] });
  assert.equal(
    entity(
      'severe-weather:nws:zone:forecast/AKZ844:0:outline',
    ).polyline.width.getValue(T),
    4,
    'a rebuild keeps the highlight',
  );
  rendering.setSelected(null);
  assert.equal(
    entity(
      'severe-weather:nws:zone:forecast/AKZ844:0:outline',
    ).polyline.width.getValue(T),
    2,
  );
});

test('frames are requested while new ground geometry is pending, and the pump is bounded', () => {
  const { viewer, timers, renders, rendering } = harness();
  viewer.state.pending = true;
  rendering.render({ areas: AREAS, events: EVENTS });
  assert.equal(timers.count(), 1);
  for (let i = 0; i < 3; i += 1) assert.equal(timers.runNext(), READY_POLL_MS);
  assert.equal(
    renders.filter((reason) => reason === 'severe-weather-geometry').length,
    3,
  );
  viewer.state.pending = false;
  timers.runNext();
  assert.equal(timers.count(), 0, 'ready geometry stops the pump');

  rendering.setSelected('gdacs:DR-1018431');
  viewer.state.pending = true;
  let ticks = 0;
  while (timers.count()) {
    timers.runNext();
    ticks += 1;
  }
  assert.equal(ticks, READY_POLL_LIMIT);
});

test('visibility, clear and destroy', () => {
  const { viewer, timers, renders, rendering } = harness();
  rendering.render({ areas: AREAS, events: EVENTS });
  rendering.setVisible(false);
  assert.equal(rendering.dataSource.show, false);
  assert.ok(renders.includes('severe-weather-visibility'));
  rendering.clear();
  assert.equal(rendering.dataSource.entities.values.length, 0);
  assert.equal(timers.count(), 0);
  assert.equal(
    rendering.targetFor({ id: 'severe-weather:gdacs:DR-1018431' }),
    null,
  );
  assert.equal(
    rendering.render({ areas: AREAS, events: EVENTS }),
    true,
    'clear forgets the signature',
  );
  rendering.destroy();
  assert.equal(viewer.sources.length, 0);
});
