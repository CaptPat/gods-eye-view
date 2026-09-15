import { inflateRawSync } from 'node:zlib';

/** The first entry of a zip archive (stored or deflated), read through its central directory. */
export function firstZipEntry(buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error('not a zip archive');
  const central = buffer.readUInt32LE(end + 16);
  if (buffer.readUInt32LE(central) !== 0x02014b50)
    throw new Error('zip central directory not found');
  const method = buffer.readUInt16LE(central + 10);
  const compressedSize = buffer.readUInt32LE(central + 20);
  const local = buffer.readUInt32LE(central + 42);
  const start =
    local +
    30 +
    buffer.readUInt16LE(local + 26) +
    buffer.readUInt16LE(local + 28);
  const data = buffer.subarray(start, start + compressedSize);
  if (method === 0) return data;
  if (method === 8) return inflateRawSync(data);
  throw new Error(`unsupported zip compression method ${method}`);
}
