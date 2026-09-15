import * as Cesium from 'cesium';
import { createCatalogPoints } from './points.js';

export {
  DEFAULT_PIXEL_SIZE,
  SELECTED_PIXEL_GROWTH,
  catalogPickId,
  createCatalogPoints,
} from './points.js';

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

/**
 * A layer of clickable points loaded as one list, each opening a card built
 * from its own record (no per-click request). `loadRecords` resolves
 * `{ records, stale }` or throws; `buildCard(record, { now })` returns
 * `{ title, details, url, accessibilityLabel }`.
 */
export function createCatalogPointsLayer({
  meta,
  loadRecords,
  buildCard,
  maxAgeMs = 6 * 60 * 60_000,
  refreshInterval = 60 * 60_000,
  overlayHost,
  fetchImpl = (...args) => fetch(...args),
  createPoints = createCatalogPoints,
  createClickHandler = defaultClickHandler,
  requestRender = () => {},
  registerCredit = () => false,
  credit = null,
  openUrl = () => {},
  documentTarget = globalThis.document,
  now = Date.now,
  picking = {},
} = {}) {
  if (!meta?.id) throw new TypeError('Catalog point layers require meta');
  if (typeof loadRecords !== 'function')
    throw new TypeError('Catalog point layers require loadRecords');
  if (typeof buildCard !== 'function')
    throw new TypeError('Catalog point layers require buildCard');
  if (!overlayHost)
    throw new TypeError('Catalog point layers require an overlay host');

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
  let records = [];
  let byId = new Map();
  let lastUpdate = null;
  let error = null;
  let stale = false;
  let loading = false;
  let request = null;
  /** { record, card } for the open card */
  let selected = null;

  function publishCard() {
    const position = selected && points?.positionOf(selected.record.id);
    if (!position) return;
    const { record, card } = selected;
    const url = card.url || null;
    overlayHost.setEntries(
      meta.selectedSourceId,
      [
        {
          id: `${meta.id}:${record.id}`,
          position,
          variant: 'selected',
          selected: true,
          protected: true,
          paintLane: 'selected',
          collisionGroup: 'ambient-card',
          priority: Number.MAX_SAFE_INTEGER,
          title: card.title,
          details: card.details,
          accent: meta.color,
          interactive: Boolean(url),
          accessibilityLabel: card.accessibilityLabel,
          activate: () => {
            if (!url) return false;
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

  function clearSelection() {
    if (!selected) return;
    selected = null;
    points?.setSelected(null);
    overlayHost.clearSource(meta.selectedSourceId);
    requestRender(meta.id);
  }

  function selectRecord(recordId) {
    const record = byId.get(recordId);
    if (!record || selected?.record.id === recordId) return;
    clearSelection();
    try {
      selected = { record, card: buildCard(record, { now: now() }) };
    } catch (cardError) {
      console.warn(`[Data:${meta.id}] card build failed:`, cardError);
      return;
    }
    points.setSelected(recordId);
    // Point restyling is a scene mutation the idle governor does not see.
    requestRender(meta.id);
    publishCard();
  }

  function handleClick(position) {
    if (!enabled || !viewer || !points) return;
    if (
      selected &&
      overlayHost.hitTest?.(position?.x, position?.y, {
        sourceId: meta.selectedSourceId,
      })
    ) {
      if (selected.card.url) openUrl(selected.card.url);
      return;
    }
    const picked = viewer.scene.pick(position);
    const recordId = points.recordIdFromPick(picked);
    if (recordId) {
      selectRecord(recordId);
      return;
    }
    // A pick that belongs to a sibling layer (e.g. an aircraft) is not
    // "empty space" — leave the selection alone and let that layer handle it.
    if (picked) {
      const pickedId = resolvePickId(picked);
      if (pickedId && isOwnedByOtherLayer(meta.id, pickedId)) return;
    }
    clearSelection();
  }

  const onKeyDown = (event) => {
    if (event?.key === 'Escape' && selected) clearSelection();
  };

  const layer = {
    id: meta.id,
    name: meta.name,
    icon: meta.icon,
    source: meta.source,
    updateInterval: 0,
    refreshInterval,

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
      points.setRecords(records);
      points.setShow(true);
      overlayHost.setVisible(meta.selectedSourceId, true);
      clickHandler ??= createClickHandler(nextViewer, handleClick);
      documentTarget?.addEventListener?.('keydown', onKeyDown);
      registerPickOwner(meta.id, (id) => id.startsWith(`${meta.id}:`));
      requestRender(meta.id);
    },

    disable() {
      enabled = false;
      request?.abort();
      request = null;
      loading = false;
      clearSelection();
      clickHandler?.destroy();
      clickHandler = null;
      documentTarget?.removeEventListener?.('keydown', onKeyDown);
      unregisterPickOwner(meta.id);
      if (points) {
        points.setShow(false);
        points.setRecords([]);
      }
      overlayHost.setVisible(meta.selectedSourceId, false);
      requestRender(meta.id);
    },

    async update(_viewer, { signal } = {}) {
      if (!enabled || !points || signal?.aborted) return false;
      const fresh =
        records.length &&
        !stale &&
        lastUpdate !== null &&
        now() - lastUpdate < maxAgeMs;
      if (fresh) return true;
      request?.abort();
      const controller = new AbortController();
      request = controller;
      const onAbort = () => controller.abort();
      signal?.addEventListener?.('abort', onAbort, { once: true });
      loading = true;
      try {
        const loaded = await loadRecords({
          fetchImpl,
          signal: controller.signal,
        });
        if (!Array.isArray(loaded?.records))
          throw new Error('malformed record list');
        if (!enabled || request !== controller) return true;
        records = loaded.records;
        byId = new Map(records.map((record) => [record.id, record]));
        stale = Boolean(loaded.stale);
        error = null;
        lastUpdate = now();
        points.setRecords(records);
        if (selected && !byId.has(selected.record.id)) clearSelection();
        // Async list results mutate primitives outside a manager frame.
        requestRender(meta.id);
        return true;
      } catch {
        if (signal?.aborted) return false;
        if (controller.signal.aborted) return true;
        // Reported through getStats(): an enabled row saying why beats a failed enable.
        error = records.length ? meta.refreshFailedText : meta.unavailableText;
        return true;
      } finally {
        if (request === controller) {
          request = null;
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
      records = [];
      byId = new Map();
    },

    getStats() {
      const count = records.length;
      if (loading)
        return {
          loading: true,
          loadingLabel: meta.loadingLabel,
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
