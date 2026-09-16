import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MARINE_DEPTHS_ERROR_WINDOW_MS,
  createMarineDepthsLayer,
} from './index.js';

const NOW = Date.UTC(2026, 8, 16, 22);
const CREDIT = { key: 'noaa-marine-depths', html: 'Depths' };

function harness() {
  const calls = [];
  const state = { now: NOW, credited: [], renders: [], onTileError: null };
  let shown = false;
  const imagery = {
    show: () => {
      shown = true;
      calls.push('show');
    },
    shown: () => shown,
    clear: () => {
      shown = false;
      calls.push('clear');
    },
    reseat: () => calls.push('reseat'),
    destroy: () => calls.push('destroy'),
  };
  const events = new EventTarget();
  const layer = createMarineDepthsLayer({
    createImagery: (_viewer, { onTileError }) => {
      state.onTileError = onTileError;
      return imagery;
    },
    registerCredit: (_viewer, credit) => state.credited.push(credit),
    credit: CREDIT,
    eventTarget: events,
    requestRender: (reason) => state.renders.push(reason),
    now: () => state.now,
  });
  layer.init({});
  return { layer, calls, state, events };
}

test('enable shows the imagery and credits NOAA; disable clears it', async () => {
  const { layer, calls, state } = harness();
  assert.deepEqual(
    [layer.id, layer.name, layer.source, layer.updateInterval],
    ['marine-depths', 'Marine Depths', 'NOAA', 0],
  );
  layer.enable({});
  assert.deepEqual(calls, ['show']);
  assert.deepEqual(state.credited, [CREDIT]);
  assert.equal(await layer.update({}), true);
  assert.deepEqual(layer.getStats(), {
    status: 'ok',
    source: 'NOAA',
    lastUpdate: NOW,
  });
  assert.ok(state.renders.every((r) => r === 'marine-depths'));

  layer.disable();
  assert.deepEqual(calls, ['show', 'clear']);
  assert.equal(await layer.update({}), false);
});

test('recent tile failures mark the row stale, then age out', () => {
  const { layer, state } = harness();
  state.onTileError({});
  layer.enable({});
  assert.equal(layer.getStats().status, 'ok', 'failures while off are ignored');
  state.onTileError({});
  assert.deepEqual(layer.getStats(), {
    stale: true,
    source: 'NOAA',
    lastUpdate: NOW,
    error: 'Some NOAA depth tiles failed to load',
  });
  state.now += MARINE_DEPTHS_ERROR_WINDOW_MS;
  assert.equal(layer.getStats().status, 'ok');
});

test('a map-stack switch reseats the imagery; photoreal reports it hidden', () => {
  const { layer, calls, events } = harness();
  layer.enable({});
  events.dispatchEvent(
    Object.assign(new Event('gev:map-stack-changed'), {
      detail: { activeStack: { id: 'photoreal' } },
    }),
  );
  assert.deepEqual(calls, ['show', 'reseat']);
  assert.deepEqual(layer.getStats(), {
    status: 'idle',
    source: 'NOAA',
    statusMessage: 'Hidden by Google 3D map source',
  });
  layer.attachMapStack({ getActiveId: () => 'google-2d' });
  assert.equal(layer.getStats().status, 'ok', 'the attached controller wins');
});

test('destroy disables, detaches and releases the imagery', () => {
  const { layer, calls, events } = harness();
  layer.enable({});
  layer.destroy();
  assert.deepEqual(calls, ['show', 'clear', 'destroy']);
  events.dispatchEvent(new Event('gev:map-stack-changed'));
  assert.deepEqual(calls, ['show', 'clear', 'destroy'], 'no listener remains');
});
