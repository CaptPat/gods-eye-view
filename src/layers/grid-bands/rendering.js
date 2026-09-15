import * as Cesium from 'cesium';

/**
 * Draw grid bands (see bands.js) as ground rectangles in one CustomDataSource.
 * `levels[i]` is `{ color, alpha }` for band level i; other levels are skipped.
 * Rectangles classify both the globe and 3D tiles, like the severe-weather
 * fills. Every scene change requests a render: the app idles in Cesium's
 * requestRenderMode.
 */
export function createBandRendering(
  viewer,
  { id, levels, requestRender = () => {} },
) {
  const dataSource = new Cesium.CustomDataSource(id);
  dataSource.show = false;
  viewer.dataSources.add(dataSource);
  const materials = levels.map(({ color, alpha }) =>
    Cesium.Color.fromCssColorString(color).withAlpha(alpha),
  );

  return {
    dataSource,
    setBands(bands) {
      const { entities } = dataSource;
      entities.suspendEvents();
      entities.removeAll();
      let count = 0;
      for (const band of bands) {
        const material = materials[band.level];
        if (!material) continue;
        entities.add({
          id: `${id}:${count}`,
          rectangle: {
            coordinates: Cesium.Rectangle.fromDegrees(
              band.west,
              band.south,
              band.east,
              band.north,
            ),
            material,
            classificationType: Cesium.ClassificationType.BOTH,
          },
        });
        count += 1;
      }
      entities.resumeEvents();
      requestRender(id);
      return count;
    },
    setShow(show) {
      dataSource.show = Boolean(show);
      requestRender(id);
    },
    clear() {
      dataSource.entities.removeAll();
      requestRender(id);
    },
    destroy() {
      dataSource.entities.removeAll();
      viewer.dataSources.remove(dataSource, true);
    },
  };
}
