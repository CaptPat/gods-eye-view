// src/layers/severe-weather/index.js
import * as Cesium from 'cesium';
import {
  SEVERE_WEATHER_LAYER_ID,
  buildNwsAreas,
  buildStats,
  capAreasToBudget,
  parseSevereWeatherPayload,
} from './model.js';
import { createSevereWeatherRendering } from './rendering.js';
import { createSevereWeatherSelection } from './selection.js';

export * from './model.js';
export {
  createSevereWeatherRendering,
  isSevereWeatherPickId,
} from './rendering.js';
export { createSevereWeatherSelection } from './selection.js';

export const REFRESH_MS = 5 * 60_000;
export const SEVERE_WEATHER_ENDPOINT = '/api/severe-weather';
const EMPTY_DATA = Object.freeze({ areas: [], events: [], droppedAreas: 0 });

/** NWS active alerts (US) and GDACS events (global) as one on/off data layer. */
export function createSevereWeatherLayer({
  fetchImpl = (...args) => fetch(...args),
  overlayHost,
  context,
  picking,
  pickGround,
  openLink = (url) => globalThis.window?.open?.(url, '_blank', 'noopener'),
  requestRender = () => {},
  registerCredit = () => false,
  credits = [],
  isVisible = () => globalThis.document?.visibilityState !== 'hidden',
  now = Date.now,
  timers,
  createRendering = createSevereWeatherRendering,
  screenSpaceEventHandlerFactory = (viewer) =>
    new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas),
} = {}) {
  if (
    !overlayHost ||
    !context ||
    !picking ||
    typeof pickGround !== 'function'
  ) {
    throw new TypeError(
      'Severe weather requires overlay, context, picking and ground-pick services',
    );
  }
  let viewer = null;
  let rendering = null;
  let selection = null;
  let enabled = false;
  let payload = null;
  let data = EMPTY_DATA;
  let lastUpdate = null;
  let error = null;
  let request = null;

  function draw(nextPayload) {
    const { areas, dropped } = capAreasToBudget(buildNwsAreas(nextPayload.nws));
    const next = {
      areas,
      events: nextPayload.gdacs.events,
      droppedAreas: dropped,
    };
    // Render before committing: if it throws, `data` (and payload/lastUpdate,
    // committed by the caller only after draw() returns) stay at the last
    // good draw.
    rendering.render(next);
    data = next;
    selection.refresh();
  }

  const layer = {
    id: SEVERE_WEATHER_LAYER_ID,
    name: 'Severe Weather',
    icon: '⚠️',
    source: 'NWS · GDACS',
    updateInterval: REFRESH_MS,

    init(nextViewer) {
      if (viewer)
        throw new Error('Severe weather layer is already initialized');
      viewer = nextViewer;
      rendering = createRendering(
        nextViewer,
        timers ? { requestRender, timers } : { requestRender },
      );
      rendering.setVisible(false);
      selection = createSevereWeatherSelection({
        viewer: nextViewer,
        rendering,
        overlayHost,
        context,
        picking,
        pickGround,
        openLink,
        screenSpaceEventHandlerFactory,
        getData: () => data,
      });
    },

    enable(nextViewer) {
      enabled = true;
      for (const credit of credits) registerCredit(nextViewer, credit);
      rendering?.setVisible(true);
      selection?.install();
    },

    /** Release every entity: a hidden data source still costs a visualizer walk each frame. */
    disable() {
      enabled = false;
      request?.abort();
      request = null;
      selection?.uninstall();
      rendering?.clear();
      rendering?.setVisible(false);
      payload = null;
      data = EMPTY_DATA;
      lastUpdate = null;
      error = null;
    },

    /**
     * Resolves false only when the manager's own signal aborted. Handled
     * failures resolve true and surface through getStats().error, which the
     * manager reads as the refresh failure.
     */
    async update(_viewer, { signal } = {}) {
      if (!enabled || !rendering) return false;
      if (payload && !isVisible()) return true;
      request?.abort();
      const controller = new AbortController();
      request = controller;
      const onAbort = () => controller.abort();
      if (signal?.aborted) controller.abort();
      else signal?.addEventListener?.('abort', onAbort, { once: true });
      try {
        const response = await fetchImpl(SEVERE_WEATHER_ENDPOINT, {
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error(`severe weather HTTP ${response.status}`);
        const parsed = parseSevereWeatherPayload(await response.json());
        if (!parsed) throw new Error('malformed severe weather payload');
        if (!enabled || request !== controller) return true;
        draw(parsed);
        payload = parsed;
        error = null;
        lastUpdate = now();
        return true;
      } catch (failure) {
        if (signal?.aborted) return false;
        if (controller.signal.aborted || !enabled) return true;
        error = failure?.message || String(failure);
        return true;
      } finally {
        signal?.removeEventListener?.('abort', onAbort);
        if (request === controller) request = null;
      }
    },

    destroy() {
      layer.disable();
      rendering?.destroy();
      rendering = null;
      selection = null;
      viewer = null;
    },

    getStats() {
      return buildStats({
        payload,
        lastUpdate,
        error,
        droppedAreas: data.droppedAreas,
      });
    },
  };

  return layer;
}
