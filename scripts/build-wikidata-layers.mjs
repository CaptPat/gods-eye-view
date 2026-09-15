#!/usr/bin/env node
// Rebuild the bundled Wikidata (CC0) snapshots for the Wikidata point layers.
//
//   node scripts/build-wikidata-layers.mjs
//
// Queries run one at a time, politely, with an identifying User-Agent.
// UFO Incidents keeps its own script (scripts/build-ufo-incidents.mjs).
import { mkdir, writeFile } from 'node:fs/promises';
import {
  NUCLEAR_QUERIES,
  normalizeNuclearAccidents,
  normalizeNuclearPlants,
  normalizeNuclearWasteSites,
} from '../src/layers/nuclear/wikidata.js';

const ENDPOINT = 'https://query.wikidata.org/sparql';
const USER_AGENT =
  'CyclopsView/0.1 (+https://github.com/CaptPat/gods-eye-view)';
const LOCAL_DATA = new URL('../src/data/local_data/', import.meta.url);

export const WIKIDATA_LAYERS = Object.freeze([
  {
    file: 'nuclear/nuclear-power-plants.json',
    query: NUCLEAR_QUERIES.plants,
    normalize: normalizeNuclearPlants,
  },
  {
    file: 'nuclear/nuclear-waste-sites.json',
    query: NUCLEAR_QUERIES.waste,
    normalize: normalizeNuclearWasteSites,
  },
  {
    file: 'nuclear/nuclear-accidents.json',
    query: NUCLEAR_QUERIES.accidents,
    normalize: normalizeNuclearAccidents,
  },
]);

async function query(sparql) {
  const response = await fetch(
    `${ENDPOINT}?${new URLSearchParams({ query: sparql })}`,
    {
      headers: {
        Accept: 'application/sparql-results+json',
        'User-Agent': USER_AGENT,
      },
    },
  );
  if (!response.ok)
    throw new Error(`Wikidata answered HTTP ${response.status}`);
  return response.json();
}

async function main() {
  const retrievedAt = new Date().toISOString().slice(0, 10);
  for (const layer of WIKIDATA_LAYERS) {
    const records = layer.normalize(await query(layer.query));
    if (!records?.length) throw new Error(`${layer.file}: no located records`);
    const output = new URL(layer.file, LOCAL_DATA);
    await mkdir(new URL('.', output), { recursive: true });
    await writeFile(
      output,
      `${JSON.stringify({ source: 'Wikidata', license: 'CC0-1.0', retrievedAt, records }, null, 1)}\n`,
    );
    console.log(`${layer.file}: ${records.length} records`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
