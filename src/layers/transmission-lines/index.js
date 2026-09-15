import {
  createOsmInfrastructureLayer,
  createOsmInfrastructureSource,
} from '../osm-infrastructure/index.js';
import {
  TRANSMISSION_LEGEND,
  TRANSMISSION_META,
  TRANSMISSION_QUERY,
  buildTransmissionCard,
  classifyTransmissionLine,
  classifyTransmissionPoint,
} from './model.js';

export * from './model.js';

/** OpenStreetMap power lines by voltage, substations and plants, loaded per view. */
export function createTransmissionLinesLayer({ fetchImpl, ...options } = {}) {
  return createOsmInfrastructureLayer({
    meta: TRANSMISSION_META,
    query: TRANSMISSION_QUERY,
    classifyLine: classifyTransmissionLine,
    classifyPoint: classifyTransmissionPoint,
    buildCard: buildTransmissionCard,
    legend: TRANSMISSION_LEGEND,
    source: createOsmInfrastructureSource(fetchImpl ? { fetchImpl } : {}),
    ...options,
  });
}
