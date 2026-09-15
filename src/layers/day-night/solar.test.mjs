import test from 'node:test';
import assert from 'node:assert/strict';
import {
  moonIllumination,
  nightBands,
  solarAltitudeDeg,
  subpointFromVector,
  twilightLevel,
} from './solar.js';

const near = (actual, expected, tolerance = 1e-9) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`,
  );

test('the sun is 90° up at its subpoint, −90° at the antipode and on the horizon 90° away', () => {
  const subsolar = { lat: 0, lon: 0 };
  near(solarAltitudeDeg(0, 0, subsolar), 90);
  near(solarAltitudeDeg(0, 180, subsolar), -90);
  near(solarAltitudeDeg(0, 90, subsolar), 0);
  near(solarAltitudeDeg(90, 0, { lat: 23.44, lon: 54 }), 23.44);
});

test('solar altitude maps to civil, nautical, astronomical twilight and night', () => {
  const cases = [
    [1, null],
    [0, null],
    [-0.1, 0],
    [-6, 0],
    [-6.1, 1],
    [-12, 1],
    [-12.5, 2],
    [-18, 2],
    [-18.1, 3],
    [-90, 3],
  ];
  for (const [altitude, level] of cases)
    assert.equal(twilightLevel(altitude), level, `altitude ${altitude}`);
});

test('an equinox sun at 0°,0° shades the equator row with twilight steps either side of night', () => {
  const bands = nightBands({ lat: 0, lon: 0 }, { cellDeg: 10 });
  const equatorRow = bands
    .filter((band) => band.south === 0 && band.north === 10)
    .map(({ level, west, east }) => [level, west, east]);
  assert.deepEqual(equatorRow, [
    [3, -180, -110],
    [2, -110, -100],
    [0, -100, -90],
    [0, 90, 100],
    [2, 100, 110],
    [3, 110, 180],
  ]);
  assert.ok(bands.every((band) => band.level >= 0 && band.level <= 3));
});

test('a subpoint comes from an Earth-fixed direction vector', () => {
  const pole = subpointFromVector({ x: 0, y: 0, z: 5 });
  near(pole.lat, 90);
  const west = subpointFromVector({ x: 0, y: -2, z: 0 });
  near(west.lat, 0);
  near(west.lon, -90);
});

test('moon illumination follows the sun–moon angle; the moon waxes while east of the sun', () => {
  const sun = { x: 1, y: 0, z: 0 };
  const quarter = moonIllumination(sun, { x: 0, y: 1, z: 0 });
  near(quarter.fraction, 0.5);
  assert.equal(quarter.waxing, true);
  const lastQuarter = moonIllumination(sun, { x: 0, y: -1, z: 0 });
  near(lastQuarter.fraction, 0.5);
  assert.equal(lastQuarter.waxing, false);
  near(moonIllumination(sun, { x: 3, y: 0, z: 0 }).fraction, 0);
  near(moonIllumination(sun, { x: -3, y: 0, z: 0.0001 }).fraction, 1, 1e-6);
});
