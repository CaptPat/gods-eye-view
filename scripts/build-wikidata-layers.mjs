#!/usr/bin/env node
// Rebuild the bundled Wikidata (CC0) snapshots for the Wikidata point layers.
//
//   node scripts/build-wikidata-layers.mjs                 # every layer
//   node scripts/build-wikidata-layers.mjs heritage        # files under local_data/heritage/
//   node scripts/build-wikidata-layers.mjs heritage/parks  # one file
//
// Queries are POSTed one at a time with an identifying User-Agent and retried
// on network errors, overload statuses and responses truncated by the 60 s
// query timeout. A layer may split its query; bindings merge before
// normalising. Forts & Castles is too large for labels in one query, so it
// fetches ids per class first, then labels, country and article in chunks.
// Large layers write compact { fields, rows } tables.
// UFO Incidents keeps its own script (scripts/build-ufo-incidents.mjs).
import { mkdir, writeFile } from 'node:fs/promises';
import {
  NUCLEAR_QUERIES,
  normalizeNuclearAccidents,
  normalizeNuclearPlants,
  normalizeNuclearWasteSites,
} from '../src/layers/nuclear/wikidata.js';
import {
  HERITAGE_QUERIES,
  fortDetailsQuery,
  mergeFortBindings,
  normalizeFortsCastles,
  normalizeParksMonuments,
  normalizeWorldHeritage,
} from '../src/layers/heritage/wikidata.js';
import {
  HERITAGE_FIELDS,
  toHeritageRows,
} from '../src/layers/heritage/model.js';

const ENDPOINT = 'https://query.wikidata.org/sparql';
const USER_AGENT =
  'CyclopsView/0.1 (+https://github.com/CaptPat/gods-eye-view)';
const LOCAL_DATA = new URL('../src/data/local_data/', import.meta.url);
const MAX_ATTEMPTS = 4;
const DETAIL_CHUNK = 1500;

const compactHeritage = (kind) => (records) => ({
  fields: HERITAGE_FIELDS[kind],
  rows: toHeritageRows(kind, records),
});

export const WIKIDATA_LAYERS = Object.freeze([
  {
    file: 'nuclear/nuclear-power-plants.json',
    queries: [NUCLEAR_QUERIES.plants],
    normalize: normalizeNuclearPlants,
  },
  {
    file: 'nuclear/nuclear-waste-sites.json',
    queries: [NUCLEAR_QUERIES.waste],
    normalize: normalizeNuclearWasteSites,
  },
  {
    file: 'nuclear/nuclear-accidents.json',
    queries: [NUCLEAR_QUERIES.accidents],
    normalize: normalizeNuclearAccidents,
  },
  {
    file: 'heritage/world-heritage.json',
    queries: [HERITAGE_QUERIES.worldHeritage],
    normalize: normalizeWorldHeritage,
    compact: compactHeritage('worldHeritage'),
  },
  {
    file: 'heritage/forts-castles.json',
    queries: HERITAGE_QUERIES.forts,
    details: { query: fortDetailsQuery, merge: mergeFortBindings },
    normalize: normalizeFortsCastles,
    compact: compactHeritage('forts'),
  },
  {
    file: 'heritage/parks-monuments.json',
    queries: [HERITAGE_QUERIES.parks],
    normalize: normalizeParksMonuments,
    compact: compactHeritage('parks'),
  },
]);

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

async function query(sparql) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          Accept: 'application/sparql-results+json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT,
        },
        body: new URLSearchParams({ query: sparql }),
      });
      if (!response.ok && !RETRYABLE.has(response.status))
        throw Object.assign(
          new Error(`Wikidata answered HTTP ${response.status}`),
          { fatal: true },
        );
      if (response.ok) return await response.json();
      lastError = new Error(`Wikidata answered HTTP ${response.status}`);
    } catch (error) {
      if (error.fatal) throw error;
      // Network resets and JSON truncated by the query timeout are retried.
      lastError = error;
    }
    if (attempt < MAX_ATTEMPTS) await pause(5_000 * attempt);
  }
  throw lastError;
}

const itemId = (binding) => binding.item.value.split('/').pop();

async function fetchBindings(layer) {
  const bindings = [];
  for (const sparql of layer.queries)
    bindings.push(...(await query(sparql)).results.bindings);
  if (!layer.details) return bindings;
  const ids = [...new Set(bindings.map(itemId))];
  const details = [];
  for (let start = 0; start < ids.length; start += DETAIL_CHUNK) {
    const chunk = ids.slice(start, start + DETAIL_CHUNK);
    details.push(...(await query(layer.details.query(chunk))).results.bindings);
    console.log(
      `  ${layer.file}: details ${Math.min(start + DETAIL_CHUNK, ids.length)}/${ids.length}`,
    );
  }
  return layer.details.merge(bindings, details);
}

async function main() {
  const only = process.argv[2];
  const retrievedAt = new Date().toISOString().slice(0, 10);
  const layers = WIKIDATA_LAYERS.filter(
    (layer) => !only || layer.file.startsWith(only),
  );
  if (!layers.length) throw new Error(`No Wikidata layer matches ${only}`);
  for (const layer of layers) {
    const records = layer.normalize({
      results: { bindings: await fetchBindings(layer) },
    });
    if (!records?.length) throw new Error(`${layer.file}: no located records`);
    const output = new URL(layer.file, LOCAL_DATA);
    await mkdir(new URL('.', output), { recursive: true });
    const head = { source: 'Wikidata', license: 'CC0-1.0', retrievedAt };
    await writeFile(
      output,
      layer.compact
        ? `${JSON.stringify({ ...head, ...layer.compact(records) })}\n`
        : `${JSON.stringify({ ...head, records }, null, 1)}\n`,
    );
    console.log(`${layer.file}: ${records.length} records`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
