import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LOOP_FRAME_MS, LOOP_HOLD_MS, RETAIN_MS,
  frameAtOrBefore, newestFrame, nextLoopStep, parseFramesPayload, pruneFrames,
} from './frames.js';

const T = Date.UTC(2026, 8, 14, 4, 50);
const MIN = 60_000;

test('a frames payload is validated, de-duplicated and sorted oldest first', () => {
  assert.deepEqual(
    parseFramesPayload({ source: 'iem', stale: true, frames: [{ time: T }, { time: T - 10 * MIN }, { time: T }, { time: 'x' }, null] }),
    { source: 'iem', stale: true, frames: [{ time: T - 10 * MIN }, { time: T }] },
  );
  assert.deepEqual(parseFramesPayload({ frames: [] }), { source: 'rainviewer', stale: false, frames: [] });
  assert.equal(parseFramesPayload(null), null);
  assert.equal(parseFramesPayload({ frames: 'nope' }), null);
});

test('frames older than the retention window are pruned', () => {
  const frames = [{ time: T - RETAIN_MS - 1 }, { time: T - RETAIN_MS }, { time: T }];
  assert.deepEqual(pruneFrames(frames, T), [{ time: T - RETAIN_MS }, { time: T }]);
});

test('newest and at-or-before selection', () => {
  const frames = [{ time: T - 20 * MIN }, { time: T - 10 * MIN }, { time: T }];
  assert.deepEqual(newestFrame(frames), { time: T });
  assert.equal(newestFrame([]), null);
  assert.equal(frameAtOrBefore(frames, T - 21 * MIN), null);
  assert.deepEqual(frameAtOrBefore(frames, T - 10 * MIN), { time: T - 10 * MIN });
  assert.deepEqual(frameAtOrBefore(frames, T - 5 * MIN), { time: T - 10 * MIN });
  assert.deepEqual(frameAtOrBefore(frames, T + MIN), { time: T });
});

test('the loop steps 500 ms per frame and holds 1500 ms on the newest, then wraps', () => {
  const steps = [];
  let index = -1;
  for (let i = 0; i < 4; i += 1) {
    const step = nextLoopStep(index, 3);
    steps.push(step);
    index = step.index;
  }
  assert.deepEqual(steps, [
    { index: 0, delayMs: LOOP_FRAME_MS },
    { index: 1, delayMs: LOOP_FRAME_MS },
    { index: 2, delayMs: LOOP_HOLD_MS },
    { index: 0, delayMs: LOOP_FRAME_MS },
  ]);
  assert.deepEqual(nextLoopStep(0, 0), { index: -1, delayMs: LOOP_HOLD_MS });
});
