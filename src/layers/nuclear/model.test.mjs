import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NUCLEAR_LAYERS,
  PLANT_STATUS_COLORS,
  accidentColor,
  accidentPixelSize,
  buildAccidentCard,
  buildPlantCard,
  buildWasteCard,
  parseNuclearSnapshot,
  plantPixelSize,
  plantStatus,
} from './model.js';

const BASE = {
  description: null,
  kinds: [],
  date: null,
  place: null,
  approximate: false,
  wikipedia: null,
  wikidata: 'https://www.wikidata.org/wiki/Q1',
};
const KORI = {
  ...BASE,
  id: 'Q486898',
  name: 'Kori Nuclear Power Plant',
  lat: 35.32022,
  lon: 129.29461,
  wikipedia: 'https://en.wikipedia.org/wiki/Kori_Nuclear_Power_Plant',
  statuses: ['in use'],
  capacityMw: 7489,
  operator: 'Korea Hydro & Nuclear Power',
  country: 'South Korea',
  startYear: 1978,
  endYear: null,
};

test('three layers share a Wikidata source with their own ids, names and icons', () => {
  assert.deepEqual(
    Object.values(NUCLEAR_LAYERS).map((meta) => [
      meta.id,
      meta.name,
      meta.icon,
      meta.source,
    ]),
    [
      ['nuclear-power-plants', 'Nuclear Power Plants', '☢️', 'Wikidata'],
      ['nuclear-waste-sites', 'Nuclear Waste Sites', '⚠️', 'Wikidata'],
      ['nuclear-accidents', 'Nuclear Accidents', '💥', 'Wikidata'],
    ],
  );
});

test('plant status prefers operation, then construction and plans; a retirement year means decommissioned', () => {
  const cases = [
    [{ statuses: ['in use'], endYear: null }, 'operating'],
    [{ statuses: ['decommissioned', 'in use'], endYear: 2000 }, 'operating'],
    [{ statuses: ['decommissioned'], endYear: 2000 }, 'decommissioned'],
    [
      { statuses: ['building or structure under construction'], endYear: null },
      'construction',
    ],
    [
      { statuses: ['proposed building or structure'], endYear: null },
      'planned',
    ],
    [{ statuses: ['cancelled'], endYear: null }, 'cancelled'],
    [{ statuses: [], endYear: 1990 }, 'decommissioned'],
    [{ statuses: [], endYear: null }, 'unknown'],
  ];
  for (const [record, status] of cases)
    assert.equal(plantStatus(record), status, JSON.stringify(record));
  assert.deepEqual(Object.keys(PLANT_STATUS_COLORS), [
    'operating',
    'construction',
    'planned',
    'decommissioned',
    'cancelled',
    'unknown',
  ]);
});

test('plant points grow two pixels per tenfold capacity from 100 MW, capped at 11', () => {
  assert.equal(plantPixelSize(null), 6);
  assert.equal(plantPixelSize(100), 6);
  assert.equal(plantPixelSize(1000), 8);
  assert.equal(plantPixelSize(10_000), 10);
  assert.equal(plantPixelSize(1_000_000), 11);
});

test('a plant card gives status, capacity, operator, service years and country', () => {
  assert.deepEqual(buildPlantCard(KORI), {
    title: 'Kori Nuclear Power Plant',
    details: [
      'Operating · 7,489 MW',
      'Korea Hydro & Nuclear Power',
      'Since 1978 · South Korea',
    ],
    url: 'https://en.wikipedia.org/wiki/Kori_Nuclear_Power_Plant',
    accessibilityLabel:
      'Open the Wikipedia article on Kori Nuclear Power Plant',
  });
  assert.deepEqual(
    buildPlantCard({
      ...KORI,
      name: 'Chernobyl Nuclear Power Plant',
      statuses: ['decommissioned'],
      capacityMw: 3515,
      operator: null,
      country: 'Ukraine',
      startYear: 1972,
      endYear: 2000,
    }).details,
    ['Decommissioned · 3,515 MW', 'In service 1972–2000 · Ukraine'],
  );
  const building = buildPlantCard({
    ...KORI,
    statuses: ['building or structure under construction'],
    capacityMw: null,
    operator: null,
    startYear: null,
    country: "People's Republic of China",
    wikipedia: null,
  });
  assert.deepEqual(building.details, [
    'Under construction',
    "People's Republic of China",
  ]);
  assert.equal(building.url, 'https://www.wikidata.org/wiki/Q1');
  assert.match(building.accessibilityLabel, /^Open the Wikidata entry on /);
});

test('a waste site card names its kind, place and description', () => {
  assert.deepEqual(
    buildWasteCard({
      ...BASE,
      name: 'Důl Bratrství',
      kinds: ['deep-geological'],
      place: 'Jáchymov',
      country: 'Czech Republic',
    }).details,
    ['Deep geological repository', 'Jáchymov · Czech Republic'],
  );
  assert.deepEqual(
    buildWasteCard({
      ...BASE,
      name: 'Lepse',
      kinds: ['repository'],
      approximate: true,
      place: 'Sayda Bay',
      country: 'Russia',
      description:
        'Russian (formerly Soviet) ship used as nuclear waste storage',
    }).details,
    [
      'Radioactive waste repository (approximate)',
      'Sayda Bay · Russia',
      'Russian (formerly Soviet) ship used as nuclear waste storage',
    ],
  );
});

test('an accident card leads with its INES rating and date, then deaths and description', () => {
  assert.deepEqual(
    buildAccidentCard({
      ...BASE,
      name: 'Chernobyl disaster',
      date: '1986-04-26',
      ines: 7,
      deaths: 4000,
      country: 'Soviet Union',
      description: '1986 nuclear accident in the Soviet Union',
    }).details,
    [
      'INES 7 · 26 Apr 1986',
      '4,000 deaths · Soviet Union',
      '1986 nuclear accident in the Soviet Union',
    ],
  );
  assert.deepEqual(
    buildAccidentCard({
      ...BASE,
      name: 'Goiânia accident',
      date: '1987-09-13',
      ines: null,
      deaths: 1,
      country: 'Brazil',
    }).details,
    ['Not rated · 13 Sep 1987', '1 death · Brazil'],
  );
});

test('accident colour and size climb with INES level; unrated accidents stay orange', () => {
  assert.equal(accidentColor(7), '#ff1f1f');
  assert.equal(accidentColor(5), '#ff8c1a');
  assert.equal(accidentColor(3), '#ffd166');
  assert.equal(accidentColor(null), '#ff9f43');
  assert.equal(accidentPixelSize(null), 7);
  assert.equal(accidentPixelSize(3), 7);
  assert.equal(accidentPixelSize(5), 10);
  assert.equal(accidentPixelSize(7), 13);
});

test('snapshots become styled catalog records for their layer; a broken snapshot is refused', () => {
  const plants = parseNuclearSnapshot(
    { records: [KORI, { id: 'bad' }] },
    'plants',
  );
  assert.equal(plants.stale, false);
  assert.equal(plants.records.length, 1);
  assert.equal(plants.records[0].color, PLANT_STATUS_COLORS.operating);
  assert.equal(plants.records[0].pixelSize, plantPixelSize(7489));
  const accidents = parseNuclearSnapshot(
    { records: [{ ...KORI, ines: 7 }] },
    'accidents',
  );
  assert.equal(accidents.records[0].color, '#ff1f1f');
  assert.equal(accidents.records[0].pixelSize, 13);
  const waste = parseNuclearSnapshot({ records: [KORI] }, 'waste');
  assert.equal(waste.records[0].color, '#c77dff');
  assert.equal(parseNuclearSnapshot({ records: 'x' }, 'plants'), null);
});
