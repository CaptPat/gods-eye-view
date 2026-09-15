import * as Cesium from 'cesium';

const HEIGHT_M = 5;
/** Inside this camera distance the markers draw through terrain and 3D tiles. */
const DEPTH_TEST_DISTANCE_M = 50_000;
const LABEL_FONT = '12px "JetBrains Mono", "SF Mono", monospace';
const OUTLINE = Cesium.Color.BLACK.withAlpha(0.7);

export function moonLabel({ illumination, waxing }) {
  return `☾ Moon overhead · ${Math.round(illumination * 100)}% lit, ${waxing ? 'waxing' : 'waning'}`;
}

/** Labelled points where the sun and the moon stand overhead. */
export function createBodyMarkers(
  viewer,
  {
    createPoints = () => new Cesium.PointPrimitiveCollection(),
    createLabels = () => new Cesium.LabelCollection(),
  } = {},
) {
  const points = createPoints();
  const labels = createLabels();
  points.show = false;
  labels.show = false;
  viewer.scene.primitives.add(points);
  viewer.scene.primitives.add(labels);
  let bodies = null;

  function create() {
    const point = (id, pixelSize, color) =>
      points.add({
        id,
        pixelSize,
        color: Cesium.Color.fromCssColorString(color),
        outlineColor: OUTLINE,
        outlineWidth: 1,
        disableDepthTestDistance: DEPTH_TEST_DISTANCE_M,
      });
    const label = (id, text) =>
      labels.add({
        id,
        text,
        font: LABEL_FONT,
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -18),
        disableDepthTestDistance: DEPTH_TEST_DISTANCE_M,
      });
    return {
      sunPoint: point('day-night:sun', 12, '#ffd23f'),
      moonPoint: point('day-night:moon', 10, '#dfe7f2'),
      sunLabel: label('day-night:sun', '☀ Sun overhead'),
      moonLabel: label('day-night:moon', ''),
    };
  }

  const at = ({ lat, lon }) =>
    Cesium.Cartesian3.fromDegrees(lon, lat, HEIGHT_M);

  return {
    set({ sun, moon, illumination, waxing }) {
      bodies ??= create();
      bodies.sunPoint.position = at(sun);
      bodies.sunLabel.position = at(sun);
      bodies.moonPoint.position = at(moon);
      bodies.moonLabel.position = at(moon);
      bodies.moonLabel.text = moonLabel({ illumination, waxing });
    },
    setShow(show) {
      points.show = Boolean(show);
      labels.show = Boolean(show);
    },
    destroy() {
      viewer.scene.primitives.remove(points);
      viewer.scene.primitives.remove(labels);
      bodies = null;
    },
  };
}
