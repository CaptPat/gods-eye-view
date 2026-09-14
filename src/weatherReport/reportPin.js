import * as Cesium from 'cesium';

export const PIN_SOURCE_ID = 'weather-report';
const ENTITY_ID = 'weather-report-pin';

/** One report location: a Cesium point marker plus a pinned world-overlay card. */
export function createReportPin({
  viewer,
  overlayHost,
  requestRender = () => {},
  onActivate = () => {},
}) {
  let dataSource = null;
  let marker = null;
  let current = null;

  function publish() {
    const position = Cesium.Cartesian3.fromDegrees(
      current.point.lon,
      current.point.lat,
    );
    overlayHost.setVisible(PIN_SOURCE_ID, true);
    overlayHost.setEntries(PIN_SOURCE_ID, [
      {
        id: ENTITY_ID,
        position,
        variant: 'card',
        title: current.summary.title,
        details: [...current.summary.details],
        pinned: true,
        interactive: true,
        accessibilityLabel: 'Open weather report',
        activate: () => onActivate(),
        priority: 1_000_000,
        placement: 'above',
      },
    ]);
  }

  function show(point, summary) {
    current = { point, summary };
    if (!dataSource) {
      dataSource = new Cesium.CustomDataSource('weather-report-pin');
      viewer.dataSources.add(dataSource);
    }
    if (marker) dataSource.entities.remove(marker);
    marker = dataSource.entities.add({
      id: ENTITY_ID,
      position: Cesium.Cartesian3.fromDegrees(point.lon, point.lat),
      point: {
        pixelSize: 8,
        color: Cesium.Color.fromCssColorString('#00d4ff'),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    publish();
    // Entity changes do not wake Cesium's requestRenderMode; overlay calls request their own frame.
    requestRender('weather-report');
  }

  function update(summary) {
    if (!current) return;
    current = { ...current, summary };
    publish();
  }

  function clear() {
    if (!current) return;
    if (marker && dataSource) dataSource.entities.remove(marker);
    marker = null;
    current = null;
    overlayHost.clearSource(PIN_SOURCE_ID);
    overlayHost.setVisible(PIN_SOURCE_ID, false);
    requestRender('weather-report');
  }

  function destroy() {
    clear();
    if (dataSource) {
      viewer.dataSources.remove(dataSource, true);
      dataSource = null;
    }
  }

  return { show, update, clear, destroy };
}
