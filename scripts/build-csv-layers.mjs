#!/usr/bin/env node
// Rebuild the bundled CSV-derived point snapshots.
//
//   node scripts/build-csv-layers.mjs
//
// Power Plants: WRI Global Power Plant Database v1.3.0 (CC BY 4.0), hydro excluded.
// Airports: OurAirports (public domain), large and medium airports.
import { mkdir, writeFile } from 'node:fs/promises';
import {
  GPPD_CSV_URL,
  POWER_PLANT_FIELDS,
  normalizeGppdCsv,
} from '../src/layers/power-plants/source.js';
import {
  AIRPORT_FIELDS,
  OURAIRPORTS_CSV_URL,
  normalizeOurAirportsCsv,
} from '../src/layers/airports/source.js';

const USER_AGENT =
  'CyclopsView/0.1 (+https://github.com/CaptPat/gods-eye-view)';
const LOCAL_DATA = new URL('../src/data/local_data/', import.meta.url);

export const CSV_LAYERS = Object.freeze([
  {
    file: 'power_plants/power-plants.json',
    url: GPPD_CSV_URL,
    source: 'WRI Global Power Plant Database v1.3.0',
    license: 'CC-BY-4.0',
    fields: POWER_PLANT_FIELDS,
    normalize: normalizeGppdCsv,
  },
  {
    file: 'airports/airports.json',
    url: OURAIRPORTS_CSV_URL,
    source: 'OurAirports',
    license: 'Public Domain',
    fields: AIRPORT_FIELDS,
    normalize: normalizeOurAirportsCsv,
  },
]);

async function main() {
  const retrievedAt = new Date().toISOString().slice(0, 10);
  for (const layer of CSV_LAYERS) {
    const response = await fetch(layer.url, {
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!response.ok)
      throw new Error(`${layer.url} answered HTTP ${response.status}`);
    const rows = layer.normalize(await response.text());
    if (!rows.length) throw new Error(`${layer.file}: no rows`);
    const output = new URL(layer.file, LOCAL_DATA);
    await mkdir(new URL('.', output), { recursive: true });
    const { source, license, fields } = layer;
    await writeFile(
      output,
      `${JSON.stringify({ source, license, retrievedAt, fields, rows })}\n`,
    );
    console.log(`${layer.file}: ${rows.length} rows`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
