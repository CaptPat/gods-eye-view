import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PIPELINE_FIELDS,
  PIPELINE_KINDS,
  US_PIPELINES_META,
  buildPipelineCard,
  ocsProduct,
  parsePipelineSnapshot,
  toPipelineRows,
} from './model.js';

const INTERSTATE = {
  id: 'gas/7',
  kind: 'gas-interstate',
  name: null,
  operator: 'Transcontinental Gas PL',
  route: null,
  product: null,
  sizeIn: null,
  status: null,
  positions: [-97.123, 30.988, -96.5, 31],
};
const LAKEHEAD = {
  ...INTERSTATE,
  id: 'crude/3',
  kind: 'crude',
  name: 'Lakehead',
  operator: 'ENBRIDGE',
};
const OFFSHORE = {
  id: 'ocs/6',
  kind: 'ocs-oil',
  name: null,
  operator: 'Harvest Oil & Gas',
  route: 'SS 219 A Platform → SS 208 F-Pump Platform',
  product: 'OIL',
  sizeIn: 8,
  status: 'ACT',
  positions: [-90.5, 28.5, -90.4, 28.6],
};

test('the layer describes EIA and BSEE pipelines with six styled kinds', () => {
  assert.deepEqual(
    [
      US_PIPELINES_META.id,
      US_PIPELINES_META.name,
      US_PIPELINES_META.source,
      US_PIPELINES_META.selectedSourceId,
    ],
    ['us-pipelines', 'US Pipelines', 'EIA · BSEE', 'us-pipelines-selected'],
  );
  assert.deepEqual(PIPELINE_FIELDS, [
    'id',
    'kind',
    'name',
    'operator',
    'route',
    'product',
    'sizeIn',
    'status',
    'positions',
  ]);
  assert.deepEqual(PIPELINE_KINDS, {
    'gas-interstate': {
      label: 'Interstate natural gas pipeline',
      color: '#ffb703',
      width: 2,
    },
    'gas-intrastate': {
      label: 'Intrastate natural gas pipeline',
      color: '#ffd166',
      width: 1.5,
    },
    crude: { label: 'Crude oil trunk pipeline', color: '#8338ec', width: 3 },
    hgl: {
      label: 'Hydrocarbon gas liquids pipeline',
      color: '#06d6a0',
      width: 2.5,
    },
    'ocs-oil': { label: 'Offshore oil pipeline', color: '#b388ff', width: 1.5 },
    'ocs-gas': { label: 'Offshore gas pipeline', color: '#ffe066', width: 1.5 },
  });
});

test('offshore product codes classify as oil or gas; utility lines, cables and umbilicals are excluded', () => {
  assert.deepEqual(ocsProduct('BLKO'), {
    kind: 'oil',
    label: 'Bulk oil (full well stream)',
  });
  assert.deepEqual(ocsProduct('G/O'), { kind: 'oil', label: 'Gas and oil' });
  assert.deepEqual(ocsProduct('COND'), { kind: 'oil', label: 'Condensate' });
  assert.deepEqual(ocsProduct('G/CH'), {
    kind: 'gas',
    label: 'Gas and condensate (H2S)',
  });
  assert.deepEqual(ocsProduct('LIFT'), { kind: 'gas', label: 'Gas lift' });
  assert.deepEqual(ocsProduct('NGL'), {
    kind: 'gas',
    label: 'Natural gas liquids',
  });
  for (const code of [
    'H2O',
    'UMB',
    'UBEH',
    'CBLP',
    'SERV',
    'CSNG',
    'TOW',
    'CHEM',
    'XYZ',
    '',
    null,
  ])
    assert.equal(ocsProduct(code), null, String(code));
});

test('cards name the pipeline, operator or segment, with kind, product, size, route and service state', () => {
  assert.deepEqual(buildPipelineCard(INTERSTATE), {
    title: 'Transcontinental Gas PL',
    details: ['Interstate natural gas pipeline'],
    url: null,
    accessibilityLabel: 'Transcontinental Gas PL pipeline',
  });
  assert.deepEqual(buildPipelineCard(LAKEHEAD), {
    title: 'Lakehead',
    details: ['Crude oil trunk pipeline', 'ENBRIDGE'],
    url: null,
    accessibilityLabel: 'Lakehead pipeline',
  });
  assert.deepEqual(buildPipelineCard(OFFSHORE), {
    title: 'Offshore segment 6',
    details: [
      'Oil, after first processing · 8-inch',
      'SS 219 A Platform → SS 208 F-Pump Platform',
      'Harvest Oil & Gas',
    ],
    url: null,
    accessibilityLabel: 'Offshore segment 6 pipeline',
  });
  assert.deepEqual(
    buildPipelineCard({ ...OFFSHORE, status: 'OUT', sizeIn: null }).details[0],
    'Oil, after first processing · Out of service',
  );
  assert.equal(
    buildPipelineCard({ ...INTERSTATE, operator: null }).title,
    'Interstate natural gas pipeline',
  );
});

test('snapshots round-trip through compact rows and pick up kind styles; bad rows and shapes are rejected', () => {
  const rows = toPipelineRows([INTERSTATE, OFFSHORE]);
  assert.deepEqual(
    rows[1],
    PIPELINE_FIELDS.map((field) => OFFSHORE[field]),
  );
  const parsed = parsePipelineSnapshot({
    fields: PIPELINE_FIELDS,
    rows: [
      ...rows,
      'garbage',
      PIPELINE_FIELDS.map((field) => ({ ...INTERSTATE, kind: 'lava' })[field]),
      PIPELINE_FIELDS.map(
        (field) => ({ ...INTERSTATE, positions: [1, 2, 3] })[field],
      ),
    ],
  });
  assert.equal(parsed.stale, false);
  assert.deepEqual(parsed.records, [
    { ...INTERSTATE, color: '#ffb703', width: 2 },
    { ...OFFSHORE, color: '#b388ff', width: 1.5 },
  ]);
  assert.equal(parsePipelineSnapshot({ fields: ['id'], rows }), null);
  assert.equal(parsePipelineSnapshot(undefined), null);
});
