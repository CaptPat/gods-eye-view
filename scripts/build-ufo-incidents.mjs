#!/usr/bin/env node
// Rebuild the bundled UFO Incidents snapshot from Wikidata (CC0).
//
//   node scripts/build-ufo-incidents.mjs
//
// Writes src/data/local_data/ufo_incidents/ufo-incidents.json. NUFORC's report
// database is deliberately not used: its terms forbid scraping and
// redistribution. Wikidata's notable incidents link to Wikipedia instead.
import { writeFile } from 'node:fs/promises';
import { normalizeWikidataUfoIncidents } from '../src/layers/ufo-incidents/wikidata.js';

const ENDPOINT = 'https://query.wikidata.org/sparql';
const USER_AGENT =
  'CyclopsView/0.1 (+https://github.com/CaptPat/gods-eye-view)';
const OUTPUT = new URL(
  '../src/data/local_data/ufo_incidents/ufo-incidents.json',
  import.meta.url,
);

export const UFO_INCIDENTS_QUERY = `SELECT DISTINCT ?item ?itemLabel ?itemDescription ?clsLabel ?coord ?placeCoord ?placeLabel ?date ?article WHERE {
  VALUES ?label { "UFO sighting"@en "unidentified flying object"@en "alien abduction"@en "close encounter"@en "UFO crash"@en "UFO incident"@en }
  ?cls rdfs:label ?label .
  ?item wdt:P31 ?cls .
  OPTIONAL { ?item wdt:P625 ?coord . }
  OPTIONAL { ?item wdt:P276|wdt:P131 ?place . ?place wdt:P625 ?placeCoord . }
  OPTIONAL { ?item wdt:P585|wdt:P580 ?date . }
  OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". ?item rdfs:label ?itemLabel . ?item schema:description ?itemDescription . ?cls rdfs:label ?clsLabel . ?place rdfs:label ?placeLabel . }
}`;

async function main() {
  const url = `${ENDPOINT}?${new URLSearchParams({ query: UFO_INCIDENTS_QUERY })}`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/sparql-results+json',
      'User-Agent': USER_AGENT,
    },
  });
  if (!response.ok)
    throw new Error(`Wikidata answered HTTP ${response.status}`);
  const incidents = normalizeWikidataUfoIncidents(await response.json());
  if (!incidents?.length)
    throw new Error('Wikidata returned no located incidents');
  const snapshot = {
    source: 'Wikidata',
    license: 'CC0-1.0',
    retrievedAt: new Date().toISOString().slice(0, 10),
    incidents,
  };
  await writeFile(OUTPUT, `${JSON.stringify(snapshot, null, 1)}\n`);
  console.log(`Wrote ${incidents.length} incidents to ${OUTPUT.pathname}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
