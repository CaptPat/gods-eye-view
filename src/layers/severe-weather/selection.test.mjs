// src/layers/severe-weather/selection.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createSevereWeatherSelection } from './selection.js';

const FLOOD_WATCH = {
  id: 'a1',
  event: 'Flood Watch',
  severity: 'Severe',
  urgency: 'Future',
  certainty: 'Possible',
  onset: '2026-09-15T12:00:00-08:00',
  ends: '2026-09-19T16:00:00-08:00',
  expires: '2026-09-14T16:00:00-08:00',
  areaDesc: 'Two Rivers; Fairbanks Metro Area',
  headline: null,
  senderName: 'NWS Fairbanks AK',
};
const FOG = {
  ...FLOOD_WATCH,
  id: 'a2',
  event: 'Dense Fog Advisory',
  severity: 'Moderate',
  urgency: 'Expected',
  certainty: 'Likely',
};
const DROUGHT = {
  id: 'DR-1018431',
  typeName: 'Drought',
  name: 'Drought in Madagascar',
  alertLevel: 'Orange',
  country: 'Madagascar',
  fromDate: Date.UTC(2025, 10, 21),
  toDate: Date.UTC(2026, 8, 14, 14, 38, 32),
  lon: 47.017,
  lat: -19.34,
  reportUrl:
    'https://www.gdacs.org/report.aspx?eventid=1018431&episodeid=14&eventtype=DR',
  track: [],
  cone: [],
};
const FAIRBANKS_ID = 'severe-weather:nws:zone:forecast/AKZ844:0';
const DROUGHT_ID = 'severe-weather:gdacs:DR-1018431';

function harness() {
  const calls = [];
  const data = {
    areas: [
      {
        key: 'zone:forecast/AKZ844',
        color: '#ff9500',
        polygons: [],
        alerts: [FLOOD_WATCH, FOG],
      },
    ],
    events: [DROUGHT],
  };
  const targets = new Map([
    [FAIRBANKS_ID, { kind: 'nws', key: 'zone:forecast/AKZ844' }],
    [DROUGHT_ID, { kind: 'gdacs', key: 'DR-1018431' }],
  ]);
  let action = null;
  let destroyed = 0;
  let picked = null;
  let hit = null;
  const records = new Map();
  const owners = new Map();
  const opened = [];
  const selection = createSevereWeatherSelection({
    viewer: { scene: { pick: () => picked } },
    rendering: {
      targetFor: (value) => targets.get(value?.id) ?? null,
      setSelected: (key) => calls.push(['highlight', key]),
    },
    overlayHost: {
      setVisible: (...args) => calls.push(['visible', ...args]),
      setEntries: (...args) => calls.push(['entries', ...args]),
      clearSource: (...args) => calls.push(['clearSource', ...args]),
      hitTest: (x, y, options) =>
        options?.sourceId === 'severe-weather' ? hit : null,
    },
    context: {
      registerEntityContext: (entity, metadata) => {
        entity.__gevContextId = metadata.id;
        records.set(metadata.id, { ...metadata, entity });
      },
      selectEntityContext: (entity) =>
        calls.push(['selectContext', entity.__gevContextId]),
      clearSelectedEntityContextForLayer: (layerId) =>
        calls.push(['clearContext', layerId]),
      removeEntityContextsForLayer: (layerId) =>
        calls.push(['removeContexts', layerId]),
    },
    picking: {
      resolvePickId: (value) =>
        typeof value?.id === 'string' ? value.id : null,
      isOwnedByOtherLayer: (layerId, id) =>
        [...owners].some(
          ([owner, predicate]) => owner !== layerId && predicate(id),
        ),
      registerPickOwner: (layerId, predicate) => owners.set(layerId, predicate),
      unregisterPickOwner: (layerId) => owners.delete(layerId),
    },
    pickGround: () => ({ lat: 64.8378, lon: -147.7164 }),
    openLink: (url) => opened.push(url),
    screenSpaceEventHandlerFactory: () => ({
      setInputAction(fn, type) {
        action = fn;
        calls.push(['input', type]);
      },
      destroy() {
        destroyed += 1;
      },
    }),
    getData: () => data,
  });
  selection.install();
  return {
    selection,
    calls,
    data,
    records,
    owners,
    opened,
    click: () => action({ position: new Cesium.Cartesian2(10, 20) }),
    pick: (id) => {
      picked = id === null ? null : { id };
    },
    hit: (value) => {
      hit = value;
    },
    destroyed: () => destroyed,
    entries: () => calls.filter(([name]) => name === 'entries'),
    count: (name) => calls.filter(([entry]) => entry === name).length,
  };
}

test('clicking an NWS area pins the top alert card at the clicked ground and publishes the context', () => {
  const h = harness();
  assert.deepEqual(h.calls[0], [
    'input',
    Cesium.ScreenSpaceEventType.LEFT_CLICK,
  ]);
  assert.equal(h.owners.get('severe-weather')('severe-weather:gdacs:x'), true);
  h.pick(FAIRBANKS_ID);
  h.click();
  const [, sourceId, [entry], options] = h.entries().at(-1);
  assert.equal(sourceId, 'severe-weather');
  assert.deepEqual(options, {
    cohortLimit: 1,
    collisionCapacity: 1,
    moving: false,
  });
  assert.equal(entry.id, 'selected:nws:zone:forecast/AKZ844');
  assert.equal(entry.variant, 'card');
  assert.equal(entry.selected, true);
  assert.equal(entry.interactive, true);
  assert.equal(entry.title, 'Flood Watch');
  assert.equal(entry.accent, '#ff9500');
  assert.deepEqual(entry.details, [
    'Severe · Future · Possible',
    'Sep 15 12:00 – Sep 19 16:00 UTC−8',
    'Two Rivers; Fairbanks Metro Area',
    '+1 more: Dense Fog Advisory',
    'Open weather.gov forecast',
  ]);
  assert.ok(
    Cesium.Cartesian3.equalsEpsilon(
      entry.position,
      Cesium.Cartesian3.fromDegrees(-147.7164, 64.8378),
      1e-6,
    ),
  );
  const record = h.records.get('severe-weather:nws:zone:forecast/AKZ844');
  assert.equal(record.layerId, 'severe-weather');
  assert.equal(record.layerName, 'Severe Weather');
  assert.equal(record.source, 'NWS');
  assert.equal(record.label, 'Flood Watch');
  assert.equal(record.latitude, 64.8378);
  assert.ok(
    h.calls.some(
      ([name, id]) =>
        name === 'selectContext' &&
        id === 'severe-weather:nws:zone:forecast/AKZ844',
    ),
  );
  assert.deepEqual(h.calls.filter(([name]) => name === 'highlight').at(-1), [
    'highlight',
    'nws:zone:forecast/AKZ844',
  ]);
});

test('clicking the card, or activating it from the keyboard mirror, opens its link', () => {
  const h = harness();
  h.pick(FAIRBANKS_ID);
  h.click();
  h.hit({
    sourceId: 'severe-weather',
    entryId: 'selected:nws:zone:forecast/AKZ844',
  });
  h.click();
  assert.deepEqual(h.opened, [
    'https://forecast.weather.gov/MapClick.php?lat=64.8378&lon=-147.7164',
  ]);
  const [, , [entry]] = h.entries().at(-1);
  assert.equal(entry.activate(), true);
  assert.equal(h.opened.length, 2);
});

test('a GDACS event card anchors at the event and links to the GDACS report', () => {
  const h = harness();
  h.pick(DROUGHT_ID);
  h.click();
  const [, , [entry]] = h.entries().at(-1);
  assert.equal(entry.title, 'Drought in Madagascar');
  assert.deepEqual(entry.details, [
    'Orange alert · Drought',
    'Nov 21, 2025 – Sep 14, 2026 UTC',
    'Madagascar',
    'Open GDACS report',
  ]);
  assert.ok(
    Cesium.Cartesian3.equalsEpsilon(
      entry.position,
      Cesium.Cartesian3.fromDegrees(47.017, -19.34),
      1e-6,
    ),
  );
  entry.activate();
  assert.deepEqual(h.opened, [DROUGHT.reportUrl]);
  assert.equal(
    h.records.get('severe-weather:gdacs:DR-1018431').source,
    'GDACS',
  );
});

test('a pick owned by another layer keeps the card; an empty click clears it', () => {
  const h = harness();
  h.owners.set('flights', (id) => id.startsWith('flight:'));
  h.pick(FAIRBANKS_ID);
  h.click();
  h.pick('flight:abc123');
  h.click();
  assert.equal(h.count('clearSource'), 0);
  h.pick(null);
  h.click();
  assert.equal(h.count('clearSource'), 1);
  assert.ok(
    h.calls.some(
      ([name, id]) => name === 'clearContext' && id === 'severe-weather',
    ),
  );
  assert.ok(
    h.calls.some(
      ([name, id]) => name === 'removeContexts' && id === 'severe-weather',
    ),
  );
  assert.deepEqual(h.calls.filter(([name]) => name === 'highlight').at(-1), [
    'highlight',
    null,
  ]);
  assert.equal(h.selection.selected(), null);
  h.click();
  assert.equal(h.count('clearSource'), 1, 'clearing twice is a no-op');
});

test('a refresh keeps the card current without re-announcing, and drops it when its area is gone', () => {
  const h = harness();
  h.pick(FAIRBANKS_ID);
  h.click();
  h.data.areas[0] = { ...h.data.areas[0], alerts: [FOG] };
  h.selection.refresh();
  assert.equal(h.entries().at(-1)[2][0].title, 'Dense Fog Advisory');
  assert.equal(h.count('selectContext'), 1);
  h.data.areas = [];
  h.selection.refresh();
  assert.equal(h.count('clearSource'), 1);
  assert.equal(h.selection.selected(), null);

  h.selection.uninstall();
  assert.equal(h.destroyed(), 1);
  assert.equal(h.owners.has('severe-weather'), false);
  assert.deepEqual(h.calls.at(-1), ['visible', 'severe-weather', false]);
});
