import test from 'node:test';
import assert from 'node:assert/strict';
import * as Astronomy from 'astronomy-engine';
import { loadAstronomy, planetDirections } from './planets.js';

const degreesBetween = (a, b) =>
  (Math.acos(Math.min(1, Math.max(-1, a.x * b.x + a.y * b.y + a.z * b.z))) *
    180) /
  Math.PI;

function sunDirection(date) {
  const v = Astronomy.GeoVector(Astronomy.Body.Sun, date, true);
  const length = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

test('planet directions are unit vectors in planet order, with their colours', () => {
  const directions = planetDirections(
    Astronomy,
    new Date(Date.UTC(2026, 8, 15)),
  );
  assert.deepEqual(
    directions.map((planet) => planet.name),
    ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'],
  );
  for (const planet of directions) {
    assert.ok(Math.abs(Math.hypot(planet.x, planet.y, planet.z) - 1) < 1e-12);
    assert.match(planet.color, /^#[0-9a-f]{6}$/);
  }
});

test('Mercury and Venus never stray further from the Sun than their greatest elongations', () => {
  for (const date of [
    new Date(Date.UTC(2026, 0, 1)),
    new Date(Date.UTC(2026, 3, 15)),
    new Date(Date.UTC(2026, 8, 15)),
  ]) {
    const sun = sunDirection(date);
    const [mercury, venus] = planetDirections(Astronomy, date);
    assert.ok(
      degreesBetween(mercury, sun) < 28.5,
      `Mercury on ${date.toISOString()}`,
    );
    assert.ok(
      degreesBetween(venus, sun) < 48,
      `Venus on ${date.toISOString()}`,
    );
  }
});

test('Saturn and Neptune meet within two degrees at their February 2026 conjunction', () => {
  const planets = planetDirections(Astronomy, new Date(Date.UTC(2026, 1, 20)));
  const saturn = planets.find((planet) => planet.name === 'Saturn');
  const neptune = planets.find((planet) => planet.name === 'Neptune');
  assert.ok(
    degreesBetween(saturn, neptune) < 2,
    `${degreesBetween(saturn, neptune)}°`,
  );
});

test('the ephemeris library loads on demand', async () => {
  const module = await loadAstronomy();
  assert.equal(typeof module.GeoVector, 'function');
});
