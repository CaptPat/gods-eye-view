import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NUCLEAR_SNAPSHOT_URLS,
  createNuclearAccidentsLayer,
  createNuclearPowerPlantsLayer,
  createNuclearWasteSitesLayer,
} from './index.js';

const T0 = Date.UTC(2026, 8, 15, 14, 0);
const BASE = {
  description: null,
  kinds: [],
  date: null,
  place: null,
  approximate: false,
  wikipedia: null,
  wikidata: 'https://www.wikidata.org/wiki/Q1',
};
const PLANT = {
  ...BASE,
  id: 'Q486898',
  name: 'Kori Nuclear Power Plant',
  lat: 35.32022,
  lon: 129.29461,
  statuses: ['in use'],
  capacityMw: 7489,
  operator: 'Korea Hydro & Nuclear Power',
  country: 'South Korea',
  startYear: 1978,
  endYear: null,
};
const WASTE = {
  ...BASE,
  id: 'Q899724',
  name: 'Důl Bratrství',
  kinds: ['deep-geological'],
  lat: 50.37444,
  lon: 12.94,
  place: 'Jáchymov',
  country: 'Czech Republic',
  operator: null,
};
const ACCIDENT = {
  ...BASE,
  id: 'Q486',
  name: 'Chernobyl disaster',
  kinds: ['disaster'],
  date: '1986-04-26',
  lat: 51.38944,
  lon: 30.09917,
  ines: 7,
  deaths: 4000,
  country: 'Soviet Union',
};

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

function build(create, s, answer) {
  const requests = [];
  const layer = create({
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

test('each nuclear layer loads its own bundled snapshot into styled points with cards', async () => {
  const cases = [
    [
      'plants',
      createNuclearPowerPlantsLayer,
      PLANT,
      'Kori Nuclear Power Plant',
      'nuclear-power-plants',
    ],
    [
      'waste',
      createNuclearWasteSitesLayer,
      WASTE,
      'Důl Bratrství',
      'nuclear-waste-sites',
    ],
    [
      'accidents',
      createNuclearAccidentsLayer,
      ACCIDENT,
      'Chernobyl disaster',
      'nuclear-accidents',
    ],
  ];
  for (const [kind, create, record, title, id] of cases) {
    const s = scene();
    const { layer, requests } = build(create, s, () =>
      Response.json({ source: 'Wikidata', records: [record] }),
    );
    assert.equal(layer.id, id);
    layer.init(s.viewer);
    layer.enable(s.viewer);
    assert.equal(await layer.update(s.viewer, {}), true);
    assert.deepEqual(requests, [[NUCLEAR_SNAPSHOT_URLS[kind], 'force-cache']]);
    assert.match(
      NUCLEAR_SNAPSHOT_URLS[kind],
      new RegExp(`/data/local_data/nuclear/${id}\\.json$`),
    );
    assert.deepEqual(layer.getStats(), { count: 1, lastUpdate: T0 });
    s.pick.result = { primitive: { id: `${id}:${record.id}` } };
    s.click.handler({ x: 1, y: 1 });
    const [card] = s.overlayHost.entries.get(`${id}-selected`);
    assert.equal(card.title, title);
  }
});

test('a missing snapshot reports the layer unavailable', async () => {
  const s = scene();
  const { layer } = build(
    createNuclearAccidentsLayer,
    s,
    () => new Response('gone', { status: 404 }),
  );
  layer.init(s.viewer);
  layer.enable(s.viewer);
  await layer.update(s.viewer, {});
  assert.deepEqual(layer.getStats(), {
    count: 0,
    lastUpdate: null,
    error: 'Nuclear accident data unavailable',
  });
});
