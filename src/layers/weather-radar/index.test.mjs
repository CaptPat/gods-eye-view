import test from 'node:test';
import assert from 'node:assert/strict';
import { REFRESH_MS, SWAP_CHECK_MS, createWeatherRadarLayer } from './index.js';
import defaultLayer from '../../data/weatherRadar.js';
import { IEM_NEXRAD_CREDIT, RAINVIEWER_CREDIT } from '../../data/dataCredits.js';

const T = Date.UTC(2026, 8, 14, 4, 50);
const MIN = 60_000;
const frames = (count, newest = T) => Array.from({ length: count }, (_, i) => ({ time: newest - (count - 1 - i) * 10 * MIN }));

function fakeImagery() {
  const calls = [];
  const ready = new Set();
  const layers = new Set();
  let shown = null;
  let source = null;
  const api = {
    setSource(next) { calls.push(['setSource', next]); if (next !== source) { layers.clear(); ready.clear(); shown = null; } source = next; },
    preload(times) { calls.push(['preload', [...times]]); for (const time of times) layers.add(time); },
    show(time) { calls.push(['show', time]); layers.add(time); shown = time; },
    setAlpha(alpha) { calls.push(['setAlpha', alpha]); },
    release(keep) { calls.push(['release', [...keep]]); for (const time of [...layers]) if (!keep.includes(time)) layers.delete(time); },
    isReady: (time) => ready.has(time),
    readyCount: () => [...layers].filter((time) => ready.has(time)).length,
    shownTime: () => shown,
    clear() { calls.push(['clear']); layers.clear(); shown = null; },
    destroy() { calls.push(['destroy']); },
  };
  return { api, calls, ready, layers, source: () => source };
}

function fakeTimers() {
  let pending = [];
  return {
    setTimeout(fn, ms) { const timer = { fn, ms }; pending.push(timer); return timer; },
    clearTimeout(timer) { pending = pending.filter((t) => t !== timer); },
    delays: () => pending.map((t) => t.ms),
    run(ms) {
      const timer = pending.find((t) => t.ms === ms);
      assert.ok(timer, `no pending ${ms} ms timer (pending: ${pending.map((t) => t.ms)})`);
      pending = pending.filter((t) => t !== timer);
      timer.fn();
    },
  };
}

function harness({ payloads = {}, visible = true } = {}) {
  const imagery = fakeImagery();
  const timers = fakeTimers();
  const credited = [];
  const requests = [];
  const events = new EventTarget();
  const clock = { now: T + 7 * MIN, visible };
  const answers = { rainviewer: { source: 'rainviewer', stale: false, frames: frames(13) }, iem: { source: 'iem', stale: false, frames: frames(13) }, ...payloads };
  const layer = createWeatherRadarLayer({
    fetchImpl: async (url) => {
      requests.push(url);
      const source = new URL(url, 'http://app.local').searchParams.get('source');
      const answer = answers[source];
      if (answer instanceof Error) throw answer;
      return Response.json(answer);
    },
    createImagery: () => imagery.api,
    registerCredit: (_viewer, credit) => credited.push(credit.key),
    credits: { rainviewer: { key: 'rainviewer', html: 'rv' }, iem: { key: 'iem', html: 'iem' } },
    eventTarget: events,
    isVisible: () => clock.visible,
    timers,
    now: () => clock.now,
  });
  const viewer = {};
  return { layer, imagery, timers, credited, requests, events, clock, answers, viewer };
}

async function enabled(h) {
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  await h.layer.update(h.viewer, {});
}

test('the layer identifies itself and refreshes every five minutes', () => {
  const { layer } = harness();
  assert.equal(layer.id, 'weather-radar');
  assert.equal(layer.name, 'Weather Radar');
  assert.equal(layer.icon, '🌧️');
  assert.equal(layer.updateInterval, REFRESH_MS);
  assert.equal(REFRESH_MS, 300_000);
  assert.equal(defaultLayer.id, 'weather-radar');
  assert.equal(RAINVIEWER_CREDIT.html, 'Radar: <a href="https://www.rainviewer.com/" target="_blank" rel="noopener">RainViewer</a>');
  assert.equal(IEM_NEXRAD_CREDIT.html, 'US radar: <a href="https://mesonet.agron.iastate.edu/" target="_blank" rel="noopener">Iowa Environmental Mesonet</a> NEXRAD');
});

test('enabling credits RainViewer, fetches frames and shows the newest with an honest age', async () => {
  const h = harness();
  await enabled(h);
  assert.deepEqual(h.credited, ['rainviewer']);
  assert.deepEqual(h.requests, ['/api/radar/frames?source=rainviewer']);
  assert.equal(h.imagery.api.shownTime(), T);
  // count 13, not 12: retention counts back from the newest frame, so the 7-minute lag drops nothing.
  assert.deepEqual(h.layer.getStats(), { status: 'ok', source: 'RainViewer · 04:50 UTC · 7 min old', count: 13, lastUpdate: T + 7 * MIN });
  assert.equal(h.layer.getRowControls().chips[0].disabled, false);
});

test('a hidden tab skips refreshes; failures report stale or unavailable', async () => {
  const h = harness();
  await enabled(h);
  h.clock.visible = false;
  assert.equal(await h.layer.update(h.viewer, {}), true, 'a skipped refresh is not a failure');
  assert.equal(h.requests.length, 1);

  h.clock.visible = true;
  h.answers.rainviewer = new Error('offline');
  assert.equal(await h.layer.update(h.viewer, {}), true, 'the failure is reported through stats, which the manager reads');
  assert.deepEqual(h.layer.getStats(), {
    stale: true, source: 'RainViewer · 04:50 UTC', error: 'Radar source unavailable — showing 04:50 UTC', count: 13, lastUpdate: T + 7 * MIN,
  });

  const cold = harness({ payloads: { rainviewer: new Error('offline') } });
  await enabled(cold);
  assert.deepEqual(cold.layer.getStats(), { status: 'unavailable', source: 'RainViewer', error: 'Radar source unavailable' });
});

test('a new newest frame is shown only once its tiles are ready', async () => {
  const h = harness();
  await enabled(h);
  h.answers.rainviewer = { source: 'rainviewer', stale: false, frames: frames(13, T + 10 * MIN) };
  h.clock.now = T + 17 * MIN;
  await h.layer.update(h.viewer, {});
  assert.equal(h.imagery.api.shownTime(), T, 'still showing the old frame');
  assert.ok(h.timers.delays().includes(SWAP_CHECK_MS));
  h.imagery.ready.add(T + 10 * MIN);
  h.timers.run(SWAP_CHECK_MS);
  assert.equal(h.imagery.api.shownTime(), T + 10 * MIN);
  assert.deepEqual([...h.imagery.layers], [T + 10 * MIN], 'older frames released');
});

test('the loop preloads every frame, steps through ready frames, and pause returns to live', async () => {
  const h = harness({ payloads: { rainviewer: { source: 'rainviewer', stale: false, frames: frames(3) } } });
  await enabled(h);
  assert.notEqual(h.layer.setParams({ loop: true }, { origin: 'user' }), false);
  assert.deepEqual(h.imagery.calls.find(([name]) => name === 'preload')[1], frames(3).map((f) => f.time));
  assert.deepEqual(h.layer.getStats(), { loading: true, source: 'RainViewer · Loading 0/3' });
  h.imagery.ready.add(frames(3)[0].time);
  h.imagery.ready.add(frames(3)[2].time);
  h.timers.run(500);
  assert.equal(h.imagery.api.shownTime(), frames(3)[0].time, 'the loop starts at the oldest ready frame');
  h.timers.run(500);
  assert.equal(h.imagery.api.shownTime(), frames(3)[2].time, 'a frame that is not ready is skipped');
  assert.ok(h.timers.delays().includes(1500), 'the newest frame holds');
  h.imagery.ready.add(frames(3)[1].time);
  h.timers.run(1500);
  assert.equal(h.imagery.api.shownTime(), frames(3)[0].time, 'a frame becoming ready mid-loop does not derail the order');
  assert.equal(h.layer.getRowControls().chips[0].label, '❚❚ Pause');
  h.layer.setParams({ loop: false }, { origin: 'user' });
  assert.deepEqual(h.timers.delays().filter((ms) => ms === 500 || ms === 1500), []);
  assert.equal(h.imagery.api.shownTime(), T);
  assert.deepEqual(h.layer.getParams(), { usDetail: false, opacity: 0.7 }, 'loop state is not a persisted param');
});

test('US detail switches source, credits Iowa State and refetches; opacity is applied and validated', async () => {
  const h = harness();
  await enabled(h);
  h.imagery.ready.add(T);
  assert.notEqual(h.layer.setParams({ usDetail: true }, { origin: 'user' }), false);
  assert.deepEqual(h.credited, ['rainviewer', 'iem']);
  assert.equal(h.requests.at(-1), '/api/radar/frames?source=iem', 'switching refetches at once');
  // A second update supersedes the switch's in-flight request, so this await settles both.
  assert.equal(await h.layer.update(h.viewer, {}), true);
  assert.equal(h.imagery.source(), 'iem');
  assert.equal(h.layer.getStats().source, 'Iowa State NEXRAD · 04:50 UTC · 7 min old');
  assert.equal(h.layer.getRowControls().legend[0].color, '#00ff00');

  assert.notEqual(h.layer.setParams({ opacity: 0.4 }, { origin: 'user' }), false);
  assert.deepEqual(h.imagery.calls.filter(([name]) => name === 'setAlpha').at(-1), ['setAlpha', 0.4]);
  assert.equal(h.layer.setParams({ opacity: 0.5 }, { origin: 'user' }), false);
  assert.equal(h.layer.setParams({ usDetail: 'yes' }, { origin: 'user' }), false);
  assert.deepEqual(h.layer.getParams(), { usDetail: true, opacity: 0.4 });
});

test('params restored before init apply once the layer runs', async () => {
  const h = harness();
  assert.notEqual(h.layer.setParams({ usDetail: true, opacity: 1 }, { origin: 'local-restore' }), false);
  await enabled(h);
  assert.equal(h.requests[0], '/api/radar/frames?source=iem');
  assert.deepEqual(h.imagery.calls.filter(([name]) => name === 'setAlpha')[0], ['setAlpha', 1]);
});

test('Google 3D is reported from the attached controller and from map-stack events', async () => {
  const h = harness();
  h.layer.attachMapStack({ getActiveId: () => 'photoreal' });
  await enabled(h);
  assert.deepEqual(h.layer.getStats(), { status: 'idle', source: 'RainViewer', statusMessage: 'Hidden by Google 3D map source', count: 13 });
  h.events.dispatchEvent(new CustomEvent('gev:map-stack-changed', { detail: { activeStack: { id: 'esri-imagery' } } }));
  assert.equal(h.layer.getStats().status, 'ok');
});

test('row-control listeners are notified; disable clears imagery and stops the loop; destroy unsubscribes', async () => {
  const h = harness({ payloads: { rainviewer: { source: 'rainviewer', stale: false, frames: frames(3) } } });
  let notified = 0;
  h.layer.setRowControlsListener(() => { notified += 1; });
  await enabled(h);
  assert.ok(notified > 0);
  h.layer.setParams({ loop: true }, { origin: 'user' });
  h.layer.disable(h.viewer);
  assert.deepEqual(h.timers.delays().filter((ms) => ms === 500 || ms === 1500), []);
  assert.equal(h.imagery.calls.at(-1)[0], 'clear');
  h.layer.destroy(h.viewer);
  assert.equal(h.imagery.calls.at(-1)[0], 'destroy');
  h.events.dispatchEvent(new CustomEvent('gev:map-stack-changed', { detail: { activeStack: { id: 'photoreal' } } }));
  assert.equal(h.layer.getStats().status === 'idle', false, 'destroyed layer no longer listens');
});
