import { deflateSync } from 'node:zlib';
import { temperatureRgb } from '../../../src/layers/weather-overlays/palette.js';

export const TILE_SIZE = 256;
export const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const KELVIN_OFFSET = 273.15;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Encode 8-bit RGBA pixels (row-major) as a PNG with no row filtering. */
export function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Bilinear sample of a `parseGfsCsv` grid; wraps longitude when the grid spans 360°. */
export function sampleKelvin(grid, latDeg, lonDeg) {
  const { lat0, latStep, latCount, lon0, lonStep, lonCount, kelvin } = grid;
  const rowPosition = Math.min(
    Math.max((latDeg - lat0) / latStep, 0),
    latCount - 1,
  );
  const row = Math.min(Math.floor(rowPosition), latCount - 2);
  const rowT = rowPosition - row;
  const wraps = Math.abs(lonCount * lonStep - 360) < 1e-6;
  let columnPosition = ((((lonDeg - lon0) % 360) + 360) % 360) / lonStep;
  if (!wraps) columnPosition = Math.min(columnPosition, lonCount - 1);
  const column = Math.min(
    Math.floor(columnPosition),
    wraps ? lonCount - 1 : lonCount - 2,
  );
  const nextColumn = wraps ? (column + 1) % lonCount : column + 1;
  const columnT = columnPosition - column;
  const at = (r, c) => kelvin[r * lonCount + c];
  const south = at(row, column) * (1 - columnT) + at(row, nextColumn) * columnT;
  const north =
    at(row + 1, column) * (1 - columnT) + at(row + 1, nextColumn) * columnT;
  return south * (1 - rowT) + north * rowT;
}

/** Render one Web Mercator tile of the temperature ramp; missing values stay transparent. */
export function renderTemperatureTile(grid, { z, x, y }, size = TILE_SIZE) {
  const rgba = Buffer.alloc(size * size * 4);
  const tiles = 2 ** z;
  for (let py = 0; py < size; py += 1) {
    const mercatorY = (y + (py + 0.5) / size) / tiles;
    const lat =
      (Math.atan(Math.sinh(Math.PI * (1 - 2 * mercatorY))) * 180) / Math.PI;
    for (let px = 0; px < size; px += 1) {
      const lon = ((x + (px + 0.5) / size) / tiles) * 360 - 180;
      const rgb = temperatureRgb(sampleKelvin(grid, lat, lon) - KELVIN_OFFSET);
      if (!rgb) continue;
      const offset = (py * size + px) * 4;
      rgba[offset] = rgb[0];
      rgba[offset + 1] = rgb[1];
      rgba[offset + 2] = rgb[2];
      rgba[offset + 3] = 255;
    }
  }
  return encodePng(size, size, rgba);
}
