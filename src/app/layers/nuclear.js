import {
  createNuclearAccidentsLayer,
  createNuclearPowerPlantsLayer,
  createNuclearWasteSitesLayer,
} from '../../layers/nuclear/index.js';
import { WIKIDATA_NUCLEAR_CREDIT } from '../../data/dataCredits.js';
import { catalogPointServices } from './catalogPointServices.js';

/** Construct one Nuclear Power Plants layer over the application scene owners. */
export function createApplicationNuclearPowerPlants(options = {}) {
  return createNuclearPowerPlantsLayer({
    ...catalogPointServices(WIKIDATA_NUCLEAR_CREDIT),
    ...options,
  });
}

/** Construct one Nuclear Waste Sites layer over the application scene owners. */
export function createApplicationNuclearWasteSites(options = {}) {
  return createNuclearWasteSitesLayer({
    ...catalogPointServices(WIKIDATA_NUCLEAR_CREDIT),
    ...options,
  });
}

/** Construct one Nuclear Accidents layer over the application scene owners. */
export function createApplicationNuclearAccidents(options = {}) {
  return createNuclearAccidentsLayer({
    ...catalogPointServices(WIKIDATA_NUCLEAR_CREDIT),
    ...options,
  });
}
