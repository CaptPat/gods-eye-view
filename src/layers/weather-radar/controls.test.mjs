import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RADAR_OPACITIES,
  buildRowControls,
  normalizeOpacity,
} from './controls.js';

test('opacity snaps only to the three offered steps', () => {
  assert.deepEqual(RADAR_OPACITIES, [0.4, 0.7, 1]);
  assert.equal(normalizeOpacity(0.4), 0.4);
  assert.equal(normalizeOpacity('0.7'), 0.7);
  assert.equal(normalizeOpacity(1.0004), 1);
  assert.equal(normalizeOpacity(0.5), null);
  assert.equal(normalizeOpacity('x'), null);
});

test('chips reflect loop, US detail and opacity state, and carry the params that toggle them', () => {
  const { chips } = buildRowControls({
    playing: false,
    usDetail: false,
    opacity: 0.7,
    loopAvailable: true,
  });
  assert.deepEqual(
    chips.map((chip) => chip.id),
    ['loop', 'us-detail', 'opacity-40', 'opacity-70', 'opacity-100'],
  );
  assert.deepEqual(chips[0], {
    id: 'loop',
    label: '▶ Loop',
    title: 'Loop the last two hours',
    active: false,
    disabled: false,
    params: { loop: true },
  });
  assert.deepEqual(chips[1], {
    id: 'us-detail',
    label: 'US detail',
    title: 'Iowa State NEXRAD over the contiguous US',
    active: false,
    disabled: false,
    params: { usDetail: true },
  });
  assert.deepEqual(
    chips
      .slice(2)
      .map((chip) => [chip.label, chip.active, chip.params.opacity]),
    [
      ['40%', false, 0.4],
      ['70%', true, 0.7],
      ['100%', false, 1],
    ],
  );

  const playing = buildRowControls({
    playing: true,
    usDetail: true,
    opacity: 1,
    loopAvailable: true,
  }).chips;
  assert.equal(playing[0].label, '❚❚ Pause');
  assert.equal(playing[0].title, 'Pause the loop');
  assert.deepEqual(playing[0].params, { loop: false });
  assert.deepEqual(playing[1].params, { usDetail: false });
  assert.equal(playing[1].active, true);

  const noFrames = buildRowControls({
    playing: false,
    usDetail: false,
    opacity: 0.7,
    loopAvailable: false,
  }).chips;
  assert.equal(noFrames[0].disabled, true);
});

test('the legend follows the active source and never renders an undefined count', () => {
  const rainviewer = buildRowControls({
    playing: false,
    usDetail: false,
    opacity: 0.7,
    loopAvailable: true,
  }).legend;
  assert.deepEqual(
    rainviewer.map((item) => [item.label, item.count, item.color]),
    [
      ['Light', '20 dBZ', '#00a3e0'],
      ['Moderate', '30 dBZ', '#005588'],
      ['Heavy', '50 dBZ', '#c10000'],
      ['Extreme', '65 dBZ', '#ffffff'],
    ],
  );
  const iem = buildRowControls({
    playing: false,
    usDetail: true,
    opacity: 0.7,
    loopAvailable: true,
  }).legend;
  assert.deepEqual(
    iem.map((item) => item.color),
    ['#00ff00', '#087305', '#ff0000', '#fe00fe'],
  );
  for (const item of [...rainviewer, ...iem]) {
    assert.equal(typeof item.count, 'string');
    assert.match(item.blurb, /dBZ/);
  }
});
