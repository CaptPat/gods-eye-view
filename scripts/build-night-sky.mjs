#!/usr/bin/env node
// Rebuild the bundled Night Sky data from d3-celestial (BSD-3-Clause, Olaf Frohn).
//
//   node scripts/build-night-sky.mjs
//
// Writes compact JSON under src/data/local_data/night_sky/:
//   stars.json          [raDeg, decDeg, mag, bv] for stars to magnitude 4.5
//   star-names.json     [raDeg, decDeg, mag, name] for named stars to magnitude 2.5
//   constellations.json { lines: [[[ra, dec], ...], ...], labels: [[name, ra, dec], ...] }
//   messier.json        [id, name, type, mag, raDeg, decDeg] for the 110 Messier objects
import { writeFile } from 'node:fs/promises';

const BASE =
  'https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data';
const OUTPUT = new URL('../src/data/local_data/night_sky/', import.meta.url);
export const STAR_MAG_LIMIT = 4.5;
export const NAMED_STAR_MAG_LIMIT = 2.5;

/** d3-celestial stores RA as longitude −180…180 (12h–24h negative); back to 0…360. */
export const raFromLongitude = (lon) => (lon < 0 ? lon + 360 : lon);
const round = (value, places) => Number(value.toFixed(places));

async function read(name) {
  const response = await fetch(`${BASE}/${name}`);
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  return response.json();
}

async function main() {
  const [stars, names, constellations, lines, messier] = await Promise.all([
    read('stars.6.json'),
    read('starnames.json'),
    read('constellations.json'),
    read('constellations.lines.json'),
    read('messier.json'),
  ]);
  const point = ([lon, lat]) => [round(raFromLongitude(lon), 3), round(lat, 3)];
  const bright = stars.features
    .filter((feature) => feature.properties.mag <= STAR_MAG_LIMIT)
    .sort((a, b) => a.properties.mag - b.properties.mag);
  const starRows = bright.map((feature) => [
    ...point(feature.geometry.coordinates),
    feature.properties.mag,
    Number.isFinite(Number(feature.properties.bv))
      ? Number(feature.properties.bv)
      : null,
  ]);
  const namedRows = bright
    .filter(
      (feature) =>
        feature.properties.mag <= NAMED_STAR_MAG_LIMIT &&
        names[feature.id]?.name,
    )
    .map((feature) => [
      ...point(feature.geometry.coordinates),
      feature.properties.mag,
      names[feature.id].name,
    ]);
  const constellationData = {
    lines: lines.features.flatMap((feature) =>
      feature.geometry.coordinates.map((line) => line.map(point)),
    ),
    labels: constellations.features.map((feature) => [
      feature.properties.name,
      ...point(feature.geometry.coordinates),
    ]),
  };
  const messierRows = messier.features.map((feature) => [
    feature.id,
    feature.properties.alt || '',
    feature.properties.type,
    feature.properties.mag,
    ...point(feature.geometry.coordinates),
  ]);
  const write = (name, value) =>
    writeFile(new URL(name, OUTPUT), `${JSON.stringify(value)}\n`);
  await Promise.all([
    write('stars.json', starRows),
    write('star-names.json', namedRows),
    write('constellations.json', constellationData),
    write('messier.json', messierRows),
  ]);
  console.log(
    `stars ${starRows.length}, named ${namedRows.length}, constellation lines ${constellationData.lines.length}, labels ${constellationData.labels.length}, messier ${messierRows.length}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
