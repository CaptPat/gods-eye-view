import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeEiaGas,
  normalizeEiaLiquids,
  normalizeOcsPipelines,
  parsePipelineMasters,
} from './sources.js';

// Verbatim rows from the BSEE Pipeline Masters delimited file (September 2026).
const ABANDONED_ROW =
  '"       2","   12500","A","SM","   33"," 00780","B","SM","   33"," 00780","19880701","19890201","19700519","I","","Y","   0","","","","20220129","19700827","   12500","ABN","06","","     0","","","BLKO","","","00114","     0","    10","","  1440","","N","","L","INPLACE"';
const ACTIVE_ROW =
  '"       6","   65848","A Platform","SS","  219"," 00829","F-Pump Platform","SS","  208","G01228","","","19701202","I","","Y","   0","","","","20260225","19710804","   65848","ACT","08","G13496","     0","","","OIL","","03209","03209","   103","   113","","  1440","","N","","R",""';

const EMPTY = {
  name: null,
  operator: null,
  route: null,
  product: null,
  sizeIn: null,
  status: null,
};

test('EIA gas pipelines split by jurisdiction, with rounded positions and one record per usable part', () => {
  const geojson = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [-97.12345, 30.98765],
            [-96.5, 31],
          ],
        },
        properties: {
          FID: 7,
          TYPEPIPE: 'Interstate',
          Operator: 'Transcontinental Gas PL',
          Status: 'Operating',
        },
      },
      {
        type: 'Feature',
        geometry: {
          type: 'MultiLineString',
          coordinates: [
            [
              [-100, 40],
              [-99, 41],
            ],
            [[-98, 42]],
          ],
        },
        properties: { FID: 8, TYPEPIPE: 'Intrastate', Operator: 'Enbridge' },
      },
      {
        type: 'Feature',
        geometry: {
          type: 'MultiLineString',
          coordinates: [
            [
              [-90, 30],
              [-89, 30],
            ],
            [
              [-88, 30],
              [-87, 30],
            ],
          ],
        },
        properties: { FID: 10, TYPEPIPE: 'Interstate', Operator: 'Gulf South' },
      },
      { type: 'Feature', geometry: null, properties: { FID: 9 } },
    ],
  };
  assert.deepEqual(normalizeEiaGas(geojson), [
    {
      ...EMPTY,
      id: 'gas/7',
      kind: 'gas-interstate',
      operator: 'Transcontinental Gas PL',
      positions: [-97.123, 30.988, -96.5, 31],
    },
    {
      ...EMPTY,
      id: 'gas/8',
      kind: 'gas-intrastate',
      operator: 'Enbridge',
      positions: [-100, 40, -99, 41],
    },
    {
      ...EMPTY,
      id: 'gas/10-0',
      kind: 'gas-interstate',
      operator: 'Gulf South',
      positions: [-90, 30, -89, 30],
    },
    {
      ...EMPTY,
      id: 'gas/10-1',
      kind: 'gas-interstate',
      operator: 'Gulf South',
      positions: [-88, 30, -87, 30],
    },
  ]);
  assert.deepEqual(normalizeEiaGas(null), []);
});

test('EIA crude and HGL trunk lines keep their pipeline and operator names', () => {
  const geojson = {
    features: [
      {
        geometry: {
          type: 'LineString',
          coordinates: [
            [-92, 47],
            [-88, 43],
          ],
        },
        properties: { FID: 3, Opername: 'ENBRIDGE', Pipename: 'Lakehead' },
      },
    ],
  };
  assert.deepEqual(normalizeEiaLiquids(geojson, 'crude'), [
    {
      ...EMPTY,
      id: 'crude/3',
      kind: 'crude',
      name: 'Lakehead',
      operator: 'ENBRIDGE',
      positions: [-92, 47, -88, 43],
    },
  ]);
  assert.equal(normalizeEiaLiquids(geojson, 'hgl')[0].id, 'hgl/3');
});

test('pipeline masters give each segment its status, size, product, operator and route', () => {
  const masters = parsePipelineMasters(`${ABANDONED_ROW}\r\n${ACTIVE_ROW}\r\n`);
  assert.equal(masters.size, 2);
  assert.deepEqual(masters.get(6), {
    status: 'ACT',
    sizeIn: 8,
    product: 'OIL',
    operatorNumber: '03209',
    route: 'SS 219 A Platform → SS 208 F-Pump Platform',
  });
  assert.equal(masters.get(2).status, 'ABN');
});

test('offshore segments keep active or out-of-service oil and gas lines joined to their masters', () => {
  const masters = parsePipelineMasters(`${ABANDONED_ROW}\n${ACTIVE_ROW}`);
  masters.set(20, { ...masters.get(6), status: 'OUT', product: 'LIFT' });
  masters.set(21, { ...masters.get(6), product: 'UMB' });
  const segment = (number, coordinates) => ({
    geometry: { type: 'LineString', coordinates },
    properties: { SEGMENT_NUM: number },
  });
  const line = [
    [-90.5, 28.5],
    [-90.4, 28.6],
  ];
  const records = normalizeOcsPipelines(
    {
      features: [
        segment(6, line),
        segment(2, line),
        segment(20, line),
        segment(21, line),
        segment(99, line),
      ],
    },
    masters,
    new Map([['03209', 'Harvest Oil & Gas']]),
  );
  assert.deepEqual(records, [
    {
      id: 'ocs/6',
      kind: 'ocs-oil',
      name: null,
      operator: 'Harvest Oil & Gas',
      route: 'SS 219 A Platform → SS 208 F-Pump Platform',
      product: 'OIL',
      sizeIn: 8,
      status: 'ACT',
      positions: [-90.5, 28.5, -90.4, 28.6],
    },
    {
      id: 'ocs/20',
      kind: 'ocs-gas',
      name: null,
      operator: 'Harvest Oil & Gas',
      route: 'SS 219 A Platform → SS 208 F-Pump Platform',
      product: 'LIFT',
      sizeIn: 8,
      status: 'OUT',
      positions: [-90.5, 28.5, -90.4, 28.6],
    },
  ]);
});
