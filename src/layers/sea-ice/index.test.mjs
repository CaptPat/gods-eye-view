import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SEA_ICE_OPACITY,
  SEA_ICE_REFRESH_MS,
  createSeaIceLayer,
} from './index.js';
import { SEA_ICE_PROBE_URL } from './model.js';

const NOW = Date.UTC(2026, 8, 15, 18);
const CREDIT = { key: 'nasa-gibs-sea-ice', html: 'Sea ice' };
const DATED = { headers: { 'Layer-Time-Actual': '2026-09-07T00:00:00Z' } };

function harness(initialAnswer = DATED) {
  const calls = [];
  const imagery = {
    show: (day) => calls.push(['show', day]),
    clear: () => calls.push(['clear']),
    reseat: () => calls.push(['reseat']),
    setAlpha: (alpha) => calls.push(['setAlpha', alpha]),
    destroy: () => calls.push(['destroy']),
  };
  const state = {
    answer: initialAnswer,
    requests: [],
    credited: [],
    renders: [],
    now: NOW,
  };
  const events = new EventTarget();
  const layer = createSeaIceLayer({
    fetchImpl: async (url, init = {}) => {
      state.requests.push(url);
      if (init.signal?.aborted)
        throw new DOMException('The operation was aborted', 'AbortError');
      if (state.answer instanceof Error) throw state.answer;
      return new Response('png', {
        status: state.answer.status ?? 200,
        headers: state.answer.headers ?? {},
      });
    },
    createImagery: () => imagery,
    registerCredit: (_viewer, credit) => state.credited.push(credit),
    credit: CREDIT,
    eventTarget: events,
    requestRender: (reason) => state.renders.push(reason),
    now: () => state.now,
  });
  layer.init({});
  return { layer, calls, state, events };
}

const shows = (calls) => calls.filter(([name]) => name === 'show');

test('a refresh pins the imagery to the newest day GIBS reports', async () => {
  const { layer, calls, state } = harness();
  assert.deepEqual(
    [layer.id, layer.name, layer.updateInterval],
    ['sea-ice', 'Sea Ice', SEA_ICE_REFRESH_MS],
  );
  assert.deepEqual(calls, [['setAlpha', SEA_ICE_OPACITY]]);
  layer.enable({});
  assert.deepEqual(state.credited, [CREDIT]);

  assert.equal(await layer.update({}, {}), true);
  assert.deepEqual(state.requests, [SEA_ICE_PROBE_URL]);
  assert.deepEqual(shows(calls), [['show', '2026-09-07']]);
  assert.ok(state.renders.includes('sea-ice'));
  assert.deepEqual(layer.getStats(), {
    status: 'ok',
    source: 'GHRSST MUR · 2026-09-07',
    lastUpdate: NOW,
  });

  state.now += 1000;
  await layer.update({}, {});
  assert.equal(shows(calls).length, 1, 'the same day is not redrawn');
  state.answer = { headers: { 'Layer-Time-Actual': '2026-09-08T00:00:00Z' } };
  await layer.update({}, {});
  assert.deepEqual(shows(calls).at(-1), ['show', '2026-09-08']);
});

test('without a date from GIBS the latest day still draws, and the row says so', async () => {
  for (const answer of [
    new Error('offline'),
    { status: 503 },
    { headers: {} },
  ]) {
    const { layer, calls } = harness(answer);
    layer.enable({});
    assert.equal(await layer.update({}, {}), true);
    assert.deepEqual(shows(calls), [['show', 'default']]);
    assert.deepEqual(layer.getStats(), {
      stale: true,
      source: 'GHRSST MUR · latest day',
      lastUpdate: null,
      error: 'Sea ice date unavailable — showing the latest day',
    });
  }

  const { layer, calls, state } = harness();
  layer.enable({});
  await layer.update({}, {});
  state.answer = new Error('offline');
  await layer.update({}, {});
  assert.equal(shows(calls).length, 1, 'a failed refresh keeps the dated day');
  assert.deepEqual(layer.getStats(), {
    stale: true,
    source: 'GHRSST MUR · 2026-09-07',
    lastUpdate: NOW,
    error: 'Sea ice refresh failed — showing 2026-09-07',
  });
});

test('the Google 3D map source hides the imagery, and stack changes reseat it', async () => {
  const { layer, calls, state, events } = harness();
  layer.enable({});
  await layer.update({}, {});
  let active = 'photoreal';
  layer.attachMapStack({ getActiveId: () => active });
  assert.deepEqual(layer.getStats(), {
    status: 'idle',
    source: 'GHRSST MUR',
    statusMessage: 'Hidden by Google 3D map source',
  });
  active = 'globe';
  events.dispatchEvent(
    new CustomEvent('gev:map-stack-changed', {
      detail: { activeStack: { id: 'globe' } },
    }),
  );
  assert.deepEqual(calls.at(-1), ['reseat']);
  assert.equal(layer.getStats().status, 'ok');
  assert.ok(state.renders.length > 1);
});

test('an aborted manager refresh reports false; disabling clears; destroying stops listening', async () => {
  const { layer, calls, events } = harness();
  layer.enable({});
  const controller = new AbortController();
  controller.abort();
  assert.equal(await layer.update({}, { signal: controller.signal }), false);
  assert.deepEqual(shows(calls), []);

  await layer.update({}, {});
  layer.disable();
  assert.deepEqual(calls.at(-1), ['clear']);
  assert.deepEqual(layer.getStats(), {
    status: 'ok',
    source: 'GHRSST MUR',
    lastUpdate: null,
  });
  assert.equal(
    await layer.update({}, {}),
    false,
    'a disabled layer does not refresh',
  );

  layer.destroy();
  assert.deepEqual(calls.at(-1), ['destroy']);
  const before = calls.length;
  events.dispatchEvent(new CustomEvent('gev:map-stack-changed'));
  assert.equal(calls.length, before);
});
