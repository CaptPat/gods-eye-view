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
  mode: 'air-quality',
  pollenType: 'tree',
  opacity: 0.7,
  googleConfigured: true,
};

test('modes map to proxy keys, source names and zoom caps', () => {
  assert.deepEqual(MODES, ['air-quality', 'pollen']);
  assert.equal(overlayKey('pollen', 'grass'), 'pollen-grass');
  assert.equal(overlayKey('air-quality', 'grass'), 'air-quality');
  assert.equal(modeOfKey('pollen-weed'), 'pollen');
  assert.deepEqual(OVERLAY_KEYS.map(maximumLevelFor), [12, 10, 10, 10]);
  for (const moved of ['clouds', 'temperature']) {
    assert.equal(maximumLevelFor(moved), null, `${moved} moved upstream`);
  }
  assert.equal(maximumLevelFor('fog'), null);
  assert.equal(sourceName('pollen', 'weed'), 'Google Pollen · Weed');
  assert.equal(sourceName('air-quality', 'weed'), 'Google Air Quality');
  assert.equal(normalizeMode('air-quality'), 'air-quality');
  assert.equal(normalizeMode('fog'), null);
  assert.equal(normalizeMode('clouds'), null);
  assert.equal(normalizeMode('temperature'), null);
  assert.equal(normalizePollenType('grass'), 'grass');
  assert.equal(normalizePollenType('pine'), null);
});

test('chips: two modes, pollen types only in pollen mode, then three opacities', () => {
  const air = buildRowControls(base).chips;
  assert.deepEqual(
    air.map((chip) => chip.id),
    [
      'mode-air-quality',
      'mode-pollen',
      'opacity-40',
      'opacity-70',
      'opacity-100',
    ],
  );
  assert.deepEqual(air[0], {
    id: 'mode-air-quality',
    label: 'Air',
    title: 'Air quality (US AQI)',
    active: true,
    disabled: false,
    params: { mode: 'air-quality' },
  });
  assert.deepEqual(
    air.slice(2).map((chip) => [chip.label, chip.active, chip.params.opacity]),
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
      .slice(2, 5)
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
    keyless.find((chip) => chip.id === 'opacity-40').disabled,
    false,
  );
});

test('legends carry text for every entry and the measured colours', () => {
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
