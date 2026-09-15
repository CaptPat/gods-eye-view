import * as Cesium from 'cesium';

export const READY_POLL_MS = 250;
export const READY_POLL_LIMIT = 40;
const SELECTED_WIDTH_GROWTH = 2;
const SELECTED_PIXEL_GROWTH = 4;

/**
 * One layer's OpenStreetMap lines (ground-clamped polylines) and points in a
 * CustomDataSource. Entity ids are `<layerId>:<osm type>/<osm id>`. Every
 * scene change requests a render: the app idles in requestRenderMode.
 */
export function createOsmInfrastructureRendering(
  viewer,
  {
    layerId,
    requestRender = () => {},
    timers = {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (timer) => clearTimeout(timer),
    },
  } = {},
) {
  const prefix = `${layerId}:`;
  const dataSource = new Cesium.CustomDataSource(layerId);
  viewer.dataSources.add(dataSource);
  /** feature id → { feature, entity } */
  const drawn = new Map();
  let signature = null;
  let selectedId = null;
  let pollTimer = null;
  let polls = 0;

  function applyStyle({ feature, entity }, selected) {
    if (entity.polyline) {
      entity.polyline.width = selected
        ? feature.width + SELECTED_WIDTH_GROWTH
        : feature.width;
      entity.polyline.material = selected
        ? Cesium.Color.WHITE
        : Cesium.Color.fromCssColorString(feature.color);
      return;
    }
    entity.point.pixelSize = selected
      ? feature.pixelSize + SELECTED_PIXEL_GROWTH
      : feature.pixelSize;
    entity.point.outlineColor = selected
      ? Cesium.Color.WHITE
      : Cesium.Color.BLACK;
  }

  function addLine(feature) {
    return dataSource.entities.add({
      id: `${prefix}${feature.id}`,
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(feature.positions.flat()),
        width: feature.width,
        material: Cesium.Color.fromCssColorString(feature.color),
        clampToGround: true,
        classificationType: Cesium.ClassificationType.BOTH,
      },
    });
  }

  function addPoint(feature) {
    return dataSource.entities.add({
      id: `${prefix}${feature.id}`,
      position: Cesium.Cartesian3.fromDegrees(feature.lon, feature.lat),
      point: {
        pixelSize: feature.pixelSize,
        color: Cesium.Color.fromCssColorString(feature.color),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 1.5,
        // No heightReference: the globe is hidden under photoreal tiles, and
        // clamping there can pin a point near Earth's centre on screen.
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }

  /** Whether Cesium is still building ground geometry (sampled at both ends of the collection). */
  function isPending() {
    const display = viewer.dataSourceDisplay;
    const entities = dataSource.entities.values;
    if (typeof display?.getBoundingSphere !== 'function' || !entities.length)
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

  /** Ground primitives only build while frames render, so ask for frames until they are ready (bounded). */
  function startReadyPump() {
    stopReadyPump();
    polls = 0;
    const tick = () => {
      pollTimer = null;
      requestRender(`${layerId}-geometry`);
      polls += 1;
      if (polls < READY_POLL_LIMIT && isPending())
        pollTimer = timers.setTimeout(tick, READY_POLL_MS);
    };
    pollTimer = timers.setTimeout(tick, READY_POLL_MS);
  }

  function clear() {
    stopReadyPump();
    signature = null;
    selectedId = null;
    drawn.clear();
    dataSource.entities.removeAll();
    requestRender(`${layerId}-clear`);
  }

  return {
    dataSource,

    /** Rebuild only when the drawn set changed; returns whether it rebuilt. */
    render({ lines, points }) {
      const next = JSON.stringify([
        lines.map((line) => [line.id, line.positions.length, line.color]),
        points.map((point) => [point.id, point.lat, point.lon, point.color]),
      ]);
      if (next === signature) {
        // Same geometry: keep entities, but let cards read the newest tags.
        for (const feature of [...lines, ...points]) {
          const entry = drawn.get(feature.id);
          if (entry) entry.feature = feature;
        }
        return false;
      }
      signature = null;
      dataSource.entities.suspendEvents();
      try {
        dataSource.entities.removeAll();
        drawn.clear();
        for (const feature of lines)
          drawn.set(feature.id, { feature, entity: addLine(feature) });
        for (const feature of points)
          drawn.set(feature.id, { feature, entity: addPoint(feature) });
        const selected = drawn.get(selectedId);
        if (selected) applyStyle(selected, true);
        else selectedId = null;
      } finally {
        dataSource.entities.resumeEvents();
      }
      signature = next;
      requestRender(`${layerId}-render`);
      startReadyPump();
      return true;
    },

    featureIdFromPick(picked) {
      const id =
        picked?.id instanceof Cesium.Entity ? picked.id.id : picked?.id;
      if (typeof id !== 'string' || !id.startsWith(prefix)) return null;
      const featureId = id.slice(prefix.length);
      return drawn.has(featureId) ? featureId : null;
    },

    featureOf: (featureId) => drawn.get(featureId)?.feature ?? null,

    /** A point's own position, or a line's middle vertex. */
    positionOf(featureId) {
      const feature = drawn.get(featureId)?.feature;
      if (!feature) return null;
      if (feature.positions) {
        const [lon, lat] =
          feature.positions[Math.floor(feature.positions.length / 2)];
        return Cesium.Cartesian3.fromDegrees(lon, lat);
      }
      return Cesium.Cartesian3.fromDegrees(feature.lon, feature.lat);
    },

    setSelected(featureId) {
      if (featureId === selectedId) return;
      const previous = drawn.get(selectedId);
      if (previous) applyStyle(previous, false);
      const next = drawn.get(featureId);
      selectedId = next ? featureId : null;
      if (next) applyStyle(next, true);
      requestRender(`${layerId}-selection`);
      startReadyPump();
    },

    setVisible(visible) {
      dataSource.show = Boolean(visible);
      requestRender(`${layerId}-visibility`);
    },

    clear,

    destroy() {
      clear();
      viewer.dataSources.remove(dataSource, true);
    },
  };
}
