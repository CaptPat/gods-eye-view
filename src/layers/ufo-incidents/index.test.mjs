import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { UFO_SNAPSHOT_URL, createUfoIncidentsLayer } from './index.js';

const T0 = Date.UTC(2026, 8, 15, 12, 0);
const SNAPSHOT = JSON.parse(
  readFileSync(
    new URL(
      '../../data/local_data/ufo_incidents/ufo-incidents.json',
      import.meta.url,
    ),
    'utf8',
  ),
);

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
  const click = { handler: null };
  return { viewer, primitives, pick, overlayHost, click };
}

test('UFO Incidents loads the bundled Wikidata snapshot and opens Wikipedia-linked cards', async () => {
  const s = scene();
  const requests = [];
  const layer = createUfoIncidentsLayer({
    overlayHost: s.overlayHost,
    fetchImpl: async (url, init) => {
      requests.push({ url, cache: init?.cache });
      return Response.json(SNAPSHOT);
    },
    createClickHandler: (_viewer, onClick) => {
      s.click.handler = onClick;
      return { destroy() {} };
    },
    now: () => T0,
  });
  assert.deepEqual(
    [layer.id, layer.name, layer.source],
    ['ufo-incidents', 'UFO Incidents', 'Wikidata'],
  );
  layer.init(s.viewer);
  layer.enable(s.viewer);
  assert.equal(await layer.update(s.viewer, {}), true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, UFO_SNAPSHOT_URL);
  assert.match(
    UFO_SNAPSHOT_URL,
    /\/data\/local_data\/ufo_incidents\/ufo-incidents\.json$/,
  );
  assert.equal(requests[0].cache, 'force-cache');
  assert.equal(layer.getStats().count, SNAPSHOT.incidents.length);
  assert.ok(
    SNAPSHOT.incidents.length >= 40,
    'the snapshot carries dozens of incidents',
  );

  const phoenix = SNAPSHOT.incidents.find(
    (incident) => incident.name === 'Phoenix Lights',
  );
  s.pick.result = { primitive: { id: `ufo-incidents:${phoenix.id}` } };
  s.click.handler({ x: 1, y: 1 });
  const [card] = s.overlayHost.entries.get('ufo-incidents-selected');
  assert.equal(card.title, 'Phoenix Lights');
  assert.equal(card.accent, '#39ff14');
  assert.match(card.details[0], /^Sighting.* · 13 Mar 1997$/);
  assert.equal(card.details[1], 'Somewhere in Arizona (approximate)');
  assert.equal(card.interactive, true);
});

test('a missing or malformed snapshot reports the layer unavailable', async () => {
  for (const answer of [
    () => new Response('gone', { status: 404 }),
    () => Response.json({ incidents: 'nope' }),
  ]) {
    const s = scene();
    const layer = createUfoIncidentsLayer({
      overlayHost: s.overlayHost,
      fetchImpl: async () => answer(),
      createClickHandler: () => ({ destroy() {} }),
      now: () => T0,
    });
    layer.init(s.viewer);
    layer.enable(s.viewer);
    await layer.update(s.viewer, {});
    assert.deepEqual(layer.getStats(), {
      count: 0,
      lastUpdate: null,
      error: 'UFO incidents unavailable',
    });
  }
});
