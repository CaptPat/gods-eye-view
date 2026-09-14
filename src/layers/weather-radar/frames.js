export const RETAIN_MS = 2 * 60 * 60 * 1000;
export const LOOP_FRAME_MS = 500;
export const LOOP_HOLD_MS = 1500;

/** Validate a `/api/radar/frames` payload into sorted, unique frames. */
export function parseFramesPayload(payload) {
  if (!payload || !Array.isArray(payload.frames)) return null;
  const times = payload.frames
    .map((frame) => Number(frame?.time))
    .filter((time) => Number.isFinite(time) && time > 0);
  return {
    source: payload.source === 'iem' ? 'iem' : 'rainviewer',
    stale: payload.stale === true,
    frames: [...new Set(times)].sort((a, b) => a - b).map((time) => ({ time })),
  };
}

export function pruneFrames(frames, nowMs, retainMs = RETAIN_MS) {
  return frames.filter((frame) => frame.time >= nowMs - retainMs);
}

export function newestFrame(frames) {
  return frames.length ? frames[frames.length - 1] : null;
}

/** The latest frame whose time is at or before `timeMs`; frames are sorted oldest first. */
export function frameAtOrBefore(frames, timeMs) {
  let hit = null;
  for (const frame of frames) {
    if (frame.time > timeMs) break;
    hit = frame;
  }
  return hit;
}

/** Next loop position and how long to show it: the newest frame holds longer. */
export function nextLoopStep(index, count) {
  if (count <= 0) return { index: -1, delayMs: LOOP_HOLD_MS };
  const next = index + 1 >= count ? 0 : index + 1;
  return {
    index: next,
    delayMs: next === count - 1 ? LOOP_HOLD_MS : LOOP_FRAME_MS,
  };
}
