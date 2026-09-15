#!/usr/bin/env node
// Rebuild the bundled US Pipelines snapshot.
//
//   node scripts/build-us-pipelines.mjs
//
// EIA U.S. Energy Atlas natural gas (interstate and intrastate), crude oil
// trunk and hydrocarbon gas liquids pipelines, simplified to 0.02°; BOEM/BSEE
// offshore pipeline segments simplified to 0.005° and joined to the BSEE
// Pipeline Masters file and company list. U.S. Government works, public domain.
import { mkdir, writeFile } from 'node:fs/promises';
import { firstZipEntry } from './zip-entry.mjs';
import { parseCompanies } from '../src/layers/offshore-platforms/bsee.js';
import {
  PIPELINE_FIELDS,
  toPipelineRows,
} from '../src/layers/us-pipelines/model.js';
import {
  mergeLineChains,
  normalizeEiaGas,
  normalizeEiaLiquids,
  normalizeOcsPipelines,
  parsePipelineMasters,
} from '../src/layers/us-pipelines/sources.js';

const USER_AGENT =
  'CyclopsView/0.1 (+https://github.com/CaptPat/gods-eye-view)';
const EIA =
  'https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services';
const OCS_LAYER =
  'https://gis.boem.gov/arcgis/rest/services/BOEM_BSEE/MMC_Layers/MapServer/2';
const BSEE = 'https://www.data.bsee.gov';
const OUTPUT = new URL(
  '../src/data/local_data/us_pipelines/us-pipelines.json',
  import.meta.url,
);
const PAGE_SIZE = 2000;

async function getJson(url) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json();
      if (json?.error) throw new Error(json.error.message ?? 'ArcGIS error');
      return json;
    } catch (error) {
      if (attempt >= 4) throw new Error(`${url}: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }
}

/** Every feature of an ArcGIS layer as one GeoJSON FeatureCollection, paged by offset. */
async function fetchLayer(layerUrl, { outFields, orderBy, offsetDegrees }) {
  const features = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const query = new URLSearchParams({
      where: '1=1',
      outFields,
      outSR: '4326',
      maxAllowableOffset: String(offsetDegrees),
      geometryPrecision: '3',
      orderByFields: orderBy,
      resultOffset: String(offset),
      resultRecordCount: String(PAGE_SIZE),
      f: 'geojson',
    });
    const page = await getJson(`${layerUrl}/query?${query}`);
    const pageFeatures = Array.isArray(page.features) ? page.features : [];
    features.push(...pageFeatures);
    if (pageFeatures.length < PAGE_SIZE) break;
  }
  return { type: 'FeatureCollection', features };
}

async function downloadZipText(path) {
  const response = await fetch(`${BSEE}${path}`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!response.ok) throw new Error(`${path} answered HTTP ${response.status}`);
  return firstZipEntry(Buffer.from(await response.arrayBuffer())).toString(
    'latin1',
  );
}

async function main() {
  const eia = (service, outFields) =>
    fetchLayer(`${EIA}/${service}/FeatureServer/0`, {
      outFields,
      orderBy: 'FID',
      offsetDegrees: 0.02,
    });
  const [gas, crude, hgl, ocs, mastersText, companiesText] = await Promise.all([
    eia(
      'Natural_Gas_Interstate_and_Intrastate_Pipelines_1',
      'FID,TYPEPIPE,Operator',
    ),
    eia('Crude_Oil_Trunk_Pipelines_1', 'FID,Opername,Pipename'),
    eia('Hydrocarbon_Gas_Liquids_Pipelines_1', 'FID,Opername,Pipename'),
    fetchLayer(OCS_LAYER, {
      outFields: 'SEGMENT_NUM',
      orderBy: 'OBJECTID',
      offsetDegrees: 0.005,
    }),
    downloadZipText('/Pipeline/Files/pplmastdelimit.zip'),
    downloadZipText('/Company/Files/compalldelimit.zip'),
  ]);

  const seen = new Set();
  // Chaining connected segments roughly halves the ground-line instances.
  const records = mergeLineChains(
    [
      ...normalizeEiaGas(gas),
      ...normalizeEiaLiquids(hgl, 'hgl'),
      ...normalizeEiaLiquids(crude, 'crude'),
      ...normalizeOcsPipelines(
        ocs,
        parsePipelineMasters(mastersText),
        parseCompanies(companiesText),
      ),
    ].filter((record) => !seen.has(record.id) && seen.add(record.id)),
  );
  if (records.length < 15_000)
    throw new Error(`only ${records.length} pipeline records`);

  const retrievedAt = new Date().toISOString().slice(0, 10);
  const body = `${JSON.stringify({
    source:
      'EIA U.S. Energy Atlas pipelines; BOEM/BSEE offshore pipeline segments and masters',
    license: 'Public Domain',
    retrievedAt,
    fields: PIPELINE_FIELDS,
    rows: toPipelineRows(records),
  })}\n`;
  await mkdir(new URL('.', OUTPUT), { recursive: true });
  await writeFile(OUTPUT, body);

  const byKind = {};
  let vertices = 0;
  for (const record of records) {
    byKind[record.kind] = (byKind[record.kind] ?? 0) + 1;
    vertices += record.positions.length / 2;
  }
  console.log(
    `us_pipelines/us-pipelines.json: ${records.length} lines, ${vertices} vertices, ${(body.length / 1e6).toFixed(2)} MB`,
  );
  console.log(byKind);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
