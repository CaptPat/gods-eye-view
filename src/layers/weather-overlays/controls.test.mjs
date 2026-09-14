import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MODES,
  OVERLAY_KEYS,
  maximumLevelFor,
  modeOfKey,
  normalizeMode,
  normalizePollenType,
  overlayKey,
  sourceName,
} from './modes.js';
import { buildLegend, buildRowControls } from './controls.js';

const base = {
  mode: 'clouds',
  pollenType: 'tree',
  opacity: 0.7,
  googleConfigured: true,
};

test('modes map to proxy keys, source names and zoom caps', () => {
  assert.deepEqual(MODES, ['clouds', 'temperature', 'air-quality', 'pollen']);
  assert.equal(overlayKey('pollen', 'grass'), 'pollen-grass');
  assert.equal(overlayKey('temperature', 'grass'), 'temperature');
  assert.equal(modeOfKey('pollen-weed'), 'pollen');
  assert.deepEqual(OVERLAY_KEYS.map(maximumLevelFor), [7, 6, 12, 10, 10, 10]);
  assert.equal(maximumLevelFor('fog'), null);
  assert.equal(sourceName('pollen', 'weed'), 'Google Pollen · Weed');
  assert.equal(sourceName('clouds', 'weed'), 'NOAA GMGSI satellite');
  assert.equal(normalizeMode('air-quality'), 'air-quality');
  assert.equal(normalizeMode('fog'), null);
  assert.equal(normalizePollenType('grass'), 'grass');
  assert.equal(normalizePollenType('pine'), null);
});

test('chips: four modes, pollen types only in pollen mode, then three opacities', () => {
  const clouds = buildRowControls(base).chips;
  assert.deepEqual(
    clouds.map((chip) => chip.id),
    [
      'mode-clouds',
      'mode-temperature',
      'mode-air-quality',
      'mode-pollen',
      'opacity-40',
      'opacity-70',
      'opacity-100',
    ],
  );
  assert.deepEqual(clouds[0], {
    id: 'mode-clouds',
    label: 'Clouds',
    title: 'Cloud cover from geostationary satellites',
    active: true,
    disabled: false,
    params: { mode: 'clouds' },
  });
  assert.deepEqual(
    clouds
      .slice(4)
      .map((chip) => [chip.label, chip.active, chip.params.opacity]),
    [
      ['40%', false, 0.4],
      ['70%', true, 0.7],
      ['100%', false, 1],
    ],
  );

  const pollen = buildRowControls({
    ...base,
    mode: 'pollen',
    pollenType: 'grass',
  }).chips;
  assert.deepEqual(
    pollen
      .slice(4, 7)
      .map((chip) => [chip.id, chip.label, chip.active, chip.params]),
    [
      ['pollen-tree', 'Tree', false, { pollenType: 'tree' }],
      ['pollen-grass', 'Grass', true, { pollenType: 'grass' }],
      ['pollen-weed', 'Weed', false, { pollenType: 'weed' }],
    ],
  );
  assert.equal(pollen.find((chip) => chip.id === 'mode-pollen').active, true);
});

test('Google modes are disabled with a reason only once the server reports no key', () => {
  const unknown = buildRowControls({ ...base, googleConfigured: null }).chips;
  assert.equal(
    unknown.find((chip) => chip.id === 'mode-air-quality').disabled,
    false,
  );

  const keyless = buildRowControls({
    ...base,
    mode: 'pollen',
    googleConfigured: false,
  }).chips;
  for (const id of ['mode-air-quality', 'mode-pollen', 'pollen-tree']) {
    assert.equal(keyless.find((chip) => chip.id === id).disabled, true, id);
  }
  assert.equal(
    keyless.find((chip) => chip.id === 'mode-air-quality').title,
    'Air quality (US AQI): needs a Google Maps API key',
  );
  assert.equal(
    keyless.find((chip) => chip.id === 'mode-clouds').disabled,
    false,
  );
  assert.equal(
    keyless.find((chip) => chip.id === 'opacity-40').disabled,
    false,
  );
});

test('legends carry text for every entry and the measured colours', () => {
  assert.deepEqual(
    buildLegend('clouds').map((item) => [item.label, item.count, item.color]),
    [
      ['Low', 'warm tops', '#8c8c8c'],
      ['Mid', 'cool tops', '#c8c8c8'],
      ['High', 'cold tops', '#ffffff'],
    ],
  );
  assert.deepEqual(
    buildLegend('temperature').map((item) => `${item.label} ${item.count}`),
    [
      '-30°C -22°F',
      '-15°C 5°F',
      '0°C 32°F',
      '10°C 50°F',
      '20°C 68°F',
      '30°C 86°F',
      '40°C 104°F',
    ],
  );
  assert.deepEqual(
    buildLegend('air-quality').map((item) => item.color),
    ['#00e400', '#ffff00', '#ff7e00', '#ff0000', '#8f3f97', '#7e0023'],
  );
  assert.deepEqual(
    buildLegend('pollen').map((item) => [item.count, item.color]),
    [
      ['UPI 1', '#009e3a'],
      ['UPI 2', '#84cf33'],
      ['UPI 3', '#ffff00'],
      ['UPI 4', '#ff8c00'],
      ['UPI 5', '#ff0000'],
    ],
  );
  for (const mode of MODES) {
    for (const item of buildLegend(mode)) {
      assert.equal(typeof item.count, 'string', `${mode} ${item.label}`);
      assert.ok(item.blurb.length > 0);
    }
  }
});
