import * as Cesium from 'cesium';

/** Never depth-test a point closer than this, whatever the horizon. */
export const NEAR_DEPTH_TEST_DISTANCE_M = 50_000;
/** Rewrite the points only when the horizon moves by more than this fraction. */
export const RETUNE_FRACTION = 0.02;
const scratchSurface = new Cesium.Cartesian3();

/**
 * The camera distance inside which a surface point is on the camera's side of
 * the globe. A point P on a sphere of radius R faces a camera C exactly when
 * |P − C|² < |C|² − R², so this distance, used as disableDepthTestDistance,
 * hands horizon culling to the GPU. Nearer points draw over the Google 3D mesh,
 * which otherwise buries every point above sea level once depth-tested; farther
 * ones stay depth-tested and hide behind the globe. The globe stacks never
 * depth-test against terrain, so this matches what they already showed.
 * @param {Cesium.Cartesian3} cameraPositionWC
 * @returns {number} metres
 */
export function horizonDepthTestDistanceM(cameraPositionWC) {
  const surface = Cesium.Ellipsoid.WGS84.scaleToGeodeticSurface(
    cameraPositionWC,
    scratchSurface,
  );
  if (!surface) return NEAR_DEPTH_TEST_DISTANCE_M;
  const tangentSq =
    Cesium.Cartesian3.magnitudeSquared(cameraPositionWC) -
    Cesium.Cartesian3.magnitudeSquared(surface);
  return Math.max(
    NEAR_DEPTH_TEST_DISTANCE_M,
    Math.sqrt(Math.max(0, tangentSq)),
  );
}

/**
 * Feeds `apply(distanceM)` the horizon distance as the camera moves. It runs in
 * preRender, so the new value lands in the frame being drawn and needs no extra
 * render request. The distance depends only on camera height, so panning never
 * rewrites the points.
 * @param {Cesium.Viewer} viewer
 * @param {(distanceM: number) => void} apply
 * @param {{isActive?: () => boolean}} [options]
 * @returns {{distanceM: () => number, destroy: () => void}}
 */
export function trackHorizonDepthTest(
  viewer,
  apply,
  { isActive = () => true } = {},
) {
  let distanceM = NEAR_DEPTH_TEST_DISTANCE_M;
  const remove = viewer.scene.preRender.addEventListener(() => {
    if (!isActive()) return;
    const next = horizonDepthTestDistanceM(viewer.camera.positionWC);
    if (Math.abs(next - distanceM) <= distanceM * RETUNE_FRACTION) return;
    distanceM = next;
    apply(distanceM);
  });
  return { distanceM: () => distanceM, destroy: remove };
}
