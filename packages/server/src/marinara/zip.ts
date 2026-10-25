import { crc32, deflateRawSync } from "node:zlib";

export interface ZipFile {
  /** Forward-slash path inside the archive. */
  path: string;
  data: Buffer;
}

/**
 * Minimal ZIP writer (deflate, no ZIP64): enough for an export bundle of JSON, Markdown and
 * embedded images. ponytail: archives over 4 GB or 65535 files are rejected; a ZIP64 writer
 * or an archive library is the upgrade path if bundles ever get that big.
 */
export function createZip(files: ZipFile[], date = new Date()): Buffer {
  if (files.length > 0xffff) throw new Error("Too many files for a ZIP archive without ZIP64.");
  const dosTime = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;

  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.path, "utf8");
    const compressed = deflateRawSync(file.data);
    const useDeflate = compressed.length < file.data.length;
    const body = useDeflate ? compressed : file.data;
    const crc = crc32(file.data);
    if (body.length > 0xfffffffe || offset > 0xfffffffe) throw new Error("ZIP archive too large without ZIP64.");

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // version needed
    header.writeUInt16LE(0x0800, 6); // UTF-8 names
    header.writeUInt16LE(useDeflate ? 8 : 0, 8);
    header.writeUInt16LE(dosTime, 10);
    header.writeUInt16LE(dosDate, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(file.data.length, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28);
    local.push(header, name, body);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4); // version made by
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(useDeflate ? 8 : 0, 10);
    entry.writeUInt16LE(dosTime, 12);
    entry.writeUInt16LE(dosDate, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(file.data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);

    offset += header.length + name.length + body.length;
  }

  const centralSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}
