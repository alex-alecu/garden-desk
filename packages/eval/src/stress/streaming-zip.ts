import { type FileHandle, open, rm } from "node:fs/promises";
import { Readable } from "node:stream";
import { createDeflateRaw } from "node:zlib";

export type ZipContent = Iterable<string | Uint8Array> | AsyncIterable<string | Uint8Array>;

export interface ZipEntry {
  name: string;
  content: () => ZipContent;
}

interface WrittenEntry {
  name: Buffer;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  offset: number;
}

const CRC_TABLE = createCrcTable();
const UTF8_DATA_DESCRIPTOR = 0x0808;

function createCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let value = 0; value < table.length; value += 1) {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    table[value] = crc >>> 0;
  }
  return table;
}

function updateCrc(current: number, chunk: Uint8Array): number {
  let crc = current;
  for (const byte of chunk) crc = ((crc >>> 8) ^ (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0)) >>> 0;
  return crc;
}

function localHeader(name: Buffer): Buffer {
  const header = Buffer.alloc(30 + name.length);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(UTF8_DATA_DESCRIPTOR, 6);
  header.writeUInt16LE(8, 8);
  header.writeUInt16LE(name.length, 26);
  name.copy(header, 30);
  return header;
}

function dataDescriptor(entry: WrittenEntry): Buffer {
  const descriptor = Buffer.alloc(16);
  descriptor.writeUInt32LE(0x08074b50, 0);
  descriptor.writeUInt32LE(entry.crc, 4);
  descriptor.writeUInt32LE(entry.compressedSize, 8);
  descriptor.writeUInt32LE(entry.uncompressedSize, 12);
  return descriptor;
}

function centralHeader(entry: WrittenEntry): Buffer {
  const header = Buffer.alloc(46 + entry.name.length);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(UTF8_DATA_DESCRIPTOR, 8);
  header.writeUInt16LE(8, 10);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.compressedSize, 20);
  header.writeUInt32LE(entry.uncompressedSize, 24);
  header.writeUInt16LE(entry.name.length, 28);
  header.writeUInt32LE(entry.offset, 42);
  entry.name.copy(header, 46);
  return header;
}

function endRecord(entries: number, centralSize: number, centralOffset: number): Buffer {
  const record = Buffer.alloc(22);
  record.writeUInt32LE(0x06054b50, 0);
  record.writeUInt16LE(entries, 8);
  record.writeUInt16LE(entries, 10);
  record.writeUInt32LE(centralSize, 12);
  record.writeUInt32LE(centralOffset, 16);
  return record;
}

function requireZip32(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`ZIP32 ${label} limit exceeded.`);
  }
}

class StreamingZip {
  private offset = 0;
  private readonly entries: WrittenEntry[] = [];

  constructor(private readonly file: FileHandle) {}

  private async write(chunk: Uint8Array): Promise<void> {
    let written = 0;
    while (written < chunk.byteLength) {
      const result = await this.file.write(
        chunk,
        written,
        chunk.byteLength - written,
        this.offset + written,
      );
      if (result.bytesWritten === 0) throw new Error("ZIP write made no progress.");
      written += result.bytesWritten;
    }
    this.offset += chunk.byteLength;
  }

  private async measuredContent(
    source: ZipContent,
    measured: { crc: number; size: number },
  ): Promise<Readable> {
    async function* chunks(): AsyncGenerator<Buffer> {
      for await (const value of source) {
        const chunk = typeof value === "string" ? Buffer.from(value) : Buffer.from(value);
        measured.crc = updateCrc(measured.crc, chunk);
        measured.size += chunk.byteLength;
        yield chunk;
      }
    }
    return Readable.from(chunks(), { objectMode: false });
  }

  async add(entry: ZipEntry): Promise<void> {
    const name = Buffer.from(entry.name);
    if (name.length === 0 || name.length > 0xffff) throw new Error("Invalid ZIP entry name.");
    const offset = this.offset;
    await this.write(localHeader(name));
    const measured = { crc: 0xffffffff, size: 0 };
    const input = await this.measuredContent(entry.content(), measured);
    const compressed = input.pipe(createDeflateRaw({ level: 6 }));
    const compressedStart = this.offset;
    for await (const chunk of compressed) await this.write(Buffer.from(chunk));
    const written: WrittenEntry = {
      name,
      crc: (measured.crc ^ 0xffffffff) >>> 0,
      compressedSize: this.offset - compressedStart,
      uncompressedSize: measured.size,
      offset,
    };
    requireZip32(written.compressedSize, "entry compressed size");
    requireZip32(written.uncompressedSize, "entry uncompressed size");
    await this.write(dataDescriptor(written));
    this.entries.push(written);
  }

  async finish(): Promise<void> {
    if (this.entries.length > 0xffff) throw new Error("ZIP entry count limit exceeded.");
    const centralOffset = this.offset;
    for (const entry of this.entries) await this.write(centralHeader(entry));
    const centralSize = this.offset - centralOffset;
    requireZip32(centralOffset, "central offset");
    requireZip32(centralSize, "central size");
    await this.write(endRecord(this.entries.length, centralSize, centralOffset));
  }
}

export async function writeStreamingZip(path: string, entries: ZipEntry[]): Promise<void> {
  const file = await open(path, "wx", 0o600);
  try {
    const archive = new StreamingZip(file);
    for (const entry of entries) await archive.add(entry);
    await archive.finish();
  } catch (error) {
    await file.close();
    await rm(path, { force: true });
    throw error;
  }
  await file.close();
}
