// src/weatherReport/groundPick.js
import * as Cesium from 'cesium';
import { isPickedWorldPosition } from '../data/scenePick.js';

/** Ground under a window position via depth pick, ellipsoid, then globe ray (the view-target cascade). */
export function pickGround(viewer, windowPosition) {
  const scene = viewer?.scene;
  if (!scene || !Number.isFinite(windowPosition?.x) || !Number.isFinite(windowPosition?.y)) return null;
  const position = new Cesium.Cartesian2(windowPosition.x, windowPosition.y);
  const camera = viewer.camera;
  const attempts = [
    () => (scene.pickPositionSupported && typeof scene.pickPosition === 'function' ? scene.pickPosition(position) : null),
    () => (typeof camera?.pickEllipsoid === 'function' ? camera.pickEllipsoid(position, Cesium.Ellipsoid.WGS84) : null),
    () => (typeof camera?.getPickRay === 'function' && typeof scene.globe?.pick === 'function'
      ? scene.globe.pick(camera.getPickRay(position), scene)
      : null),
  ];
  for (const attempt of attempts) {
    let cartesian = null;
    try {
      cartesian = attempt();
    } catch {
      cartesian = null;
    }
    if (!isPickedWorldPosition(cartesian)) continue;
    const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
    if (!cartographic) continue;
    return {
      lat: Cesium.Math.toDegrees(cartographic.latitude),
      lon: Cesium.Math.toDegrees(cartographic.longitude),
    };
  }
  return null;
}
