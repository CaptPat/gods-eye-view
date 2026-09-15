import test from 'node:test';
import assert from 'node:assert/strict';
import {
  METEOR_SHOWERS,
  METEOR_SHOWERS_META,
  activeShowers,
  buildShowerCard,
  gmstDegrees,
  radiantSubpoint,
  showerPixelSize,
  showerRecords,
} from './model.js';

const near = (actual, expected, tolerance = 1e-6) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`,
  );
const shower = (name) => METEOR_SHOWERS.find((entry) => entry.name === name);

test('the layer meta names a meteor shower layer from the IMO calendar', () => {
  assert.deepEqual(
    [
      METEOR_SHOWERS_META.id,
      METEOR_SHOWERS_META.name,
      METEOR_SHOWERS_META.icon,
      METEOR_SHOWERS_META.source,
    ],
    ['meteor-showers', 'Meteor Showers', '🌠', 'IMO calendar'],
  );
  assert.equal(METEOR_SHOWERS.length, 37);
  assert.deepEqual(shower('Perseids'), {
    name: 'Perseids',
    start: '07-17',
    end: '08-24',
    peak: '08-13',
    raHours: 3.2,
    decDeg: 58,
    speedKms: 59,
    zhr: 100,
    parent: '109P/Swift-Tuttle',
    article: 'Perseids',
  });
});

test('Greenwich sidereal time matches J2000 and advances one sidereal day per solar day', () => {
  near(gmstDegrees(new Date(Date.UTC(2000, 0, 1, 12))), 280.46061837);
  near(gmstDegrees(new Date(Date.UTC(2000, 0, 2, 12))), 281.44626573629);
});

test('active showers include windows that wrap past New Year', () => {
  assert.deepEqual(
    activeShowers(new Date(Date.UTC(2026, 8, 15, 12))).map(
      (entry) => entry.name,
    ),
    ['September Epsilon Perseids', 'September Lyncids'],
  );
  assert.deepEqual(
    activeShowers(new Date(Date.UTC(2026, 0, 5, 12))).map(
      (entry) => entry.name,
    ),
    ['Quadrantids', 'Comae Berenicids'],
  );
});

test('a radiant stands over the latitude of its declination, west of Greenwich by sidereal time', () => {
  const point = radiantSubpoint(
    shower('Perseids'),
    new Date(Date.UTC(2000, 0, 1, 12)),
  );
  near(point.lat, 58);
  near(point.lon, 127.53938163);
});

test('point size follows the hourly rate, with variable showers in the middle', () => {
  assert.equal(showerPixelSize(1), 6);
  assert.equal(showerPixelSize(100), 10);
  assert.equal(showerPixelSize(10_000), 12);
  assert.equal(showerPixelSize(null), 8);
});

test('a card gives peak, rate, speed, window, parent and where the radiant climbs 30°', () => {
  assert.deepEqual(buildShowerCard(shower('Perseids')), {
    title: 'Perseids',
    details: [
      'Peak 13 Aug · ZHR 100 · 59 km/s',
      'Active 17 Jul – 24 Aug',
      'Parent 109P/Swift-Tuttle',
      'Radiant 30°+ high from 2°S to 90°N',
    ],
    url: 'https://en.wikipedia.org/wiki/Perseids',
    accessibilityLabel: 'Open the Wikipedia article on the Perseids',
  });
  const lyncids = buildShowerCard(shower('September Lyncids'));
  assert.equal(
    lyncids.url,
    'https://en.wikipedia.org/wiki/List_of_meteor_showers',
  );
  assert.equal(
    lyncids.accessibilityLabel,
    'Open the Wikipedia list of meteor showers',
  );
  assert.equal(
    buildShowerCard(shower('June Bootids')).details[0],
    'Peak 22 Jun · ZHR variable · 18 km/s',
  );
  assert.equal(
    buildShowerCard(shower('Alpha Centaurids')).details[3],
    'Radiant 30°+ high from 90°S to 2°N',
  );
});

test('records place each active shower under its radiant for the given time', () => {
  const at = new Date(Date.UTC(2026, 8, 15, 12));
  const { records, stale } = showerRecords(at);
  assert.equal(stale, false);
  assert.deepEqual(
    records.map((record) => record.id),
    ['september-epsilon-perseids', 'september-lyncids'],
  );
  const lyncids = records[1];
  near(lyncids.lat, 56);
  assert.deepEqual(radiantSubpoint(shower('September Lyncids'), at), {
    lat: lyncids.lat,
    lon: lyncids.lon,
  });
  assert.equal(lyncids.pixelSize, showerPixelSize(3));
});
