import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OIL_GAS_META,
  OIL_GAS_QUERY,
  buildOilGasCard,
  classifyOilGasLine,
  classifyOilGasPoint,
  pipelineSubstance,
} from './model.js';

test('the layer meta and query describe non-water pipelines, wells, platforms and refineries', () => {
  assert.deepEqual(
    [
      OIL_GAS_META.id,
      OIL_GAS_META.name,
      OIL_GAS_META.icon,
      OIL_GAS_META.source,
    ],
    ['oil-gas', 'Oil & Gas', '🛢️', 'OpenStreetMap'],
  );
  assert.equal(
    OIL_GAS_META.zoomMessage,
    'Zoom in to load oil and gas infrastructure',
  );
  assert.deepEqual(OIL_GAS_QUERY, {
    selectors: [
      'way["man_made"="pipeline"]["substance"!~"water|sewage|sewer|steam|heat"]',
      'node["man_made"="petroleum_well"]',
      'nwr["man_made"="offshore_platform"]',
      'nwr["industrial"~"^(refinery|oil|gas)$"]',
    ],
    cap: 3000,
    maxViewDegrees: 1,
  });
});

test('pipeline substance reads refined fuels as oil before matching gas', () => {
  const cases = [
    [{ substance: 'gas' }, 'gas'],
    [{ substance: 'natural_gas' }, 'gas'],
    [{ substance: 'ngl' }, 'gas'],
    [{ substance: 'y-grade' }, 'gas'],
    [{ substance: 'gasoline' }, 'oil'],
    [{ substance: 'crude_oil' }, 'oil'],
    [{ type: 'petroleum' }, 'oil'],
    [{ substance: 'water' }, null],
    [{ substance: 'rainwater' }, null],
    [{ substance: 'waterwaste' }, null],
    [{ substance: 'sewer' }, null],
    [{ substance: 'ammonia' }, 'other'],
    [{ substance: 'propylene' }, 'other'],
    [{}, 'unknown'],
  ];
  for (const [tags, substance] of cases)
    assert.equal(pipelineSubstance(tags), substance, JSON.stringify(tags));
});

test('pipelines colour by substance; wells, platforms and refineries are points', () => {
  assert.deepEqual(
    classifyOilGasLine({ man_made: 'pipeline', substance: 'gas' }),
    {
      kind: 'pipeline',
      substance: 'gas',
      color: '#ffb703',
      width: 2,
    },
  );
  assert.deepEqual(
    classifyOilGasLine({ man_made: 'pipeline', substance: 'oil' }).color,
    '#8338ec',
  );
  assert.deepEqual(classifyOilGasLine({ man_made: 'pipeline' }), {
    kind: 'pipeline',
    substance: 'unknown',
    color: '#adb5bd',
    width: 1.5,
  });
  assert.equal(
    classifyOilGasLine({ man_made: 'pipeline', substance: 'sewage' }),
    null,
  );
  assert.equal(classifyOilGasLine({ highway: 'primary' }), null);
  assert.deepEqual(classifyOilGasPoint({ man_made: 'petroleum_well' }), {
    kind: 'well',
    color: '#9d4edd',
    pixelSize: 4,
  });
  assert.deepEqual(classifyOilGasPoint({ man_made: 'offshore_platform' }), {
    kind: 'platform',
    color: '#00b4d8',
    pixelSize: 8,
  });
  assert.deepEqual(classifyOilGasPoint({ industrial: 'refinery' }), {
    kind: 'refinery',
    color: '#f77f00',
    pixelSize: 9,
  });
  assert.equal(classifyOilGasPoint({ man_made: 'tower' }), null);
});

test('cards name the feature with substance, location, diameter and operator, linking to OpenStreetMap', () => {
  assert.deepEqual(
    buildOilGasCard({
      id: 'way/10',
      kind: 'pipeline',
      substance: 'gas',
      tags: {
        man_made: 'pipeline',
        substance: 'gas',
        location: 'underground',
        diameter: '914',
        operator: 'Kinder Morgan',
        name: 'Permian Highway',
      },
    }),
    {
      title: 'Permian Highway',
      details: ['Natural gas · underground · 914 mm', 'Kinder Morgan'],
      url: 'https://www.openstreetmap.org/way/10',
      accessibilityLabel: 'Open Permian Highway on OpenStreetMap',
    },
  );
  assert.equal(
    buildOilGasCard({
      id: 'way/11',
      kind: 'pipeline',
      substance: 'unknown',
      tags: { man_made: 'pipeline' },
    }).title,
    'Pipeline',
  );
  assert.deepEqual(
    buildOilGasCard({
      id: 'node/12',
      kind: 'well',
      tags: { man_made: 'petroleum_well', operator: 'Chevron' },
    }),
    {
      title: 'Petroleum well',
      details: ['Chevron'],
      url: 'https://www.openstreetmap.org/node/12',
      accessibilityLabel: 'Open Petroleum well on OpenStreetMap',
    },
  );
  assert.deepEqual(
    buildOilGasCard({
      id: 'way/13',
      kind: 'platform',
      tags: { name: 'Mars', operator: 'Shell' },
    }).details,
    ['Offshore platform', 'Shell'],
  );
  assert.deepEqual(
    buildOilGasCard({
      id: 'way/14',
      kind: 'refinery',
      tags: { industrial: 'refinery' },
    }),
    {
      title: 'Refinery',
      details: ['Refinery'],
      url: 'https://www.openstreetmap.org/way/14',
      accessibilityLabel: 'Open Refinery on OpenStreetMap',
    },
  );
});
