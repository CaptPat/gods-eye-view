import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HERITAGE_SNAPSHOT_URLS,
  createFortsCastlesLayer,
  createParksMonumentsLayer,
  createWorldHeritageLayer,
} from './index.js';
import { HERITAGE_FIELDS } from './model.js';

const T0 = Date.UTC(2026, 8, 15, 15, 0);
const ROWS = {
  worldHeritage: [
    'Q192666',
    'Białowieża Forest',
    52.75,
    23.95,
    ['Belarus', 'Poland'],
    1932,
    'Bia%C5%82owie%C5%BCa_Forest',
    'old forest in Poland and Belarus',
  ],
  forts: [
    'Q150039',
    'Neuf-Brisach',
    'star-fort',
    48.01806,
    7.52833,
    'France',
    'Neuf-Brisach',
  ],
  parks: [
    'Q119150',
    'Björnlandet National Park',
    'park',
    63.97404,
    18.01487,
    'Sweden',
    1991,
    'Bj%C3%B6rnlandet_National_Park',
    'national park of Sweden',
  ],
};

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

test('each heritage layer loads its own compact snapshot into points with linked cards', async () => {
  const cases = [
    [
      'worldHeritage',
      createWorldHeritageLayer,
      'world-heritage',
      'Białowieża Forest',
    ],
    ['forts', createFortsCastlesLayer, 'forts-castles', 'Neuf-Brisach'],
    [
      'parks',
      createParksMonumentsLayer,
      'parks-monuments',
      'Björnlandet National Park',
    ],
  ];
  for (const [kind, create, id, title] of cases) {
    const s = scene();
    const { layer, requests } = build(create, s, () =>
      Response.json({
        source: 'Wikidata',
        fields: HERITAGE_FIELDS[kind],
        rows: [ROWS[kind]],
      }),
    );
    assert.equal(layer.id, id);
    layer.init(s.viewer);
    layer.enable(s.viewer);
    assert.equal(await layer.update(s.viewer, {}), true);
    assert.deepEqual(requests, [[HERITAGE_SNAPSHOT_URLS[kind], 'force-cache']]);
    assert.match(
      HERITAGE_SNAPSHOT_URLS[kind],
      new RegExp(`/data/local_data/heritage/${id}\\.json$`),
    );
    assert.deepEqual(layer.getStats(), { count: 1, lastUpdate: T0 });
    s.pick.result = { primitive: { id: `${id}:${ROWS[kind][0]}` } };
    s.click.handler({ x: 1, y: 1 });
    const [card] = s.overlayHost.entries.get(`${id}-selected`);
    assert.equal(card.title, title);
    assert.equal(card.interactive, true);
  }
});

test('a missing snapshot reports Forts & Castles unavailable', async () => {
  const s = scene();
  const { layer } = build(
    createFortsCastlesLayer,
    s,
    () => new Response('gone', { status: 404 }),
  );
  layer.init(s.viewer);
  layer.enable(s.viewer);
  await layer.update(s.viewer, {});
  assert.deepEqual(layer.getStats(), {
    count: 0,
    lastUpdate: null,
    error: 'Fort and castle data unavailable',
  });
});
