import * as Cesium from 'cesium';

export const DEFAULT_LINE_WIDTH = 2;
const SELECTED_COLOR = Cesium.Color.WHITE;

const isPlaceable = (record) =>
  typeof record?.id === 'string' &&
  record.id !== '' &&
  Array.isArray(record.positions) &&
  record.positions.length >= 4 &&
  record.positions.length % 2 === 0 &&
  record.positions.every(Number.isFinite);

/** The middle vertex of a flat `[lon, lat, …]` list, or the midpoint of the middle pair. */
function middleOf(positions) {
  const last = positions.length / 2 - 1;
  const a = Math.floor(last / 2) * 2;
  const b = Math.ceil(last / 2) * 2;
  return Cesium.Cartesian3.fromDegrees(
    (positions[a] + positions[b]) / 2,
    (positions[a + 1] + positions[b + 1]) / 2,
  );
}

/**
 * The line counterpart of `createCatalogPoints`, with the same interface, so
 * `createCatalogPointsLayer({ createPoints: createCatalogLines })` gives a
 * bundled line catalogue its cards, selection and lifecycle. Records
 * `{ id, positions: [lon, lat, …], color?, width? }` become instances of one
 * ground polyline primitive (one batch however many lines), draped on the
 * globe and 3D tiles. Selection recolours the picked instance.
 */
export function createCatalogLines(
  viewer,
  {
    layerId,
    color,
    createPrimitive = (options) => new Cesium.GroundPolylinePrimitive(options),
  },
) {
  const base = Cesium.Color.fromCssColorString(color);
  /** record id → { color, anchor } */
  const lines = new Map();
  let primitive = null;
  let shown = false;
  let selectedId = null;
  const pickId = (recordId) => `${layerId}:${recordId}`;

  function removePrimitive() {
    if (!primitive) return;
    viewer.scene.groundPrimitives.remove(primitive);
    primitive = null;
  }

  /** Instance attributes exist only once the asynchronous batch is built. */
  function paint(recordId, selected) {
    const entry = lines.get(recordId);
    if (!entry || !primitive?.ready) return;
    try {
      const attributes = primitive.getGeometryInstanceAttributes(
        pickId(recordId),
      );
      if (attributes)
        attributes.color = Cesium.ColorGeometryInstanceAttribute.toValue(
          selected ? SELECTED_COLOR : entry.color,
        );
    } catch {
      /* batch rebuilt or destroyed */
    }
  }

  return {
    setRecords(records) {
      removePrimitive();
      lines.clear();
      const instances = [];
      for (const record of records) {
        if (!isPlaceable(record) || lines.has(record.id)) continue;
        const lineColor = record.color
          ? (Cesium.Color.fromCssColorString(record.color) ?? base)
          : base;
        lines.set(record.id, {
          color: lineColor,
          anchor: middleOf(record.positions),
        });
        instances.push(
          new Cesium.GeometryInstance({
            id: pickId(record.id),
            geometry: new Cesium.GroundPolylineGeometry({
              positions: Cesium.Cartesian3.fromDegreesArray(record.positions),
              width:
                Number.isFinite(record.width) && record.width > 0
                  ? record.width
                  : DEFAULT_LINE_WIDTH,
            }),
            attributes: {
              color: Cesium.ColorGeometryInstanceAttribute.fromColor(lineColor),
            },
          }),
        );
      }
      if (instances.length) {
        primitive = createPrimitive({
          geometryInstances: instances,
          appearance: new Cesium.PolylineColorAppearance(),
          asynchronous: true,
          classificationType: Cesium.ClassificationType.BOTH,
        });
        primitive.show = shown;
        viewer.scene.groundPrimitives.add(primitive);
      }
      if (selectedId !== null && lines.has(selectedId)) paint(selectedId, true);
      else selectedId = null;
      return lines.size;
    },
    setSelected(recordId) {
      if (selectedId !== null) paint(selectedId, false);
      selectedId = recordId !== null && lines.has(recordId) ? recordId : null;
      if (selectedId !== null) paint(selectedId, true);
    },
    selectedId: () => selectedId,
    positionOf: (recordId) => lines.get(recordId)?.anchor ?? null,
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
      return lines.has(recordId) ? recordId : null;
    },
    setShow(show) {
      shown = Boolean(show);
      if (primitive) primitive.show = shown;
    },
    count: () => lines.size,
    destroy() {
      removePrimitive();
      lines.clear();
      selectedId = null;
    },
  };
}
