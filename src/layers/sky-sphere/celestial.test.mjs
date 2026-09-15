import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bvToColor,
  raDecToUnit,
  starAlpha,
  starPixelSize,
} from './celestial.js';

const near = (actual, expected, tolerance = 1e-12) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`,
  );

test('right ascension and declination become a unit vector in the equatorial frame', () => {
  const vernal = raDecToUnit(0, 0);
  near(vernal.x, 1);
  near(vernal.y, 0);
  near(vernal.z, 0);
  const sixHours = raDecToUnit(90, 0);
  near(sixHours.x, 0);
  near(sixHours.y, 1);
  const pole = raDecToUnit(123, 90);
  near(pole.z, 1);
  near(Math.hypot(pole.x, pole.y), 0);
  const southWest = raDecToUnit(180, -45);
  near(southWest.x, -Math.SQRT1_2);
  near(southWest.z, -Math.SQRT1_2);
});

test('brighter stars draw larger and more opaque, within fixed bounds', () => {
  assert.equal(starPixelSize(4.5), 1.5);
  assert.equal(starPixelSize(2), 4);
  assert.equal(starPixelSize(-1.46), 7);
  assert.equal(starPixelSize(6), 1.5);
  assert.equal(starAlpha(4.5), 0.35);
  assert.equal(starAlpha(0), 0.94);
  assert.equal(starAlpha(-1), 1);
});

test('colour index picks the nearest spectral tint, white when unknown', () => {
  assert.equal(bvToColor(-0.5), '#9bb0ff');
  assert.equal(bvToColor(0.05), '#cad7ff');
  assert.equal(bvToColor(0.62), '#fff4e8');
  assert.equal(bvToColor(1.5), '#ffb56c');
  assert.equal(bvToColor(null), '#ffffff');
});
