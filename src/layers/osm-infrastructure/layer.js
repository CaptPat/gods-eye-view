import * as Cesium from 'cesium';
import { normalizeOsmElements } from './elements.js';
import {
  boxContains,
  buildOverpassQuery,
  snapViewBox,
  viewBoxFromRectangle,
} from './query.js';
import { createOsmInfrastructureRendering } from './rendering.js';

export const REQUEST_DEBOUNCE_MS = 500;
/** A view still inside the last snapped box reuses its features this long. */
export const QUERY_REUSE_MS = 10 * 60_000;
/** Vertices kept per line: long transmission ways carry thousands. */
export const MAX_LINE_VERTICES = 400;

const SELECTED_SOURCE_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 0,
  moving: false,
});

/**
 * A box around the ground point at screen centre, half as wide as the camera
 * is far from it (about what a straight-down view shows), or null when the
 * centre of the screen misses the Earth.
 */
export function cameraViewRectangle(viewer) {
  const camera = viewer?.camera;
  const canvas = viewer?.scene?.canvas;
  if (typeof camera?.pickEllipsoid !== 'function' || !canvas) return null;
  const width = canvas.clientWidth || canvas.width;
  const height = canvas.clientHeight || canvas.height;
  if (!width || !height) return null;
  const focus = camera.pickEllipsoid(
    new Cesium.Cartesian2(width / 2, height / 2),
    viewer.scene.globe.ellipsoid,
  );
  if (!focus) return null;
  const location = Cesium.Cartographic.fromCartesian(focus);
  const range = Cesium.Cartesian3.distance(camera.positionWC, focus);
  const latSpan = Math.max(1000, range) / 111_000;
  const lonSpan = latSpan / Math.cos(location.latitude);
  const latitude = Cesium.Math.toDegrees(location.latitude);
  const longitude = Cesium.Math.toDegrees(location.longitude);
  return {
    south: latitude - latSpan,
    west: longitude - lonSpan,
    north: latitude + latSpan,
    east: longitude + lonSpan,
  };
}

function defaultPickAnchor(viewer, position) {
  return (
    viewer.camera.pickEllipsoid?.(position, viewer.scene.globe.ellipsoid) ??
    null
  );
}

function defaultClickHandler(viewer, onClick) {
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction(
    (click) => onClick(click.position),
    Cesium.ScreenSpaceEventType.LEFT_CLICK,
  );
  return { destroy: () => handler.destroy() };
}

/**
 * A viewport-bounded OpenStreetMap layer: after the camera settles, a view
 * small enough is fetched through the shared Overpass proxy as one snapped
 * box, classified into lines and points, and drawn. Clicking a feature pins a
 * card built from its tags (`buildCard(feature)` returns
 * `{ title, details, url, accessibilityLabel }`); the card opens the feature
 * on openstreetmap.org.
 */
export function createOsmInfrastructureLayer({
  meta,
  query,
  classifyLine,
  classifyPoint,
  buildCard,
  legend = [],
  source,
  overlayHost,
  picking = {},
  requestRender = () => {},
  registerCredit = () => false,
  credit = null,
  openUrl = () => {},
  viewRectangle = cameraViewRectangle,
  pickAnchor = defaultPickAnchor,
  createRendering = createOsmInfrastructureRendering,
  createClickHandler = defaultClickHandler,
  timers = {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) => clearTimeout(handle),
  },
  now = Date.now,
  documentTarget = globalThis.document,
} = {}) {
  if (!meta?.id) throw new TypeError('OSM infrastructure layers require meta');
  if (!Array.isArray(query?.selectors) || !query.cap || !query.maxViewDegrees)
    throw new TypeError('OSM infrastructure layers require a query');
  if (typeof source?.fetch !== 'function')
    throw new TypeError('OSM infrastructure layers require a source');
  if (!overlayHost)
    throw new TypeError('OSM infrastructure layers require an overlay host');

  const {
    registerPickOwner = () => {},
    unregisterPickOwner = () => {},
    resolvePickId = () => null,
    isOwnedByOtherLayer = () => false,
  } = picking;

  let viewer = null;
  let rendering = null;
  let clickHandler = null;
  let removeMoveEnd = null;
  let enabled = false;
  let features = new Map();
  let lastBox = null;
  let lastUpdate = null;
  let stale = false;
  let saturated = false;
  let error = null;
  /** 'idle' | 'zoom-in' | 'loading' | 'ready' | 'empty' | 'error' */
  let status = 'idle';
  let loading = false;
  /** { controller, box } for the request in flight */
  let request = null;
  let debounce = null;
  /** { featureId, position, card } for the open card */
  let selected = null;

  function publishCard() {
    const { featureId, position, card } = selected;
    const url = card.url || null;
    overlayHost.setEntries(
      meta.selectedSourceId,
      [
        {
          id: `${meta.id}:${featureId}`,
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
    requestRender(meta.id);
  }

  function cardFor(feature) {
    try {
      return buildCard(feature);
    } catch (cardError) {
      console.warn(`[Data:${meta.id}] card build failed:`, cardError);
      return null;
    }
  }

  function clearSelection() {
    if (!selected) return;
    selected = null;
    rendering?.setSelected(null);
    overlayHost.clearSource(meta.selectedSourceId);
    requestRender(meta.id);
  }

  function select(featureId, position) {
    const card = cardFor(features.get(featureId));
    if (!card) return;
    selected = { featureId, position, card };
    rendering.setSelected(featureId);
    publishCard();
  }

  function handleClick(position) {
    if (!enabled || !viewer || !rendering) return;
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
    const featureId = rendering.featureIdFromPick(picked);
    const feature = featureId ? features.get(featureId) : null;
    if (feature) {
      // A long line's middle vertex may be far off screen: anchor where it was clicked.
      const anchor =
        (feature.positions ? pickAnchor(viewer, position) : null) ??
        rendering.positionOf(featureId);
      if (anchor) select(featureId, anchor);
      return;
    }
    // A pick that belongs to a sibling layer is not empty space.
    if (picked) {
      const pickedId = resolvePickId(picked);
      if (pickedId && isOwnedByOtherLayer(meta.id, pickedId)) return;
    }
    clearSelection();
  }

  const onKeyDown = (event) => {
    if (event?.key === 'Escape' && selected) clearSelection();
  };

  function cancelRequest() {
    request?.controller.abort();
    request = null;
    loading = false;
  }

  function scheduleLoad() {
    if (!enabled) return;
    if (debounce !== null) timers.clearTimeout(debounce);
    debounce = timers.setTimeout(() => {
      debounce = null;
      load();
    }, REQUEST_DEBOUNCE_MS);
  }

  async function load() {
    if (!enabled || !viewer || !rendering) return false;
    if (debounce !== null) timers.clearTimeout(debounce);
    debounce = null;
    const box = viewBoxFromRectangle(
      viewRectangle(viewer),
      query.maxViewDegrees,
    );
    if (!box) {
      cancelRequest();
      status = 'zoom-in';
      requestRender(meta.id);
      return true;
    }
    if (
      lastBox &&
      boxContains(lastBox, box) &&
      lastUpdate !== null &&
      now() - lastUpdate < QUERY_REUSE_MS &&
      !stale
    ) {
      cancelRequest();
      error = null;
      status = features.size ? 'ready' : 'empty';
      return true;
    }
    // A settle inside the box already being fetched waits for that answer.
    if (request && boxContains(request.box, box)) return true;

    const queryBox = snapViewBox(box);
    request?.controller.abort();
    const controller = new AbortController();
    request = { controller, box: queryBox };
    loading = true;
    status = 'loading';
    requestRender(meta.id);
    try {
      const result = await source.fetch(
        buildOverpassQuery(query.selectors, queryBox, query.cap),
        controller.signal,
      );
      if (request?.controller !== controller || !enabled) return true;
      const elements = Array.isArray(result?.elements) ? result.elements : [];
      const { lines, points } = normalizeOsmElements(elements, {
        classifyLine,
        classifyPoint,
        maxVertices: MAX_LINE_VERTICES,
      });
      rendering.render({ lines, points });
      features = new Map(
        [...lines, ...points].map((feature) => [feature.id, feature]),
      );
      saturated = elements.length >= query.cap;
      stale = Boolean(result?.stale);
      lastBox = queryBox;
      lastUpdate = now();
      error = null;
      status = features.size ? 'ready' : 'empty';
      if (selected) {
        const card = features.has(selected.featureId)
          ? cardFor(features.get(selected.featureId))
          : null;
        if (card) {
          selected.card = card;
          publishCard();
        } else clearSelection();
      }
      requestRender(meta.id);
      return true;
    } catch (failure) {
      if (controller.signal.aborted || request?.controller !== controller)
        return true;
      if (!enabled) return true;
      error = failure?.message || String(failure);
      status = 'error';
      return true;
    } finally {
      if (request?.controller === controller) {
        request = null;
        loading = false;
        requestRender(meta.id);
      }
    }
  }

  const layer = {
    id: meta.id,
    name: meta.name,
    icon: meta.icon,
    source: meta.source,
    updateInterval: 0,

    init(nextViewer) {
      if (viewer) throw new Error(`${meta.name} layer is already initialized`);
      viewer = nextViewer;
      rendering = createRendering(nextViewer, {
        layerId: meta.id,
        requestRender,
      });
      rendering.setVisible(false);
      removeMoveEnd = nextViewer.camera.moveEnd.addEventListener(scheduleLoad);
      overlayHost.setVisible(meta.selectedSourceId, false);
    },

    enable(nextViewer) {
      if (enabled) return;
      enabled = true;
      registerCredit(nextViewer, credit);
      rendering?.setVisible(true);
      overlayHost.setVisible(meta.selectedSourceId, true);
      clickHandler ??= createClickHandler(nextViewer, handleClick);
      documentTarget?.addEventListener?.('keydown', onKeyDown);
      registerPickOwner(
        meta.id,
        (id) => typeof id === 'string' && id.startsWith(`${meta.id}:`),
      );
      requestRender(meta.id);
      // DataLayerManager calls update() right after enable(); it owns the first fetch.
    },

    /** Release every entity: a hidden data source still costs a visualizer walk each frame. */
    disable() {
      enabled = false;
      if (debounce !== null) timers.clearTimeout(debounce);
      debounce = null;
      cancelRequest();
      clearSelection();
      clickHandler?.destroy();
      clickHandler = null;
      documentTarget?.removeEventListener?.('keydown', onKeyDown);
      unregisterPickOwner(meta.id);
      rendering?.clear();
      rendering?.setVisible(false);
      overlayHost.setVisible(meta.selectedSourceId, false);
      features = new Map();
      lastBox = null;
      lastUpdate = null;
      stale = false;
      saturated = false;
      error = null;
      status = 'idle';
      requestRender(meta.id);
    },

    update() {
      return load();
    },

    destroy() {
      layer.disable();
      removeMoveEnd?.();
      removeMoveEnd = null;
      overlayHost.clearSource(meta.selectedSourceId);
      rendering?.destroy();
      rendering = null;
      viewer = null;
    },

    /** Legend rows count drawn features by style colour, which is unique per row. */
    getRowControls() {
      const counts = new Map();
      for (const { color } of features.values())
        counts.set(color, (counts.get(color) ?? 0) + 1);
      return {
        legend: legend.map(({ label, color }) => ({
          label,
          color,
          count: counts.get(color) ?? 0,
        })),
      };
    },

    getStats() {
      const count = features.size;
      if (!enabled) return { count: 0, lastUpdate: null };
      if (status === 'zoom-in')
        return {
          status: 'zoom-in',
          statusMessage: meta.zoomMessage,
          count,
          lastUpdate,
        };
      if (loading)
        return {
          loading: true,
          loadingLabel: meta.loadingLabel,
          count,
          lastUpdate,
        };
      if (error && !count) return { count: 0, lastUpdate, error };
      if (error) return { stale: true, count, lastUpdate, error };
      if (status === 'empty')
        return {
          status: 'empty',
          statusMessage: meta.emptyMessage,
          count: 0,
          lastUpdate,
        };
      return {
        count,
        lastUpdate,
        stale,
        saturated,
        loadingLabel: saturated ? meta.saturatedMessage : '',
      };
    },
  };
  return layer;
}
