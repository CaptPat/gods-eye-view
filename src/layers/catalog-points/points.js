import * as Cesium from 'cesium';

export const DEFAULT_PIXEL_SIZE = 7;
/** A selected point grows by this many pixels over its own size. */
export const SELECTED_PIXEL_GROWTH = 6;
export const POINT_HEIGHT_M = 5;
/** Inside this camera distance a point draws through terrain and 3D tiles. */
export const DEPTH_TEST_DISTANCE_M = 50_000;
const SCALE_BY_DISTANCE = new Cesium.NearFarScalar(
  50_000,
  1.2,
  12_000_000,
  0.55,
);
const OUTLINE = Cesium.Color.BLACK.withAlpha(0.6);

export function catalogPickId(layerId, recordId) {
  return `${layerId}:${recordId}`;
}

const isPlaceable = (record) =>
  typeof record?.id === 'string' &&
  record.id !== '' &&
  Number.isFinite(record.lat) &&
  Number.isFinite(record.lon) &&
  Math.abs(record.lat) <= 90 &&
  Math.abs(record.lon) <= 180;

/**
 * One PointPrimitiveCollection per catalog layer (the tide-station pattern):
 * records `{ id, lat, lon, pixelSize?, color? }` become pickable points that
 * cost one draw call. Points sit at a fixed height, never clamped, so they
 * track the globe at every zoom (see severe-weather rendering.js).
 */
export function createCatalogPoints(
  viewer,
  {
    layerId,
    color,
    createCollection = () =>
      new Cesium.PointPrimitiveCollection({
        blendOption: Cesium.BlendOption.TRANSLUCENT,
      }),
  },
) {
  const collection = createCollection();
  collection.show = false;
  viewer.scene.primitives.add(collection);
  const base = Cesium.Color.fromCssColorString(color);
  /** record id → { point, size } */
  const points = new Map();
  let selectedId = null;

  function applyStyle(entry, selected) {
    entry.point.pixelSize = entry.size + (selected ? SELECTED_PIXEL_GROWTH : 0);
    entry.point.outlineColor = selected ? Cesium.Color.WHITE : OUTLINE;
    entry.point.outlineWidth = selected ? 2 : 1;
  }

  return {
    setRecords(records) {
      collection.removeAll();
      points.clear();
      for (const record of records) {
        if (!isPlaceable(record) || points.has(record.id)) continue;
        const size =
          Number.isFinite(record.pixelSize) && record.pixelSize > 0
            ? record.pixelSize
            : DEFAULT_PIXEL_SIZE;
        const point = collection.add({
          id: catalogPickId(layerId, record.id),
          position: Cesium.Cartesian3.fromDegrees(
            record.lon,
            record.lat,
            POINT_HEIGHT_M,
          ),
          color: record.color
            ? (Cesium.Color.fromCssColorString(record.color) ?? base)
            : base,
          scaleByDistance: SCALE_BY_DISTANCE,
          disableDepthTestDistance: DEPTH_TEST_DISTANCE_M,
        });
        const entry = { point, size };
        applyStyle(entry, false);
        points.set(record.id, entry);
      }
      if (selectedId !== null && points.has(selectedId))
        applyStyle(points.get(selectedId), true);
      else selectedId = null;
      return points.size;
    },
    setSelected(recordId) {
      if (selectedId !== null && points.has(selectedId))
        applyStyle(points.get(selectedId), false);
      selectedId = recordId !== null && points.has(recordId) ? recordId : null;
      if (selectedId !== null) applyStyle(points.get(selectedId), true);
    },
    selectedId: () => selectedId,
    positionOf(recordId) {
      return points.get(recordId)?.point.position ?? null;
    },
    /** A scene.pick result → this layer's record id, or null. */
    recordIdFromPick(picked) {
      const raw =
        typeof picked?.primitive?.id === 'string'
          ? picked.primitive.id
          : typeof picked?.id === 'string'
            ? picked.id
            : null;
      const prefix = `${layerId}:`;
      if (!raw?.startsWith(prefix)) return null;
      const recordId = raw.slice(prefix.length);
      return points.has(recordId) ? recordId : null;
    },
    setShow(show) {
      collection.show = Boolean(show);
    },
    count: () => points.size,
    destroy() {
      points.clear();
      selectedId = null;
      viewer.scene.primitives.remove(collection);
    },
  };
}
