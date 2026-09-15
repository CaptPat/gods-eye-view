import {
  createFortsCastlesLayer,
  createParksMonumentsLayer,
  createWorldHeritageLayer,
} from '../../layers/heritage/index.js';
import { WIKIDATA_HERITAGE_CREDIT } from '../../data/dataCredits.js';
import { catalogPointServices } from './catalogPointServices.js';

/** Construct one World Heritage Sites layer over the application scene owners. */
export function createApplicationWorldHeritage(options = {}) {
  return createWorldHeritageLayer({
    ...catalogPointServices(WIKIDATA_HERITAGE_CREDIT),
    ...options,
  });
}

/** Construct one Forts & Castles layer over the application scene owners. */
export function createApplicationFortsCastles(options = {}) {
  return createFortsCastlesLayer({
    ...catalogPointServices(WIKIDATA_HERITAGE_CREDIT),
    ...options,
  });
}

/** Construct one National Parks & Monuments layer over the application scene owners. */
export function createApplicationParksMonuments(options = {}) {
  return createParksMonumentsLayer({
    ...catalogPointServices(WIKIDATA_HERITAGE_CREDIT),
    ...options,
  });
}
