import * as Cesium from 'cesium';
import { GDACS_ALERT_COLORS, countAreaPositions } from './model.js';

export const NWS_FILL_ALPHA = 0.22;
export const CONE_FILL_ALPHA = 0.14;
export const READY_POLL_MS = 250;
export const READY_POLL_LIMIT = 40;
const ENTITY_PREFIX = 'severe-weather:';

export function isSevereWeatherPickId(id) {
  return typeof id === 'string' && id.startsWith(ENTITY_PREFIX);
}

const positionsOf = (ring) => Cesium.Cartesian3.fromDegreesArray(ring.flat());
const hierarchyOf = ([outer, ...holes]) =>
  new Cesium.PolygonHierarchy(
    positionsOf(outer),
    holes.map((ring) => new Cesium.PolygonHierarchy(positionsOf(ring))),
  );

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * FNV-1a rolling hash over every coordinate nested in `value` (rings, lines,
 * polygons, at any depth), rounded to 4 decimals so a rebuild signature can
 * detect a moved track or cone even when its point/ring counts stay put,
 * without building an intermediate flattened array or string.
 */
function hashCoordinates(hash, value) {
  if (Array.isArray(value)) {
    for (const item of value) hash = hashCoordinates(hash, item);
    return hash;
  }
  if (typeof value !== 'number') return hash;
  const rounded = Math.round(value * 10000) | 0;
  return Math.imul(hash ^ rounded, FNV_PRIME) >>> 0;
}

/**
 * Ground-clamped NWS areas (fill plus outline), GDACS points, cyclone tracks
 * and cones, in one CustomDataSource. Every scene change requests a render:
 * the app idles in Cesium's requestRenderMode.
 */
export function createSevereWeatherRendering(
  viewer,
  {
    requestRender = () => {},
    timers = {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (timer) => clearTimeout(timer),
    },
  } = {},
) {
  const dataSource = new Cesium.CustomDataSource('severe-weather');
  viewer.dataSources.add(dataSource);
  /** entity id → { kind: 'nws' | 'gdacs', key } */
  const targets = new Map();
  /** selection key → [(selected) => void] */
  const highlighters = new Map();
  let signature = null;
  let selectedKey = null;
  let pollTimer = null;
  let polls = 0;

  function addHighlighter(selectionKey, apply) {
    const list = highlighters.get(selectionKey) ?? [];
    list.push(apply);
    highlighters.set(selectionKey, list);
  }

  function addLine(id, positions, color, width, selectionKey, target) {
    const entity = dataSource.entities.add({
      id,
      polyline: {
        positions: positionsOf(positions),
        width,
        material: color,
        clampToGround: true,
        classificationType: Cesium.ClassificationType.BOTH,
      },
    });
    targets.set(id, target);
    addHighlighter(selectionKey, (selected) => {
      entity.polyline.width = selected ? width + 2 : width;
      entity.polyline.material = selected ? Cesium.Color.WHITE : color;
    });
  }

  function addFill(id, polygon, color, target) {
    dataSource.entities.add({
      id,
      polygon: {
        hierarchy: hierarchyOf(polygon),
        material: color,
        classificationType: Cesium.ClassificationType.BOTH,
      },
    });
    targets.set(id, target);
  }

  function addArea(area) {
    const color = Cesium.Color.fromCssColorString(area.color);
    const selectionKey = `nws:${area.key}`;
    const target = { kind: 'nws', key: area.key };
    area.polygons.forEach((polygon, index) => {
      const id = `${ENTITY_PREFIX}nws:${area.key}:${index}`;
      addFill(id, polygon, color.withAlpha(NWS_FILL_ALPHA), target);
      addLine(`${id}:outline`, polygon[0], color, 2, selectionKey, target);
    });
  }

  function addEvent(event) {
    const color = Cesium.Color.fromCssColorString(
      GDACS_ALERT_COLORS[event.alertLevel] ?? GDACS_ALERT_COLORS.Green,
    );
    const selectionKey = `gdacs:${event.id}`;
    const target = { kind: 'gdacs', key: event.id };
    const base = `${ENTITY_PREFIX}gdacs:${event.id}`;
    event.cone.forEach((polygon, index) => {
      addFill(
        `${base}:cone:${index}`,
        polygon,
        color.withAlpha(CONE_FILL_ALPHA),
        target,
      );
      addLine(
        `${base}:cone:${index}:outline`,
        polygon[0],
        color,
        1.5,
        selectionKey,
        target,
      );
    });
    event.track.forEach((line, index) => {
      addLine(`${base}:track:${index}`, line, color, 3, selectionKey, target);
    });
    const point = dataSource.entities.add({
      id: base,
      position: Cesium.Cartesian3.fromDegrees(event.lon, event.lat),
      point: {
        pixelSize: 11,
        color,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    targets.set(base, target);
    addHighlighter(selectionKey, (selected) => {
      point.point.pixelSize = selected ? 15 : 11;
      point.point.outlineColor = selected
        ? Cesium.Color.WHITE
        : Cesium.Color.BLACK;
    });
  }

  function applyHighlight() {
    for (const [key, list] of highlighters)
      for (const apply of list) apply(key === selectedKey);
  }

  /** Apply only one selection key's highlighters, not the full walk. */
  function applyHighlightFor(key, selected) {
    const list = highlighters.get(key);
    if (list) for (const apply of list) apply(selected);
  }

  /** Whether Cesium is still building the newest ground geometry (sampled at both ends of the collection). */
  function isPending() {
    const display = viewer.dataSourceDisplay;
    const entities = dataSource.entities.values;
    if (
      typeof display?.getBoundingSphere !== 'function' ||
      entities.length === 0
    )
      return false;
    const scratch = new Cesium.BoundingSphere();
    return [entities[0], entities[entities.length - 1]].some(
      (entity) =>
        display.getBoundingSphere(entity, false, scratch) ===
        Cesium.BoundingSphereState.PENDING,
    );
  }

  function stopReadyPump() {
    if (pollTimer !== null) timers.clearTimeout(pollTimer);
    pollTimer = null;
  }

  /** Primitives only build while frames render, so ask for frames until the geometry is ready (bounded). */
  function startReadyPump() {
    stopReadyPump();
    polls = 0;
    const tick = () => {
      pollTimer = null;
      requestRender('severe-weather-geometry');
      polls += 1;
      if (polls < READY_POLL_LIMIT && isPending())
        pollTimer = timers.setTimeout(tick, READY_POLL_MS);
    };
    pollTimer = timers.setTimeout(tick, READY_POLL_MS);
  }

  function clear() {
    stopReadyPump();
    signature = null;
    selectedKey = null;
    targets.clear();
    highlighters.clear();
    dataSource.entities.removeAll();
    requestRender('severe-weather-clear');
  }

  return {
    dataSource,

    /** Rebuild only when the drawn set changed; returns whether it rebuilt. */
    render({ areas, events }) {
      const next = JSON.stringify([
        areas.map((area) => [
          area.key,
          area.color,
          countAreaPositions(area),
          hashCoordinates(FNV_OFFSET_BASIS, area.polygons),
        ]),
        events.map((event) => [
          event.id,
          event.alertLevel,
          event.lon,
          event.lat,
          event.track.length,
          event.cone.length,
          hashCoordinates(FNV_OFFSET_BASIS, event.track),
          hashCoordinates(FNV_OFFSET_BASIS, event.cone),
        ]),
      ]);
      if (next === signature) return false;
      // Invalidate until the rebuild actually succeeds: a render exception
      // must not poison future calls into thinking this broken set is
      // already drawn.
      signature = null;
      dataSource.entities.suspendEvents();
      try {
        dataSource.entities.removeAll();
        targets.clear();
        highlighters.clear();
        for (const area of areas) addArea(area);
        for (const event of events) addEvent(event);
        applyHighlight();
      } finally {
        dataSource.entities.resumeEvents();
      }
      signature = next;
      requestRender('severe-weather-render');
      startReadyPump();
      return true;
    },

    targetFor(picked) {
      const id =
        picked?.id instanceof Cesium.Entity ? picked.id.id : picked?.id;
      return typeof id === 'string' ? (targets.get(id) ?? null) : null;
    },

    /** `nws:<area key>`, `gdacs:<event id>` or null. */
    setSelected(key) {
      if (key === selectedKey) return;
      const previous = selectedKey;
      selectedKey = key;
      // Touch only the previous and next selection's own entities, not
      // every outline: with real Cesium, writing a property — even to the
      // same value — raises `definitionChanged` and marks the ground
      // primitive batch dirty for every entity walked.
      if (previous !== null) applyHighlightFor(previous, false);
      if (selectedKey !== null) applyHighlightFor(selectedKey, true);
      requestRender('severe-weather-selection');
      startReadyPump();
    },

    setVisible(visible) {
      dataSource.show = Boolean(visible);
      requestRender('severe-weather-visibility');
    },

    clear,

    destroy() {
      clear();
      viewer.dataSources.remove(dataSource, true);
    },
  };
}
