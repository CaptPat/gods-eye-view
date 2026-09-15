import * as Cesium from 'cesium';
import {
  NEAR_DEPTH_TEST_DISTANCE_M,
  trackHorizonDepthTest,
} from '../catalog-points/horizonDepth.js';

export const POINT_PIXEL_SIZE = 7;
export const SELECTED_PIXEL_SIZE = 13;
export const POINT_HEIGHT_M = 5;
/**
 * A station draws through terrain and 3D tiles out to the horizon, and never
 * less than this distance (see catalog-points/horizonDepth.js).
 */
export const DEPTH_TEST_DISTANCE_M = NEAR_DEPTH_TEST_DISTANCE_M;
const SCALE_BY_DISTANCE = new Cesium.NearFarScalar(
  50_000,
  1.2,
  12_000_000,
  0.55,
);
const OUTLINE = Cesium.Color.BLACK.withAlpha(0.6);

export function stationPickId(layerId, stationId) {
  return `${layerId}:${stationId}`;
}

/**
 * One PointPrimitiveCollection per layer, the bikeshare pattern: a few thousand
 * points cost one draw call, are frustum-culled by Cesium, and hide behind the
 * globe through the depth test.
 */
export function createStationPoints(
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
  const points = new Map();
  let selectedId = null;
  const horizon = trackHorizonDepthTest(
    viewer,
    (distanceM) => {
      for (const point of points.values())
        point.disableDepthTestDistance = distanceM;
    },
    { isActive: () => collection.show },
  );

  function applyStyle(point, selected) {
    point.pixelSize = selected ? SELECTED_PIXEL_SIZE : POINT_PIXEL_SIZE;
    point.outlineColor = selected ? Cesium.Color.WHITE : OUTLINE;
    point.outlineWidth = selected ? 2 : 1;
  }

  return {
    setStations(stations) {
      collection.removeAll();
      points.clear();
      for (const station of stations) {
        const point = collection.add({
          id: stationPickId(layerId, station.id),
          position: Cesium.Cartesian3.fromDegrees(
            station.lon,
            station.lat,
            POINT_HEIGHT_M,
          ),
          color: base,
          scaleByDistance: SCALE_BY_DISTANCE,
          disableDepthTestDistance: horizon.distanceM(),
        });
        applyStyle(point, false);
        points.set(station.id, point);
      }
      if (selectedId !== null && points.has(selectedId))
        applyStyle(points.get(selectedId), true);
      else selectedId = null;
      return points.size;
    },
    setSelected(stationId) {
      if (selectedId !== null && points.has(selectedId))
        applyStyle(points.get(selectedId), false);
      selectedId =
        stationId !== null && points.has(stationId) ? stationId : null;
      if (selectedId !== null) applyStyle(points.get(selectedId), true);
    },
    selectedId: () => selectedId,
    positionOf(stationId) {
      return points.get(stationId)?.position ?? null;
    },
    /** A scene.pick result → this layer's station id, or null. */
    stationIdFromPick(picked) {
      const raw =
        typeof picked?.primitive?.id === 'string'
          ? picked.primitive.id
          : typeof picked?.id === 'string'
            ? picked.id
            : null;
      const prefix = `${layerId}:`;
      if (!raw?.startsWith(prefix)) return null;
      const stationId = raw.slice(prefix.length);
      return points.has(stationId) ? stationId : null;
    },
    setShow(show) {
      collection.show = Boolean(show);
    },
    count: () => points.size,
    destroy() {
      horizon.destroy();
      points.clear();
      selectedId = null;
      viewer.scene.primitives.remove(collection);
    },
  };
}
