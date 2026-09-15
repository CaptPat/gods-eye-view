import test from 'node:test';
import assert from 'node:assert/strict';
import { AIRPORTS_SNAPSHOT_URL, createAirportsLayer } from './index.js';
import { AIRPORT_FIELDS } from './source.js';

const T0 = Date.UTC(2026, 8, 15, 14, 0);
const JFK_ROW = [
  'KJFK',
  'large',
  'John F. Kennedy International Airport',
  'KJFK',
  'JFK',
  40.6394,
  -73.7793,
  13,
  'New York',
  'US',
  true,
  'https://en.wikipedia.org/wiki/John_F._Kennedy_International_Airport',
];

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

function build(s, answer) {
  const requests = [];
  const layer = createAirportsLayer({
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

test('Airports loads its bundled snapshot into sized points with code cards linking out', async () => {
  const s = scene();
  const { layer, requests } = build(s, () =>
    Response.json({
      source: 'OurAirports',
      fields: AIRPORT_FIELDS,
      rows: [JFK_ROW],
    }),
  );
  assert.deepEqual(
    [layer.id, layer.name, layer.source],
    ['airports', 'Airports', 'OurAirports'],
  );
  layer.init(s.viewer);
  layer.enable(s.viewer);
  assert.equal(await layer.update(s.viewer, {}), true);
  assert.deepEqual(requests, [[AIRPORTS_SNAPSHOT_URL, 'force-cache']]);
  assert.match(
    AIRPORTS_SNAPSHOT_URL,
    /\/data\/local_data\/airports\/airports\.json$/,
  );
  assert.deepEqual(layer.getStats(), { count: 1, lastUpdate: T0 });
  assert.equal(s.primitives[0].get(0).pixelSize, 7);
  s.pick.result = { primitive: { id: 'airports:KJFK' } };
  s.click.handler({ x: 1, y: 1 });
  const [card] = s.overlayHost.entries.get('airports-selected');
  assert.deepEqual(card.details[0], 'ICAO KJFK · IATA JFK');
  assert.equal(card.interactive, true);
});

test('a missing snapshot reports Airports unavailable', async () => {
  const s = scene();
  const { layer } = build(s, () => new Response('gone', { status: 404 }));
  layer.init(s.viewer);
  layer.enable(s.viewer);
  await layer.update(s.viewer, {});
  assert.deepEqual(layer.getStats(), {
    count: 0,
    lastUpdate: null,
    error: 'Airport data unavailable',
  });
});
