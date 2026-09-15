import test from 'node:test';
import assert from 'node:assert/strict';
import { OVERPASS_URL, createOsmInfrastructureSource } from './source.js';

const QUERY =
  '[out:json][timeout:25];(node["power"="plant"](30,-97,30.5,-96.5););out tags geom 10;';

test('a query is POSTed to the shared Overpass proxy as form data, returning elements and the stale flag', async () => {
  const calls = [];
  const source = createOsmInfrastructureSource({
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({ elements: [{ type: 'node', id: 1 }] }),
        {
          headers: {
            'content-type': 'application/json',
            'x-overpass-cache': 'STALE',
          },
        },
      );
    },
  });
  const result = await source.fetch(QUERY, new AbortController().signal);
  assert.equal(OVERPASS_URL, '/api/overpass');
  assert.equal(calls[0].url, '/api/overpass');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(
    calls[0].init.headers['Content-Type'],
    'application/x-www-form-urlencoded',
  );
  assert.equal(calls[0].init.body, `data=${encodeURIComponent(QUERY)}`);
  assert.deepEqual(result, {
    elements: [{ type: 'node', id: 1 }],
    stale: true,
  });
});

test('a fresh answer is not stale', async () => {
  const source = createOsmInfrastructureSource({
    fetchImpl: async () => Response.json({ elements: [] }),
  });
  assert.deepEqual(await source.fetch(QUERY), { elements: [], stale: false });
});

test('refusals and incomplete answers throw readable errors, and an aborted request never fetches', async () => {
  for (const [status, message] of [
    [429, 'Overpass rate-limited'],
    [504, 'Overpass timed out'],
    [502, 'Overpass temporarily unavailable'],
  ]) {
    const source = createOsmInfrastructureSource({
      fetchImpl: async () => new Response('busy', { status }),
    });
    await assert.rejects(source.fetch(QUERY), new RegExp(message));
  }
  for (const body of [
    { elements: [], remark: 'runtime error: timeout' },
    { elements: 'nope' },
  ]) {
    const source = createOsmInfrastructureSource({
      fetchImpl: async () => Response.json(body),
    });
    await assert.rejects(source.fetch(QUERY), /incomplete/);
  }
  let fetched = 0;
  const source = createOsmInfrastructureSource({
    fetchImpl: async () => {
      fetched += 1;
      return Response.json({ elements: [] });
    },
  });
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(source.fetch(QUERY, aborted.signal), {
    name: 'AbortError',
  });
  assert.equal(fetched, 0);
});
