import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { PIN_SOURCE_ID, createReportPin } from './reportPin.js';

const LOADING = { title: 'Loading weather', details: [] };
const LOADED = { title: '86°F · Sunny', details: ['Wind 8 mph SSE, gusts 9', 'Includes weather data from Google'] };
const GALVESTON = { lat: 29.25, lon: -94.8 };

function setup() {
  const calls = [];
  const renders = [];
  const activations = [];
  const viewer = {
    dataSources: {
      added: [],
      removed: [],
      add(source) { this.added.push(source); return source; },
      remove(source, destroy) { this.removed.push([source, destroy]); return true; },
    },
  };
  const overlayHost = {
    setEntries: (...args) => calls.push(['setEntries', ...args]),
    setVisible: (...args) => calls.push(['setVisible', ...args]),
    clearSource: (...args) => calls.push(['clearSource', ...args]),
  };
  const pin = createReportPin({
    viewer,
    overlayHost,
    requestRender: (reason) => renders.push(reason),
    onActivate: () => activations.push('activate'),
  });
  const entities = () => viewer.dataSources.added[0]?.entities.values ?? [];
  return { pin, calls, renders, activations, viewer, entities };
}

test('show adds one point marker and publishes a pinned, interactive card', () => {
  const s = setup();
  s.pin.show(GALVESTON, LOADING);
  assert.equal(PIN_SOURCE_ID, 'weather-report');
  assert.equal(s.viewer.dataSources.added.length, 1);
  assert.equal(s.entities().length, 1);
  const marker = s.entities()[0];
  assert.equal(marker.point.pixelSize.getValue(), 8);
  assert.equal(marker.point.outlineWidth.getValue(), 2);
  assert.ok(Cesium.Color.WHITE.equals(marker.point.outlineColor.getValue()));
  const expected = Cesium.Cartesian3.fromDegrees(-94.8, 29.25);
  assert.ok(Cesium.Cartesian3.equalsEpsilon(marker.position.getValue(Cesium.JulianDate.now()), expected, 1e-6));

  assert.deepEqual(s.calls[0], ['setVisible', 'weather-report', true]);
  assert.equal(s.calls[1][0], 'setEntries');
  assert.equal(s.calls[1][1], 'weather-report');
  const [entry] = s.calls[1][2];
  assert.equal(entry.variant, 'card');
  assert.equal(entry.title, 'Loading weather');
  assert.deepEqual(entry.details, []);
  assert.equal(entry.pinned, true);
  assert.equal(entry.interactive, true);
  assert.equal(entry.accessibilityLabel, 'Open weather report');
  assert.ok(Cesium.Cartesian3.equalsEpsilon(entry.position, expected, 1e-6));
  entry.activate();
  assert.deepEqual(s.activations, ['activate']);
  assert.deepEqual(s.renders, ['weather-report'], 'the marker change requests a render');
});

test('update republishes the card without replacing the marker; before show it does nothing', () => {
  const idle = setup();
  idle.pin.update(LOADED);
  assert.deepEqual(idle.calls, []);

  const s = setup();
  s.pin.show(GALVESTON, LOADING);
  const marker = s.entities()[0];
  s.pin.update(LOADED);
  const last = s.calls.at(-1);
  assert.equal(last[0], 'setEntries');
  assert.equal(last[2][0].title, '86°F · Sunny');
  assert.deepEqual(last[2][0].details, LOADED.details);
  assert.equal(s.entities()[0], marker);
});

test('showing a new point moves the single marker', () => {
  const s = setup();
  s.pin.show(GALVESTON, LOADING);
  s.pin.show({ lat: 30.25, lon: -97.75 }, LOADING);
  assert.equal(s.entities().length, 1);
  const position = s.entities()[0].position.getValue(Cesium.JulianDate.now());
  assert.ok(Cesium.Cartesian3.equalsEpsilon(position, Cesium.Cartesian3.fromDegrees(-97.75, 30.25), 1e-6));
  assert.equal(s.viewer.dataSources.added.length, 1, 'the data source is reused');
});

test('clear removes the marker and the overlay source once; destroy removes the data source', () => {
  const s = setup();
  s.pin.show(GALVESTON, LOADING);
  s.renders.length = 0;
  s.pin.clear();
  assert.equal(s.entities().length, 0);
  assert.deepEqual(s.calls.slice(-2), [['clearSource', 'weather-report'], ['setVisible', 'weather-report', false]]);
  assert.deepEqual(s.renders, ['weather-report']);
  const callCount = s.calls.length;
  s.pin.clear();
  assert.equal(s.calls.length, callCount, 'a second clear is a no-op');
  s.pin.destroy();
  assert.equal(s.viewer.dataSources.removed.length, 1);
  assert.equal(s.viewer.dataSources.removed[0][1], true);
});
