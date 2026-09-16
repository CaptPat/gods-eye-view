import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEPTH_BANDS,
  DEPTH_BANDS_TILE_TEMPLATE,
  DEPTH_RENDERING_RULE_JSON,
  MARINE_DEPTHS_META,
  NCEI_DEM_EXPORT_URL,
  NOAA_CHART_DEPTH_LAYER,
  depthRenderingRule,
} from './model.js';

test('meta names the layer and its source', () => {
  assert.deepEqual(MARINE_DEPTHS_META, {
    id: 'marine-depths',
    name: 'Marine Depths',
    icon: '🌊',
    source: 'NOAA',
  });
});

test('depth bands are contiguous, below sea level and shallowest last', () => {
  assert.equal(DEPTH_BANDS[0].fromM, -12000);
  assert.equal(DEPTH_BANDS.at(-1).toM, 0);
  for (let i = 1; i < DEPTH_BANDS.length; i++)
    assert.equal(DEPTH_BANDS[i].fromM, DEPTH_BANDS[i - 1].toM);
  for (const { rgb } of DEPTH_BANDS) {
    assert.equal(rgb.length, 3);
    assert.ok(rgb.every((v) => Number.isInteger(v) && v >= 0 && v <= 255));
  }
});

test('the rendering rule remaps bands to classes and leaves land unmatched', () => {
  const rule = depthRenderingRule();
  assert.equal(rule.rasterFunction, 'Colormap');
  assert.equal(rule.outputPixelType, 'U8');
  const remap = rule.rasterFunctionArguments.Raster;
  assert.equal(remap.rasterFunction, 'Remap');
  assert.equal(
    remap.rasterFunctionArguments.AllowUnmatched,
    false,
    'elevations above 0 m must become NoData (transparent)',
  );
  assert.deepEqual(
    remap.rasterFunctionArguments.InputRanges.slice(0, 4),
    [-12000, -6000, -6000, -4000],
  );
  assert.deepEqual(
    remap.rasterFunctionArguments.OutputValues,
    DEPTH_BANDS.map((_, i) => i + 1),
  );
  assert.deepEqual(rule.rasterFunctionArguments.Colormap[0], [1, 8, 20, 62]);
  assert.deepEqual(JSON.parse(DEPTH_RENDERING_RULE_JSON), rule);
});

test('the tile template carries only Cesium tags, never raw JSON', () => {
  assert.ok(DEPTH_BANDS_TILE_TEMPLATE.startsWith(`${NCEI_DEM_EXPORT_URL}?`));
  const tags = [...DEPTH_BANDS_TILE_TEMPLATE.matchAll(/\{([^}]*)\}/g)].map(
    (m) => m[1],
  );
  assert.deepEqual(tags, [
    'westProjected',
    'southProjected',
    'eastProjected',
    'northProjected',
    'width',
    'height',
    'renderingRule',
  ]);
  const query = new URLSearchParams(DEPTH_BANDS_TILE_TEMPLATE.split('?')[1]);
  assert.equal(query.get('bboxSR'), '3857');
  assert.equal(query.get('imageSR'), '3857');
  assert.equal(query.get('format'), 'png32');
  assert.equal(query.get('f'), 'image');
});

test('chart depths use only the "Depths, currents, etc" sublayer', () => {
  assert.equal(NOAA_CHART_DEPTH_LAYER, '2');
});
