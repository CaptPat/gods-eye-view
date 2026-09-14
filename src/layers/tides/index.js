import * as Cesium from 'cesium';
import {
  CARD_FAILED,
  CARD_LOADING,
  NOAA_SOURCE,
  STATION_LAYERS,
  UNITS_STORAGE_KEY,
  buildCurrentCard,
  buildPendingCard,
  buildTideCard,
  noaaStationUrl,
  normalizeUnits,
  parseStationsPayload,
} from './model.js';
import { createStationPoints } from './points.js';

export * from './model.js';
export { createStationPoints, stationPickId } from './points.js';

/** Station metadata changes rarely: refetch a list at most every six hours. */
export const STATION_LIST_MAX_AGE_MS = 6 * 60 * 60_000;
/** Manager refresh cadence; a tick inside the max age costs no request. */
export const STATION_REFRESH_CHECK_MS = 60 * 60_000;
export const SELECTED_SOURCE_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 0,
  moving: false,
});

function defaultClickHandler(viewer, onClick) {
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction(
    (click) => onClick(click.position),
    Cesium.ScreenSpaceEventType.LEFT_CLICK,
  );
  return { destroy: () => handler.destroy() };
}

/** One NOAA CO-OPS station layer: `kind` is 'tide' or 'current'. */
export function createNoaaStationsLayer({
  kind,
  overlayHost,
  fetchImpl = (...args) => fetch(...args),
  createPoints = createStationPoints,
  createClickHandler = defaultClickHandler,
  requestRender = () => {},
  registerCredit = () => false,
  credit = null,
  storage = null,
  openUrl = () => {},
  documentTarget = globalThis.document,
  now = Date.now,
  picking = {},
} = {}) {
  const meta = STATION_LAYERS[kind];
  if (!meta) throw new TypeError('kind must be tide or current');
  if (!overlayHost)
    throw new TypeError('NOAA station layers require an overlay host');

  const {
    registerPickOwner = () => {},
    unregisterPickOwner = () => {},
    resolvePickId = () => null,
    isOwnedByOtherLayer = () => false,
  } = picking;

  let viewer = null;
  let points = null;
  let clickHandler = null;
  let enabled = false;
  let stations = [];
  let byId = new Map();
  let lastUpdate = null;
  let error = null;
  let stale = false;
  let loading = false;
  let listRequest = null;
  /** { station, bin, report, failed, controller } for the open card. */
  let selected = null;

  const units = () => {
    try {
      return normalizeUnits(storage?.getItem?.(UNITS_STORAGE_KEY));
    } catch {
      return 'imperial';
    }
  };

  function publishCard({ title, details }) {
    const position = selected && points?.positionOf(selected.station.id);
    if (!position) return;
    const { station, bin } = selected;
    const url = noaaStationUrl(kind, station.id, bin);
    overlayHost.setEntries(
      meta.selectedSourceId,
      [
        {
          id: `${meta.id}:${station.id}`,
          position,
          variant: 'selected',
          selected: true,
          protected: true,
          paintLane: 'selected',
          collisionGroup: 'ambient-card',
          priority: Number.MAX_SAFE_INTEGER,
          title,
          details,
          accent: meta.color,
          interactive: true,
          accessibilityLabel: `Open NOAA page for ${station.name}`,
          activate: () => {
            openUrl(url);
            return true;
          },
          anchorRadiusPx: 9,
          minAnchorGapPx: 11,
          verticalOnly: true,
          placement: 'above',
          edgeFade: 'keyhole',
          horizonCull: true,
          terrainOcclusion: false,
        },
      ],
      SELECTED_SOURCE_OPTIONS,
    );
  }

  function renderSelected() {
    if (!selected) return;
    const { station, report, failed } = selected;
    if (failed) return publishCard(buildPendingCard(station, CARD_FAILED));
    if (!report) return publishCard(buildPendingCard(station, CARD_LOADING));
    const options = { units: units(), now: now() };
    return publishCard(
      kind === 'tide'
        ? buildTideCard(station, report, options)
        : buildCurrentCard(station, report, options),
    );
  }

  function clearSelection() {
    if (!selected) return;
    selected.controller.abort();
    selected = null;
    points?.setSelected(null);
    overlayHost.clearSource(meta.selectedSourceId);
    requestRender(meta.id);
  }

  /** A render failure while publishing the card must not surface as an unhandled rejection. */
  function renderSelectedSafely() {
    try {
      renderSelected();
    } catch (error) {
      console.warn(`[Data:${meta.id}] selected card render failed:`, error);
    }
  }

  async function selectStation(stationId) {
    const station = byId.get(stationId);
    if (!station) return;
    // A failed card can be retried by clicking the same station again.
    if (selected?.station.id === stationId && !selected.failed) return;
    clearSelection();
    const controller = new AbortController();
    const bin = kind === 'current' ? station.bins[0] : null;
    selected = { station, bin, report: null, failed: false, controller };
    points.setSelected(stationId);
    // Point restyling is a scene mutation the idle governor does not see.
    requestRender(meta.id);
    renderSelectedSafely();
    const query =
      kind === 'tide'
        ? `/api/tides/tide?id=${encodeURIComponent(stationId)}`
        : `/api/tides/current?id=${encodeURIComponent(stationId)}&bin=${bin}`;
    try {
      const response = await fetchImpl(query, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const report = await response.json();
      if (selected?.controller !== controller) return;
      selected.report = report;
    } catch {
      if (controller.signal.aborted || selected?.controller !== controller)
        return;
      selected.failed = true;
    }
    renderSelectedSafely();
  }

  function handleClick(position) {
    if (!enabled || !viewer || !points) return undefined;
    if (
      selected &&
      overlayHost.hitTest?.(position?.x, position?.y, {
        sourceId: meta.selectedSourceId,
      })
    ) {
      openUrl(noaaStationUrl(kind, selected.station.id, selected.bin));
      return undefined;
    }
    const picked = viewer.scene.pick(position);
    const stationId = points.stationIdFromPick(picked);
    if (stationId) return selectStation(stationId);
    // A pick that belongs to a sibling layer (e.g. an aircraft) is not
    // "empty space" — leave the selection alone and let that layer handle it.
    if (picked) {
      const pickedId = resolvePickId(picked);
      if (pickedId && isOwnedByOtherLayer(meta.id, pickedId)) return undefined;
    }
    clearSelection();
    return undefined;
  }

  const onKeyDown = (event) => {
    if (event?.key === 'Escape' && selected) clearSelection();
  };

  const layer = {
    id: meta.id,
    name: meta.name,
    icon: meta.icon,
    source: NOAA_SOURCE,
    updateInterval: 0,
    refreshInterval: STATION_REFRESH_CHECK_MS,

    init(nextViewer) {
      viewer = nextViewer;
      points = createPoints(nextViewer, {
        layerId: meta.id,
        color: meta.color,
      });
      overlayHost.setVisible(meta.selectedSourceId, false);
    },

    enable(nextViewer) {
      enabled = true;
      registerCredit(nextViewer, credit);
      points.setStations(stations);
      points.setShow(true);
      overlayHost.setVisible(meta.selectedSourceId, true);
      clickHandler ??= createClickHandler(nextViewer, handleClick);
      documentTarget?.addEventListener?.('keydown', onKeyDown);
      registerPickOwner(meta.id, (id) => id.startsWith(`${meta.id}:`));
      requestRender(meta.id);
    },

    disable() {
      enabled = false;
      listRequest?.abort();
      listRequest = null;
      loading = false;
      clearSelection();
      clickHandler?.destroy();
      clickHandler = null;
      documentTarget?.removeEventListener?.('keydown', onKeyDown);
      unregisterPickOwner(meta.id);
      if (points) {
        points.setShow(false);
        points.setStations([]);
      }
      overlayHost.setVisible(meta.selectedSourceId, false);
      requestRender(meta.id);
    },

    async update(_viewer, { signal } = {}) {
      if (!enabled || !points || signal?.aborted) return false;
      const fresh =
        stations.length &&
        !stale &&
        lastUpdate !== null &&
        now() - lastUpdate < STATION_LIST_MAX_AGE_MS;
      if (fresh) return true;
      listRequest?.abort();
      const controller = new AbortController();
      listRequest = controller;
      const onAbort = () => controller.abort();
      signal?.addEventListener?.('abort', onAbort, { once: true });
      loading = true;
      try {
        const response = await fetchImpl(`/api/tides/stations?kind=${kind}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const parsed = parseStationsPayload(await response.json(), kind);
        if (!parsed?.stations.length) throw new Error('malformed station list');
        if (!enabled || listRequest !== controller) return true;
        stations = parsed.stations;
        byId = new Map(stations.map((station) => [station.id, station]));
        stale = parsed.stale;
        error = null;
        lastUpdate = now();
        points.setStations(stations);
        if (selected && !byId.has(selected.station.id)) clearSelection();
        // Async list results mutate primitives outside a manager frame.
        requestRender(meta.id);
        return true;
      } catch {
        if (signal?.aborted) return false;
        if (controller.signal.aborted) return true;
        // Reported through getStats(): an enabled row saying why beats a failed enable.
        error = stations.length
          ? 'Station list refresh failed'
          : 'Station list unavailable';
        return true;
      } finally {
        if (listRequest === controller) {
          listRequest = null;
          loading = false;
        }
        signal?.removeEventListener?.('abort', onAbort);
      }
    },

    destroy() {
      layer.disable();
      overlayHost.clearSource(meta.selectedSourceId);
      points?.destroy();
      points = null;
      viewer = null;
      stations = [];
      byId = new Map();
    },

    getStats() {
      const count = stations.length;
      if (loading)
        return {
          loading: true,
          loadingLabel: 'Loading stations',
          count,
          lastUpdate,
        };
      if (error && !count) return { count: 0, lastUpdate: null, error };
      if (error) return { stale: true, count, lastUpdate, error };
      if (stale) return { stale: true, count, lastUpdate };
      return { count, lastUpdate };
    },
  };
  return layer;
}

export function createTideStationsLayer(options = {}) {
  return createNoaaStationsLayer({ ...options, kind: 'tide' });
}

export function createCurrentStationsLayer(options = {}) {
  return createNoaaStationsLayer({ ...options, kind: 'current' });
}
