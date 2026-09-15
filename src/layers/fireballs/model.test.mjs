import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CNEOS_FIREBALLS_URL,
  FIREBALLS_META,
  buildFireballCard,
  fireballPixelSize,
  parseFireballsPayload,
} from './model.js';

const RECORD = {
  id: '20260911101803',
  time: Date.UTC(2026, 8, 11, 10, 18, 3),
  lat: -0.2,
  lon: -129.6,
  altKm: 70,
  velKms: null,
  energyJ: 6.1e10,
  impactKt: 0.2,
};

test('the layer meta names an orange fireball layer sourced from NASA/JPL CNEOS', () => {
  assert.deepEqual(
    [
      FIREBALLS_META.id,
      FIREBALLS_META.name,
      FIREBALLS_META.icon,
      FIREBALLS_META.source,
    ],
    ['fireballs', 'Fireballs', '☄️', 'NASA/JPL CNEOS'],
  );
  assert.equal(FIREBALLS_META.selectedSourceId, 'fireballs-selected');
  assert.equal(CNEOS_FIREBALLS_URL, 'https://cneos.jpl.nasa.gov/fireballs/');
});

test('point size grows two pixels per tenfold impact energy, from 6 px at 0.1 kt to a 14 px cap', () => {
  assert.equal(fireballPixelSize(0.1), 6);
  assert.equal(fireballPixelSize(1), 8);
  assert.equal(fireballPixelSize(10), 10);
  assert.equal(fireballPixelSize(100), 12);
  const chelyabinsk = fireballPixelSize(440);
  assert.ok(chelyabinsk > 13 && chelyabinsk < 13.5, `440 kt → ${chelyabinsk}`);
  assert.equal(fireballPixelSize(100_000), 14);
  assert.equal(fireballPixelSize(0.01), 6);
  assert.equal(fireballPixelSize(null), 6);
});

test('a card gives the UTC time, altitude, energies and position', () => {
  assert.deepEqual(buildFireballCard(RECORD), {
    title: 'Fireball · 11 Sep 2026',
    details: [
      '10:18 UTC · 70 km up',
      'Impact energy 0.2 kt TNT',
      'Radiated 6.1 × 10¹⁰ J',
      '0.20°S 129.60°W',
    ],
    url: 'https://cneos.jpl.nasa.gov/fireballs/',
    accessibilityLabel: 'Open the NASA/JPL CNEOS fireball list',
  });
});

test('speed shows when known; missing altitude and rounding edges stay tidy', () => {
  const card = buildFireballCard({
    ...RECORD,
    altKm: null,
    velKms: 19.3,
    energyJ: 9.96e10,
    impactKt: 440.4,
    lat: 54.4,
    lon: 100.1,
  });
  assert.deepEqual(card.details, [
    '10:18 UTC',
    'Impact energy 440 kt TNT',
    'Entry speed 19.3 km/s',
    'Radiated 1.0 × 10¹¹ J',
    '54.40°N 100.10°E',
  ]);
  const quiet = buildFireballCard({ ...RECORD, energyJ: null, impactKt: 0.13 });
  assert.deepEqual(quiet.details, [
    '10:18 UTC · 70 km up',
    'Impact energy 0.13 kt TNT',
    '0.20°S 129.60°W',
  ]);
});

test('the proxy payload becomes sized records; stale passes through; a broken payload is refused', () => {
  const parsed = parseFireballsPayload({
    generatedAt: 1,
    stale: true,
    fireballs: [RECORD, { id: 'x', lat: 'nope' }, null],
  });
  assert.equal(parsed.stale, true);
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].id, '20260911101803');
  assert.equal(parsed.records[0].pixelSize, fireballPixelSize(0.2));
  assert.equal(parseFireballsPayload({ fireballs: {} }), null);
  assert.equal(parseFireballsPayload(null), null);
});
