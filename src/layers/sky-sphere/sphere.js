import * as Cesium from 'cesium';

/** About 16 Earth radii: beyond any camera orbit, well inside the 5×10⁸ m far plane. */
export const SKY_RADIUS_M = 1e8;
/** The sky turns 0.25° a minute; one idle render a minute keeps it current. */
export const SKY_RENDER_INTERVAL_MS = 60_000;
/** Beyond the Earth's equatorial radius and upper atmosphere. */
export const EARTH_MARGIN_M = 7_000_000;

/**
 * How far to enlarge the sphere so the whole Earth stays nearer the camera
 * than the sky: 1 until the camera is within EARTH_MARGIN_M of the radius.
 * The app sets no maximum zoom distance.
 */
export function skyScale(cameraDistanceM) {
  return Math.max(1, (cameraDistanceM + EARTH_MARGIN_M) / SKY_RADIUS_M);
}

export function skyPosition(unit, radius = SKY_RADIUS_M) {
  return new Cesium.Cartesian3(
    unit.x * radius,
    unit.y * radius,
    unit.z * radius,
  );
}

/** ICRF→Earth-fixed, matching Cesium's star skybox; TEME until orientation data loads. */
function inertialToFixed(time, result) {
  return (
    Cesium.Transforms.computeIcrfToFixedMatrix(time, result) ??
    Cesium.Transforms.computeTemeToPseudoFixedMatrix(time, result)
  );
}

function preloadOrientation(time) {
  return Cesium.Transforms.preloadIcrfFixed(
    new Cesium.TimeInterval({
      start: Cesium.JulianDate.addDays(time, -1, new Cesium.JulianDate()),
      stop: Cesium.JulianDate.addDays(time, 1, new Cesium.JulianDate()),
    }),
  );
}

/**
 * Points, polylines and labels on a sphere centred on the camera and turned
 * with the sky. Each frame their model matrix is the camera position plus the
 * inertial→fixed rotation, so sky objects show no parallax at any altitude,
 * yet ordinary depth testing still hides them behind the Earth and 3D tiles.
 */
export function createSkySphere(
  viewer,
  {
    id,
    computeRotation = inertialToFixed,
    preload = preloadOrientation,
    requestRender = () => {},
    now = Date.now,
    timers = globalThis,
    createPoints = () => new Cesium.PointPrimitiveCollection(),
    createLines = () => new Cesium.PolylineCollection(),
    createLabels = () => new Cesium.LabelCollection(),
  },
) {
  const points = createPoints();
  const lines = createLines();
  const labels = createLabels();
  const collections = [points, lines, labels];
  for (const collection of collections) {
    collection.show = false;
    viewer.scene.primitives.add(collection);
  }
  const rotation = new Cesium.Matrix3();
  const matrix = new Cesium.Matrix4();
  let removeListener = null;
  let interval = null;
  let preloaded = false;

  function updateFrame() {
    const time = Cesium.JulianDate.fromDate(new Date(now()));
    const turn = computeRotation(time, rotation);
    Cesium.Matrix4.fromRotationTranslation(
      turn,
      viewer.camera.positionWC,
      matrix,
    );
    const scale = skyScale(
      Cesium.Cartesian3.magnitude(viewer.camera.positionWC),
    );
    if (scale > 1) Cesium.Matrix4.multiplyByUniformScale(matrix, scale, matrix);
    for (const collection of collections)
      collection.modelMatrix = Cesium.Matrix4.clone(
        matrix,
        collection.modelMatrix,
      );
  }

  function attach() {
    if (removeListener) return;
    removeListener = viewer.scene.preRender.addEventListener(updateFrame);
    interval = timers.setInterval(
      () => requestRender(id),
      SKY_RENDER_INTERVAL_MS,
    );
    if (!preloaded) {
      preloaded = true;
      Promise.resolve()
        .then(() => preload(Cesium.JulianDate.fromDate(new Date(now()))))
        .catch(() => {});
    }
    updateFrame();
  }

  function detach() {
    removeListener?.();
    removeListener = null;
    if (interval !== null) timers.clearInterval(interval);
    interval = null;
  }

  return {
    points,
    lines,
    labels,
    updateFrame,
    attach,
    detach,
    show(visible) {
      for (const collection of collections) collection.show = Boolean(visible);
      requestRender(id);
    },
    destroy() {
      detach();
      for (const collection of collections)
        viewer.scene.primitives.remove(collection);
    },
  };
}
