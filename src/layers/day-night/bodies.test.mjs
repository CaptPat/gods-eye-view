import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSunMoon } from './bodies.js';

test('at the June 2026 solstice the sun stands over the Tropic of Cancer, east of Greenwich in the morning', () => {
  const { sun, moon } = computeSunMoon(new Date(Date.UTC(2026, 5, 21, 8, 24)));
  assert.ok(Math.abs(sun.lat - 23.44) < 0.05, `sun lat ${sun.lat}`);
  assert.ok(Math.abs(sun.lon - 54.4) < 1, `sun lon ${sun.lon}`);
  assert.ok(Math.abs(moon.lat) <= 29, `moon lat ${moon.lat}`);
  assert.ok(moon.lon >= -180 && moon.lon <= 180);
});

test('the 3 March 2026 lunar eclipse is a full moon and the 17 February 2026 solar eclipse a new one', () => {
  const eclipse = computeSunMoon(new Date(Date.UTC(2026, 2, 3, 11, 33)));
  assert.ok(eclipse.illumination > 0.99, `full ${eclipse.illumination}`);
  const annular = computeSunMoon(new Date(Date.UTC(2026, 1, 17, 12, 12)));
  assert.ok(annular.illumination < 0.01, `new ${annular.illumination}`);
  const waxing = computeSunMoon(new Date(Date.UTC(2026, 1, 24, 12, 0)));
  assert.equal(waxing.waxing, true, 'a week after new moon it is waxing');
  const waning = computeSunMoon(new Date(Date.UTC(2026, 2, 10, 12, 0)));
  assert.equal(waning.waxing, false, 'a week after full moon it is waning');
});
