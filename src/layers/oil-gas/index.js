import {
  createOsmInfrastructureLayer,
  createOsmInfrastructureSource,
} from '../osm-infrastructure/index.js';
import {
  OIL_GAS_LEGEND,
  OIL_GAS_META,
  OIL_GAS_QUERY,
  buildOilGasCard,
  classifyOilGasLine,
  classifyOilGasPoint,
} from './model.js';

export * from './model.js';

/** OpenStreetMap oil and gas pipelines, wells, offshore platforms and refineries, loaded per view. */
export function createOilGasLayer({ fetchImpl, ...options } = {}) {
  return createOsmInfrastructureLayer({
    meta: OIL_GAS_META,
    query: OIL_GAS_QUERY,
    classifyLine: classifyOilGasLine,
    classifyPoint: classifyOilGasPoint,
    buildCard: buildOilGasCard,
    legend: OIL_GAS_LEGEND,
    source: createOsmInfrastructureSource(fetchImpl ? { fetchImpl } : {}),
    ...options,
  });
}
