import { inflateRawSync } from "node:zlib";

/** Tiny ZIP reader for tests: walks local headers and inflates each file. */
export function readZip(zip: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let offset = 0;
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    const method = zip.readUInt16LE(offset + 8);
    const compressedSize = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const name = zip.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    const start = offset + 30 + nameLength + extraLength;
    const body = zip.subarray(start, start + compressedSize);
    files.set(name, method === 8 ? inflateRawSync(body) : Buffer.from(body));
    offset = start + compressedSize;
  }
  return files;
}
