import { createUsPipelinesLayer } from '../../layers/us-pipelines/index.js';
import { US_PIPELINES_CREDIT } from '../../data/dataCredits.js';
import { catalogPointServices } from './catalogPointServices.js';

/** Construct one US Pipelines layer over the application scene owners. */
export function createApplicationUsPipelines(options = {}) {
  return createUsPipelinesLayer({
    ...catalogPointServices(US_PIPELINES_CREDIT),
    ...options,
  });
}
