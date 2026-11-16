/**
 * Minimal streaming ZIP writer for packages whose entries are already in
 * memory. Each entry is written with its sizes and CRC in the local header
 * (no data descriptors, which some streaming unzippers reject for stored
 * entries), and stored entries are passed to the sink without copying, so a
 * caller that writes chunks to a file or collects them in a Blob never holds
 * a second copy of the media.
 *
 * No ZIP64: at most 65 535 entries and 4 GiB in total. Names are UTF-8 with
 * the language-encoding flag set.
 */
import { deflateSync } from "fflate";

const encoder = new TextEncoder();

let crcTable: Uint32Array | null = null;
export function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export const ZIP_MAX_ENTRIES = 0xffff;
export const ZIP_MAX_BYTES = 0xffffffff;

interface Central {
  name: Uint8Array;
  crc: number;
  compressedSize: number;
  size: number;
  method: number;
  offset: number;
}

export class ZipWriter {
  private offset = 0;
  private readonly central: Central[] = [];
  private readonly dosTime: number;
  private readonly dosDate: number;

  constructor(private readonly sink: (chunk: Uint8Array) => void, mtime: Date) {
    const d = mtime.getFullYear() < 1980 ? new Date(1980, 0, 1) : mtime;
    this.dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    this.dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  }

  /** Add an entry; `deflateLevel` null stores it uncompressed. */
  add(name: string, data: Uint8Array, deflateLevel: number | null): void {
    if (this.central.length >= ZIP_MAX_ENTRIES) throw new Error(`package would have more than ${ZIP_MAX_ENTRIES} zip entries (ZIP64 is not supported)`);
    const nameBytes = encoder.encode(name);
    const crc = crc32(data);
    let body = data;
    let method = 0;
    if (deflateLevel !== null) {
      const deflated = deflateSync(data, { level: deflateLevel as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 });
      if (deflated.length < data.length) {
        body = deflated;
        method = 8;
      }
    }
    if (data.length > ZIP_MAX_BYTES || this.offset + 30 + nameBytes.length + body.length > ZIP_MAX_BYTES) {
      throw new Error("package would exceed 4 GiB (ZIP64 is not supported)");
    }
    const h = new Uint8Array(30 + nameBytes.length);
    const v = new DataView(h.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true); // version needed
    v.setUint16(6, 0x0800, true); // UTF-8 names
    v.setUint16(8, method, true);
    v.setUint16(10, this.dosTime, true);
    v.setUint16(12, this.dosDate, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, body.length, true);
    v.setUint32(22, data.length, true);
    v.setUint16(26, nameBytes.length, true);
    v.setUint16(28, 0, true);
    h.set(nameBytes, 30);
    this.central.push({ name: nameBytes, crc, compressedSize: body.length, size: data.length, method, offset: this.offset });
    this.emit(h);
    this.emit(body);
  }

  end(): void {
    const start = this.offset;
    for (const e of this.central) {
      const h = new Uint8Array(46 + e.name.length);
      const v = new DataView(h.buffer);
      v.setUint32(0, 0x02014b50, true);
      v.setUint16(4, 20, true); // version made by (MS-DOS, 2.0)
      v.setUint16(6, 20, true);
      v.setUint16(8, 0x0800, true);
      v.setUint16(10, e.method, true);
      v.setUint16(12, this.dosTime, true);
      v.setUint16(14, this.dosDate, true);
      v.setUint32(16, e.crc, true);
      v.setUint32(20, e.compressedSize, true);
      v.setUint32(24, e.size, true);
      v.setUint16(28, e.name.length, true);
      v.setUint32(42, e.offset, true);
      h.set(e.name, 46);
      this.emit(h);
    }
    const size = this.offset - start;
    if (this.offset + 22 > ZIP_MAX_BYTES) throw new Error("package would exceed 4 GiB (ZIP64 is not supported)");
    const eocd = new Uint8Array(22);
    const v = new DataView(eocd.buffer);
    v.setUint32(0, 0x06054b50, true);
    v.setUint16(8, this.central.length, true);
    v.setUint16(10, this.central.length, true);
    v.setUint32(12, size, true);
    v.setUint32(16, start, true);
    this.emit(eocd);
  }

  private emit(chunk: Uint8Array): void {
    this.offset += chunk.length;
    if (chunk.length) this.sink(chunk);
  }
}
