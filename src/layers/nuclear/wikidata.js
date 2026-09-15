/**
 * Wikidata queries and normalisers for the three nuclear layers. Wikidata is
 * CC0, so `scripts/build-wikidata-layers.mjs` bundles the results. Pure.
 */
import { normalizeWikidataPoints } from '../wikidata-points/normalize.js';

const ENGLISH_ARTICLE =
  'OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . }';
// English first, then the languages nuclear sites are most often described in, so an
// item without an English label is not dropped as an unnamed QID.
const LABELS =
  'SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul,fr,de,es,it,pt,ru,uk,cs,sk,sv,fi,ja,zh,ko". }';
const PLACE_FALLBACK =
  'OPTIONAL { ?item wdt:P276|wdt:P131 ?place . ?place wdt:P625 ?placeCoord . }';

export const NUCLEAR_QUERIES = Object.freeze({
  plants: `SELECT ?item ?itemLabel ?itemDescription ?coord ?stateLabel ?capacity ?operatorLabel ?countryLabel ?start ?end ?article WHERE {
  ?cls rdfs:label "nuclear power plant"@en .
  ?item wdt:P31 ?cls ; wdt:P625 ?coord .
  OPTIONAL { ?item wdt:P5817 ?state . }
  OPTIONAL { ?item wdt:P2109 ?capacity . }
  OPTIONAL { ?item wdt:P137 ?operator . }
  OPTIONAL { ?item wdt:P17 ?country . }
  OPTIONAL { ?item wdt:P729|wdt:P571 ?start . }
  OPTIONAL { ?item wdt:P730|wdt:P576 ?end . }
  ${ENGLISH_ARTICLE}
  ${LABELS}
}`,
  waste: `SELECT DISTINCT ?item ?itemLabel ?itemDescription ?clsLabel ?coord ?placeCoord ?placeLabel ?operatorLabel ?countryLabel ?article WHERE {
  VALUES ?label { "radioactive waste repository"@en "deep geological repository"@en }
  ?cls rdfs:label ?label .
  ?item wdt:P31 ?cls .
  OPTIONAL { ?item wdt:P625 ?coord . }
  ${PLACE_FALLBACK}
  OPTIONAL { ?item wdt:P137 ?operator . }
  OPTIONAL { ?item wdt:P17 ?country . }
  ${ENGLISH_ARTICLE}
  ${LABELS}
}`,
  accidents: `SELECT DISTINCT ?item ?itemLabel ?itemDescription ?clsLabel ?coord ?placeCoord ?placeLabel ?date ?ines ?deaths ?countryLabel ?article WHERE {
  VALUES ?label { "nuclear accident"@en "nuclear disaster"@en "nuclear and radiation accident"@en "radiation accident"@en }
  ?cls rdfs:label ?label .
  ?item wdt:P31 ?cls .
  OPTIONAL { ?item wdt:P625 ?coord . }
  ${PLACE_FALLBACK}
  OPTIONAL { ?item wdt:P585|wdt:P580 ?date . }
  OPTIONAL { ?item wdt:P2127 ?inesItem . ?inesItem rdfs:label ?ines . FILTER(LANG(?ines) = "en") }
  OPTIONAL { ?item wdt:P1120 ?deaths . }
  OPTIONAL { ?item wdt:P17 ?country . }
  ${ENGLISH_ARTICLE}
  ${LABELS}
}`,
});

const WASTE_KINDS = Object.freeze({
  'radioactive waste repository': 'repository',
  'deep geological repository': 'deep-geological',
});

const ACCIDENT_KINDS = Object.freeze({
  'nuclear accident': 'accident',
  'nuclear and radiation accident': 'accident',
  'radiation accident': 'accident',
  'nuclear disaster': 'disaster',
});

export function normalizeNuclearPlants(json) {
  return normalizeWikidataPoints(json, {
    fields: {
      statuses: { variable: 'stateLabel', type: 'list' },
      capacityMw: { variable: 'capacity', type: 'number', pick: 'max' },
      operator: { variable: 'operatorLabel' },
      country: { variable: 'countryLabel' },
      startYear: { variable: 'start', type: 'year', pick: 'min' },
      endYear: { variable: 'end', type: 'year', pick: 'max' },
    },
    sort: 'name',
  });
}

export function normalizeNuclearWasteSites(json) {
  const records = normalizeWikidataPoints(json, {
    kindByClass: WASTE_KINDS,
    fields: {
      operator: { variable: 'operatorLabel' },
      country: { variable: 'countryLabel' },
    },
    sort: 'name',
  });
  return records && records.filter((record) => record.kinds.length > 0);
}

/** "INES level 7 event" labels → the highest level, or null. */
function inesLevel(labels) {
  const levels = labels
    .map((label) => /INES level (\d)/i.exec(label)?.[1])
    .filter(Boolean)
    .map(Number);
  return levels.length ? Math.max(...levels) : null;
}

export function normalizeNuclearAccidents(json) {
  const records = normalizeWikidataPoints(json, {
    kindByClass: ACCIDENT_KINDS,
    fields: {
      inesLabels: { variable: 'ines', type: 'list' },
      deaths: { variable: 'deaths', type: 'number', pick: 'max' },
      country: { variable: 'countryLabel' },
    },
    sort: 'date',
  });
  if (!records) return null;
  return records
    .filter((record) => record.kinds.length > 0)
    .map(({ inesLabels, ...record }) => ({
      ...record,
      ines: inesLevel(inesLabels),
    }));
}
