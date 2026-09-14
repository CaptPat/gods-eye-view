import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { crc32, inflateSync } from 'node:zlib';
import {
  PNG_SIGNATURE,
  encodePng,
  renderTemperatureTile,
  sampleKelvin,
} from '../../server/providers/weather-overlays/render.js';
import { parseGfsCsv } from '../../server/providers/weather-overlays/sources.js';
import {
  celsiusToFahrenheit,
  temperatureRgb,
} from '../layers/weather-overlays/palette.js';

/** Decode the unfiltered RGBA PNGs encodePng writes, checking every chunk CRC. */
function decodeRgba(png) {
  assert.ok(png.subarray(0, 8).equals(PNG_SIGNATURE));
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    assert.equal(
      png.readUInt32BE(offset + 8 + length),
      crc32(png.subarray(offset + 4, offset + 8 + length)),
      `${type} CRC`,
    );
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.deepEqual([data[8], data[9]], [8, 6], '8-bit RGBA');
    }
    if (type === 'IDAT') idat.push(data);
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    assert.equal(raw[y * (stride + 1)], 0, 'no row filter');
    raw.copy(pixels, y * stride, y * (stride + 1) + 1, (y + 1) * (stride + 1));
  }
  return { width, height, pixels };
}

test('the temperature ramp interpolates between stops and clamps at both ends', () => {
  assert.deepEqual(temperatureRgb(-50), [0x5e, 0x3c, 0x99]);
  assert.deepEqual(temperatureRgb(45), [0xa5, 0x0f, 0x15]);
  assert.deepEqual(temperatureRgb(10), [0xff, 0xf3, 0xa0]);
  assert.deepEqual(
    temperatureRgb(5),
    [207, 230, 200],
    'halfway from 0 °C to 10 °C',
  );
  assert.equal(temperatureRgb(Number.NaN), null);
  assert.equal(celsiusToFahrenheit(-30), -22);
  assert.equal(celsiusToFahrenheit(40), 104);
});

test('encodePng writes a valid RGBA PNG', () => {
  const rgba = Buffer.from([
    255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 1, 2, 3, 4,
  ]);
  const { width, height, pixels } = decodeRgba(encodePng(2, 2, rgba));
  assert.deepEqual([width, height], [2, 2]);
  assert.ok(pixels.equals(rgba));
});

test('bilinear sampling wraps longitude and clamps latitude', () => {
  const grid = {
    lat0: -90,
    latStep: 90,
    latCount: 3,
    lon0: 0,
    lonStep: 90,
    lonCount: 4,
    kelvin: Float32Array.from([
      200, 200, 200, 200, 280, 290, 300, 310, 250, 250, 250, 250,
    ]),
  };
  assert.equal(sampleKelvin(grid, 0, 0), 280);
  assert.equal(sampleKelvin(grid, 0, 45), 285);
  assert.equal(
    sampleKelvin(grid, 0, 315),
    295,
    'between 270°E and the wrapped 0°E',
  );
  assert.equal(sampleKelvin(grid, 0, -45), 295);
  assert.equal(sampleKelvin(grid, 45, 0), 265);
  assert.equal(
    sampleKelvin(grid, -100, 90),
    200,
    'clamped to the south pole row',
  );
});

test('a rendered tile colours each pixel from the sampled grid, and missing data stays clear', () => {
  const grid = parseGfsCsv(
    readFileSync(
      new URL(
        './fixtures/weather-overlays/gfs-tmp2m-30deg.csv',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  const size = 32;
  const { width, pixels } = decodeRgba(
    renderTemperatureTile(grid, { z: 0, x: 0, y: 0 }, size),
  );
  assert.equal(width, size);
  for (const [px, py] of [
    [16, 16],
    [3, 9],
    [30, 25],
  ]) {
    const lon = ((px + 0.5) / size) * 360 - 180;
    const lat =
      (Math.atan(Math.sinh(Math.PI * (1 - (2 * (py + 0.5)) / size))) * 180) /
      Math.PI;
    const offset = (py * size + px) * 4;
    assert.deepEqual(
      [...pixels.subarray(offset, offset + 4)],
      [...temperatureRgb(sampleKelvin(grid, lat, lon) - 273.15), 255],
      `pixel ${px},${py}`,
    );
  }

  const empty = {
    ...grid,
    kelvin: new Float32Array(grid.kelvin.length).fill(Number.NaN),
  };
  const clear = decodeRgba(
    renderTemperatureTile(empty, { z: 0, x: 0, y: 0 }, 4),
  ).pixels;
  assert.ok(clear.every((byte) => byte === 0));
});
