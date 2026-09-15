/**
 * Wikidata queries and normalisers for the heritage layers. Wikidata is CC0,
 * so `scripts/build-wikidata-layers.mjs` bundles compact snapshots. Pure.
 */
import { normalizeWikidataPoints } from '../wikidata-points/normalize.js';

const ENGLISH_ARTICLE =
  'OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . }';
// English first, then the languages heritage sites are most often described in.
const LABELS =
  'SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul,fr,de,es,it,pt,ru,uk,cs,pl,nl,sv,ja,zh,ko,ar,tr". }';

/**
 * Ids and coordinates for one fort class. Labels and articles are fetched
 * separately in chunks (fortDetailsQuery): with them, the castle class alone
 * runs past Wikidata's 60 s query timeout and arrives truncated.
 */
const fortQuery = (label) => `SELECT ?item ?coord ?clsLabel WHERE {
  ?cls rdfs:label "${label}"@en .
  ?item wdt:P31 ?cls ; wdt:P625 ?coord .
  BIND("${label}" AS ?clsLabel)
}`;

/** Label, country and English article for one chunk of fort item ids. */
export function fortDetailsQuery(ids) {
  return `SELECT ?item ?itemLabel ?countryLabel ?article WHERE {
  VALUES ?item { ${ids.map((id) => `wd:${id}`).join(' ')} }
  OPTIONAL { ?item wdt:P17 ?country . }
  ${ENGLISH_ARTICLE}
  ${LABELS}
}`;
}

/**
 * Join per-class id bindings with detail bindings by item. An item with no
 * details keeps its id binding alone, which the normaliser drops as unnamed.
 */
export function mergeFortBindings(idBindings, detailBindings) {
  const detailsById = new Map();
  for (const binding of detailBindings) {
    const id = binding.item?.value;
    if (!detailsById.has(id)) detailsById.set(id, []);
    detailsById.get(id).push(binding);
  }
  return idBindings.flatMap((binding) => {
    const details = detailsById.get(binding.item?.value);
    if (!details) return [binding];
    return details.map((detail) => ({
      ...detail,
      coord: binding.coord,
      clsLabel: binding.clsLabel,
    }));
  });
}

export const HERITAGE_QUERIES = Object.freeze({
  worldHeritage: `SELECT ?item ?itemLabel ?itemDescription ?coord ?countryLabel ?inception ?article WHERE {
  ?item wdt:P1435 wd:Q9259 ; wdt:P625 ?coord .
  OPTIONAL { ?item wdt:P17 ?country . }
  OPTIONAL { ?item wdt:P571 ?inception . }
  ${ENGLISH_ARTICLE}
  ${LABELS}
}`,
  forts: Object.freeze(
    ['castle', 'fort', 'fortification', 'star fort'].map(fortQuery),
  ),
  parks: `SELECT ?item ?itemLabel ?itemDescription ?clsLabel ?coord ?countryLabel ?inception ?article WHERE {
  VALUES ?cls { wd:Q46169 wd:Q893775 }
  ?item wdt:P31 ?cls ; wdt:P625 ?coord .
  OPTIONAL { ?item wdt:P17 ?country . }
  OPTIONAL { ?item wdt:P571 ?inception . }
  ${ENGLISH_ARTICLE}
  ${LABELS}
}`,
});

const withKinds = (records) =>
  records && records.filter((record) => record.kinds.length > 0);

export function normalizeWorldHeritage(json) {
  return normalizeWikidataPoints(json, {
    fields: {
      countries: { variable: 'countryLabel', type: 'list' },
      year: { variable: 'inception', type: 'year', pick: 'min' },
    },
    sort: 'name',
  });
}

export function normalizeFortsCastles(json) {
  return withKinds(
    normalizeWikidataPoints(json, {
      kindByClass: {
        castle: 'castle',
        fort: 'fort',
        fortification: 'fortification',
        'star fort': 'star-fort',
      },
      fields: { country: { variable: 'countryLabel' } },
      sort: 'name',
    }),
  );
}

export function normalizeParksMonuments(json) {
  return withKinds(
    normalizeWikidataPoints(json, {
      kindByClass: {
        'national park': 'park',
        'National Monument of the United States': 'monument',
      },
      fields: {
        country: { variable: 'countryLabel' },
        year: { variable: 'inception', type: 'year', pick: 'min' },
      },
      sort: 'name',
    }),
  );
}
