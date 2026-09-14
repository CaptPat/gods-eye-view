import {
  LOOP_FRAME_MS,
  newestFrame,
  nextLoopStep,
  parseFramesPayload,
  pruneFrames,
} from './frames.js';
import { buildRowControls, normalizeOpacity } from './controls.js';
import { createRadarImagery } from './imagery.js';
import { swapToFrame } from '../weather-imagery/frameImagery.js';

export const REFRESH_MS = 5 * 60 * 1000;
export const SWAP_CHECK_MS = 1000;
const SOURCE_NAMES = Object.freeze({
  rainviewer: 'RainViewer',
  iem: 'Iowa State NEXRAD',
});
const MAP_STACK_EVENT = 'gev:map-stack-changed';

const hhmm = (timeMs) => new Date(timeMs).toISOString().slice(11, 16);

export function createWeatherRadarLayer({
  fetchImpl = (...args) => fetch(...args),
  createImagery = createRadarImagery,
  registerCredit = () => false,
  credits = {},
  eventTarget = globalThis.window,
  isVisible = () => globalThis.document?.visibilityState !== 'hidden',
  timers = {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (timer) => clearTimeout(timer),
  },
  now = Date.now,
  requestRender = () => {},
} = {}) {
  let viewer = null;
  let imagery = null;
  let enabled = false;
  let usDetail = false;
  let opacity = 0.7;
  let playing = false;
  let frames = [];
  let loopTime = null;
  let loopTimer = null;
  let swapTimer = null;
  let lastUpdate = null;
  let error = null;
  let stale = false;
  let mapStackId = null;
  let mapStackController = null;
  let rowListener = null;
  let request = null;

  const currentSource = () => (usDetail ? 'iem' : 'rainviewer');
  const notifyRows = () => rowListener?.();
  const onMapStack = (event) => {
    mapStackId = event?.detail?.activeStack?.id ?? mapStackId;
    notifyRows();
  };

  function clearTimer(timer) {
    if (timer) timers.clearTimeout(timer);
    return null;
  }

  function stopLoop() {
    playing = false;
    loopTime = null;
    loopTimer = clearTimer(loopTimer);
  }

  function renderLive() {
    const newest = newestFrame(frames);
    if (!newest) {
      imagery.clear();
      return;
    }
    if (swapToFrame(imagery, newest.time)) {
      swapTimer = clearTimer(swapTimer);
      return;
    }
    // Do not re-arm while hidden: the next update() re-evaluates via renderLive().
    if (!swapTimer && isVisible()) {
      swapTimer = timers.setTimeout(() => {
        swapTimer = null;
        if (enabled && !playing) renderLive();
        notifyRows();
        requestRender('weather-radar');
      }, SWAP_CHECK_MS);
    }
  }

  function tick() {
    loopTimer = null;
    if (!playing || !imagery) return;
    const readyFrames = frames.filter((frame) => imagery.isReady(frame.time));
    if (readyFrames.length === 0) {
      loopTimer = timers.setTimeout(tick, LOOP_FRAME_MS);
      notifyRows();
      return;
    }
    // Step by frame time, not index: frames turning ready mid-loop shift positions.
    const position = readyFrames.findIndex((frame) => frame.time === loopTime);
    const step = nextLoopStep(position, readyFrames.length);
    loopTime = readyFrames[step.index].time;
    imagery.show(loopTime);
    loopTimer = timers.setTimeout(tick, step.delayMs);
    notifyRows();
    requestRender('weather-radar');
  }

  function startLoop() {
    if (!imagery || frames.length < 2) return;
    playing = true;
    loopTime = null;
    swapTimer = clearTimer(swapTimer);
    imagery.preload(frames.map((frame) => frame.time));
    loopTimer = timers.setTimeout(tick, LOOP_FRAME_MS);
    notifyRows();
  }

  function render() {
    if (!imagery) return;
    if (playing) {
      const times = frames.map((frame) => frame.time);
      imagery.release(times);
      imagery.preload(times);
    } else {
      renderLive();
    }
    notifyRows();
    requestRender('weather-radar');
  }

  const layer = {
    id: 'weather-radar',
    name: 'Weather Radar',
    icon: '🌧️',
    source: 'RainViewer',
    updateInterval: REFRESH_MS,

    init(nextViewer) {
      viewer = nextViewer;
      imagery = createImagery(nextViewer);
      imagery.setAlpha(opacity);
      eventTarget?.addEventListener?.(MAP_STACK_EVENT, onMapStack);
    },

    attachMapStack(mapStack) {
      mapStackController = mapStack ?? null;
      notifyRows();
    },

    enable(nextViewer) {
      enabled = true;
      registerCredit(nextViewer, credits.rainviewer);
      if (usDetail) registerCredit(nextViewer, credits.iem);
      imagery?.setSource(currentSource());
    },

    disable() {
      enabled = false;
      stopLoop();
      swapTimer = clearTimer(swapTimer);
      request?.abort();
      request = null;
      frames = [];
      error = null;
      stale = false;
      imagery?.clear();
      notifyRows();
    },

    async update(_viewer, { signal } = {}) {
      if (!enabled || !imagery) return false;
      // The manager treats `false` as a failed refresh; skipping a hidden tab is not one.
      if (!isVisible() && frames.length) return true;
      const source = currentSource();
      request?.abort();
      const controller = new AbortController();
      request = controller;
      signal?.addEventListener?.('abort', () => controller.abort(), {
        once: true,
      });
      try {
        const response = await fetchImpl(`/api/radar/frames?source=${source}`, {
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error(`radar frames HTTP ${response.status}`);
        const parsed = parseFramesPayload(await response.json());
        if (!parsed) throw new Error('malformed radar frames');
        // Superseded by a newer request or a source switch: not a failure.
        if (!enabled || source !== currentSource() || request !== controller)
          return true;
        // Two hours back from the newest frame, so upstream latency never drops the 13th.
        frames = pruneFrames(
          parsed.frames,
          newestFrame(parsed.frames)?.time ?? now(),
        );
        stale = parsed.stale;
        error = null;
        lastUpdate = now();
        imagery.setSource(source);
        render();
        return true;
      } catch (failure) {
        if (signal?.aborted) return false;
        if (controller.signal.aborted) return true;
        error = failure?.message || String(failure);
        notifyRows();
        // Reported through getStats(): an enabled row saying "unavailable" beats a failed enable.
        return true;
      } finally {
        if (request === controller) request = null;
      }
    },

    destroy() {
      layer.disable();
      eventTarget?.removeEventListener?.(MAP_STACK_EVENT, onMapStack);
      imagery?.destroy();
      imagery = null;
      viewer = null;
    },

    getStats() {
      const name = SOURCE_NAMES[currentSource()];
      const shown = imagery?.shownTime() ?? null;
      const activeStackId = mapStackController
        ? (mapStackController.getActiveId?.() ?? null)
        : mapStackId;
      if (activeStackId === 'photoreal') {
        return {
          status: 'idle',
          source: name,
          statusMessage: 'Hidden by Google 3D map source',
          count: frames.length,
        };
      }
      if (error && shown === null) {
        return {
          status: 'unavailable',
          source: name,
          error: 'Radar source unavailable',
        };
      }
      if ((error || stale) && shown !== null) {
        return {
          stale: true,
          source: `${name} · ${hhmm(shown)} UTC`,
          error: `Radar source unavailable — showing ${hhmm(shown)} UTC`,
          count: frames.length,
          lastUpdate,
        };
      }
      if (playing && imagery.readyCount() < frames.length) {
        return {
          loading: true,
          source: name,
          loadingLabel: `Loading ${imagery.readyCount()}/${frames.length}`,
        };
      }
      if (shown !== null) {
        const ageMinutes = Math.max(0, Math.floor((now() - shown) / 60_000));
        return {
          status: 'ok',
          source: `${name} · ${hhmm(shown)} UTC · ${ageMinutes} min old`,
          count: frames.length,
          lastUpdate,
        };
      }
      return { status: 'ok', source: name, count: frames.length, lastUpdate };
    },

    getParams() {
      return { usDetail, opacity };
    },

    setParams(params = {}) {
      const next = {};
      if (Object.hasOwn(params, 'usDetail')) {
        if (typeof params.usDetail !== 'boolean') return false;
        next.usDetail = params.usDetail;
      }
      if (Object.hasOwn(params, 'opacity')) {
        const normalized = normalizeOpacity(params.opacity);
        if (normalized === null) return false;
        next.opacity = normalized;
      }
      if (Object.hasOwn(params, 'loop') && typeof params.loop !== 'boolean')
        return false;

      if (Object.hasOwn(next, 'opacity')) {
        opacity = next.opacity;
        imagery?.setAlpha(opacity);
      }
      if (Object.hasOwn(next, 'usDetail') && next.usDetail !== usDetail) {
        usDetail = next.usDetail;
        stopLoop();
        swapTimer = clearTimer(swapTimer);
        frames = [];
        error = null;
        stale = false;
        imagery?.setSource(currentSource());
        if (enabled && usDetail) registerCredit(viewer, credits.iem);
        if (enabled) void layer.update(viewer, {});
      }
      if (Object.hasOwn(params, 'loop')) {
        if (params.loop && !playing) startLoop();
        if (!params.loop && playing) {
          stopLoop();
          render();
        }
      }
      notifyRows();
      return true;
    },

    getRowControls() {
      return buildRowControls({
        playing,
        usDetail,
        opacity,
        loopAvailable: frames.length >= 2,
      });
    },

    setRowControlsListener(listener) {
      rowListener = typeof listener === 'function' ? listener : null;
    },
  };

  return layer;
}
