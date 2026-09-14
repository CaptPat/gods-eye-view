import { swapToFrame } from '../weather-imagery/frameImagery.js';
import { normalizeImageryOpacity } from '../weather-imagery/opacity.js';
import { buildRowControls } from './controls.js';
import { createOverlayImagery } from './imagery.js';
import {
  DEFAULT_MODE,
  DEFAULT_OPACITY,
  DEFAULT_POLLEN_TYPE,
  MODE_INFO,
  normalizeMode,
  normalizePollenType,
  overlayKey,
  sourceName,
} from './modes.js';

export const REFRESH_MS = 10 * 60 * 1000;
export const SWAP_CHECK_MS = 1000;
const MAP_STACK_EVENT = 'gev:map-stack-changed';
const RENDER_REASON = 'weather-overlays';

const hhmm = (timeMs) => new Date(timeMs).toISOString().slice(11, 16);

export function createWeatherOverlaysLayer({
  fetchImpl = (...args) => fetch(...args),
  createImagery = createOverlayImagery,
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
  let mode = DEFAULT_MODE;
  let pollenType = DEFAULT_POLLEN_TYPE;
  let opacity = DEFAULT_OPACITY;
  let targetTime = null;
  let lastUpdate = null;
  let error = null;
  let stale = false;
  let unavailableReason = null;
  let loading = false;
  let googleConfigured = null;
  let mapStackId = null;
  let mapStackController = null;
  let rowListener = null;
  let request = null;
  let swapTimer = null;

  const currentKey = () => overlayKey(mode, pollenType);
  const notifyRows = () => rowListener?.();
  const onMapStack = (event) => {
    mapStackId = event?.detail?.activeStack?.id ?? mapStackId;
    notifyRows();
  };

  function clearTimer(timer) {
    if (timer) timers.clearTimeout(timer);
    return null;
  }

  function renderTarget() {
    if (!imagery) return;
    if (targetTime === null) {
      swapTimer = clearTimer(swapTimer);
      imagery.clear();
    } else if (swapToFrame(imagery, targetTime)) {
      swapTimer = clearTimer(swapTimer);
    } else if (!swapTimer && isVisible()) {
      // Do not re-arm while hidden: the next update() re-evaluates the swap.
      swapTimer = timers.setTimeout(() => {
        swapTimer = null;
        if (enabled) renderTarget();
      }, SWAP_CHECK_MS);
    }
    notifyRows();
    requestRender(RENDER_REASON);
  }

  function resetForKeyChange() {
    swapTimer = clearTimer(swapTimer);
    request?.abort();
    request = null;
    loading = false;
    targetTime = null;
    error = null;
    stale = false;
    unavailableReason = null;
    imagery?.setSource(currentKey());
    requestRender(RENDER_REASON);
  }

  function shownDetail(name, shown) {
    if (mode === 'clouds') {
      const ageMinutes = Math.max(0, Math.floor((now() - shown) / 60_000));
      return `${name} · ${hhmm(shown)} UTC · ${ageMinutes} min old`;
    }
    if (mode === 'temperature') return `${name} · valid ${hhmm(shown)} UTC`;
    return name;
  }

  const layer = {
    id: 'weather-overlays',
    name: 'Weather Overlays',
    icon: '🌡️',
    source: MODE_INFO[DEFAULT_MODE].name,
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
      registerCredit(nextViewer, credits[mode]);
      imagery?.setSource(currentKey());
    },

    disable() {
      enabled = false;
      swapTimer = clearTimer(swapTimer);
      request?.abort();
      request = null;
      loading = false;
      targetTime = null;
      error = null;
      stale = false;
      unavailableReason = null;
      imagery?.clear();
      notifyRows();
      requestRender(RENDER_REASON);
    },

    async update(_viewer, { signal } = {}) {
      if (!enabled || !imagery) return false;
      // The manager treats `false` as a failed refresh; skipping a hidden tab is not one.
      if (!isVisible() && targetTime !== null) return true;
      const key = currentKey();
      request?.abort();
      const controller = new AbortController();
      request = controller;
      signal?.addEventListener?.('abort', () => controller.abort(), {
        once: true,
      });
      loading = true;
      notifyRows();
      try {
        const response = await fetchImpl(
          `/api/weather-overlays/manifest?mode=${key}`,
          { signal: controller.signal },
        );
        const payload = await response.json().catch(() => null);
        if (typeof payload?.googleConfigured === 'boolean') {
          googleConfigured = payload.googleConfigured;
        }
        if (!response.ok) {
          throw new Error(`overlay manifest HTTP ${response.status}`);
        }
        // Superseded by a newer request or a mode switch: not a failure.
        if (!enabled || key !== currentKey() || request !== controller) {
          return true;
        }
        loading = false;
        lastUpdate = now();
        if (payload?.available === false) {
          unavailableReason =
            payload.reason === 'not-configured'
              ? 'Google Maps API key not configured'
              : 'Overlay unavailable';
          error = null;
          stale = false;
          targetTime = null;
          renderTarget();
          return true;
        }
        const time = Number(payload?.time);
        if (!Number.isFinite(time) || time <= 0) {
          throw new Error('malformed overlay manifest');
        }
        unavailableReason = null;
        error = null;
        stale = payload.stale === true;
        targetTime = time;
        renderTarget();
        return true;
      } catch (failure) {
        if (signal?.aborted) return false;
        if (controller.signal.aborted) return true;
        loading = false;
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
      const name = sourceName(mode, pollenType);
      const countLabel = MODE_INFO[mode].short;
      const shown = imagery?.shownTime() ?? null;
      const activeStackId = mapStackController
        ? (mapStackController.getActiveId?.() ?? null)
        : mapStackId;
      if (activeStackId === 'photoreal') {
        return {
          status: 'idle',
          source: name,
          statusMessage: 'Hidden by Google 3D map source',
          countLabel,
        };
      }
      if (unavailableReason) {
        return {
          status: 'unavailable',
          source: name,
          error: unavailableReason,
          countLabel,
        };
      }
      if (error && shown === null) {
        return {
          status: 'unavailable',
          source: name,
          error: 'Overlay source unavailable',
          countLabel,
        };
      }
      if ((error || stale) && shown !== null) {
        return {
          stale: true,
          source: `${name} · ${hhmm(shown)} UTC`,
          error: `Overlay source unavailable — showing ${hhmm(shown)} UTC`,
          lastUpdate,
          countLabel,
        };
      }
      if (loading && shown === null) {
        return {
          loading: true,
          source: name,
          loadingLabel: 'Loading',
          countLabel,
        };
      }
      if (shown === null) {
        return { status: 'ok', source: name, lastUpdate, countLabel };
      }
      return {
        status: 'ok',
        source: shownDetail(name, shown),
        lastUpdate,
        countLabel,
      };
    },

    getParams() {
      return { mode, pollenType, opacity };
    },

    setParams(params = {}) {
      const next = {};
      if (Object.hasOwn(params, 'mode')) {
        next.mode = normalizeMode(params.mode);
        if (!next.mode) return false;
      }
      if (Object.hasOwn(params, 'pollenType')) {
        next.pollenType = normalizePollenType(params.pollenType);
        if (!next.pollenType) return false;
      }
      if (Object.hasOwn(params, 'opacity')) {
        next.opacity = normalizeImageryOpacity(params.opacity);
        if (next.opacity === null) return false;
      }

      if (Object.hasOwn(next, 'opacity') && next.opacity !== opacity) {
        opacity = next.opacity;
        imagery?.setAlpha(opacity);
        requestRender(RENDER_REASON);
      }
      const previousKey = currentKey();
      const previousMode = mode;
      if (next.mode) mode = next.mode;
      if (next.pollenType) pollenType = next.pollenType;
      if (currentKey() !== previousKey) {
        resetForKeyChange();
        if (enabled) {
          if (mode !== previousMode) registerCredit(viewer, credits[mode]);
          void layer.update(viewer, {});
        }
      }
      notifyRows();
      return true;
    },

    getRowControls() {
      return buildRowControls({ mode, pollenType, opacity, googleConfigured });
    },

    setRowControlsListener(listener) {
      rowListener = typeof listener === 'function' ? listener : null;
    },
  };

  return layer;
}
