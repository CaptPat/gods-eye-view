#!/usr/bin/env node
// Rebuild the bundled Offshore Platforms snapshot.
//
//   node scripts/build-bsee-platforms.mjs
//
// BSEE Data Center platform locations, structures and masters (fixed-width) and
// the company list (delimited): U.S. Government work, public domain. Only
// standing structures (no removal date) with a location are kept.
import { mkdir, writeFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import {
  PLATFORM_LOCATION_LAYOUT,
  PLATFORM_MASTER_LAYOUT,
  PLATFORM_STRUCTURE_LAYOUT,
  joinPlatforms,
  parseCompanies,
  parseFixedWidth,
} from '../src/layers/offshore-platforms/bsee.js';
import {
  PLATFORM_FIELDS,
  toPlatformRows,
} from '../src/layers/offshore-platforms/model.js';

const USER_AGENT =
  'CyclopsView/0.1 (+https://github.com/CaptPat/gods-eye-view)';
const BSEE = 'https://www.data.bsee.gov';
const OUTPUT = new URL(
  '../src/data/local_data/offshore_platforms/offshore-platforms.json',
  import.meta.url,
);
const FILES = Object.freeze({
  locations: '/Platform/Files/platlocfixed.zip',
  structures: '/Platform/Files/platstrufixed.zip',
  masters: '/Platform/Files/platmastfixed.zip',
  companies: '/Company/Files/compalldelimit.zip',
});

/** The first entry of a zip archive, read through its central directory. */
function firstZipEntry(buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error('not a zip archive');
  const central = buffer.readUInt32LE(end + 16);
  if (buffer.readUInt32LE(central) !== 0x02014b50)
    throw new Error('zip central directory not found');
  const method = buffer.readUInt16LE(central + 10);
  const compressedSize = buffer.readUInt32LE(central + 20);
  const local = buffer.readUInt32LE(central + 42);
  const start =
    local +
    30 +
    buffer.readUInt16LE(local + 26) +
    buffer.readUInt16LE(local + 28);
  const data = buffer.subarray(start, start + compressedSize);
  if (method === 0) return data;
  if (method === 8) return inflateRawSync(data);
  throw new Error(`unsupported zip compression method ${method}`);
}

async function download(path) {
  const response = await fetch(`${BSEE}${path}`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!response.ok) throw new Error(`${path} answered HTTP ${response.status}`);
  return firstZipEntry(Buffer.from(await response.arrayBuffer())).toString(
    'latin1',
  );
}

async function main() {
  const [locations, structures, masters, companies] = await Promise.all([
    download(FILES.locations),
    download(FILES.structures),
    download(FILES.masters),
    download(FILES.companies),
  ]);
  const records = joinPlatforms({
    locations: parseFixedWidth(locations, PLATFORM_LOCATION_LAYOUT),
    structures: parseFixedWidth(structures, PLATFORM_STRUCTURE_LAYOUT),
    masters: parseFixedWidth(masters, PLATFORM_MASTER_LAYOUT),
    companies: parseCompanies(companies),
  }).sort((a, b) => a.lat - b.lat || a.lon - b.lon);
  if (records.length < 500)
    throw new Error(`only ${records.length} standing structures joined`);

  const retrievedAt = new Date().toISOString().slice(0, 10);
  await mkdir(new URL('.', OUTPUT), { recursive: true });
  await writeFile(
    OUTPUT,
    `${JSON.stringify({
      source: 'BSEE Data Center platform and company files',
      license: 'Public Domain',
      retrievedAt,
      fields: PLATFORM_FIELDS,
      rows: toPlatformRows(records),
    })}\n`,
  );

  const byType = {};
  for (const record of records)
    byType[record.type ?? '?'] = (byType[record.type ?? '?'] ?? 0) + 1;
  const withOperator = records.filter((record) => record.operator).length;
  console.log(
    `offshore_platforms/offshore-platforms.json: ${records.length} structures, ${withOperator} with operators`,
  );
  console.log(byType);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
