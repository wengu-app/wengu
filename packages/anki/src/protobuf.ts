/**
 * Minimal protobuf wire-format reader.
 *
 * Anki's newer files store a handful of small protobuf messages (package
 * metadata, media manifest, notetype/deck/preset config blobs). We only need
 * to read them, and only a few field types, so a ~100 line decoder is
 * preferable to pulling in a protobuf runtime plus generated code.
 *
 * Field numbers are documented next to each decoder in `schema18.ts`.
 */

export type WireValue =
  | { wire: 0; value: bigint } // varint
  | { wire: 1; bytes: Uint8Array } // fixed64 (8 raw bytes)
  | { wire: 2; bytes: Uint8Array } // length-delimited
  | { wire: 5; bytes: Uint8Array }; // fixed32 (4 raw bytes)

export class ProtoMessage {
  readonly fields = new Map<number, WireValue[]>();

  constructor(readonly raw: Uint8Array) {
    let pos = 0;
    const buf = raw;
    const readVarint = (): bigint => {
      let result = 0n;
      let shift = 0n;
      for (;;) {
        if (pos >= buf.length) throw new Error("protobuf: truncated varint");
        const b = buf[pos++]!;
        result |= BigInt(b & 0x7f) << shift;
        if ((b & 0x80) === 0) return result;
        shift += 7n;
        if (shift > 70n) throw new Error("protobuf: varint too long");
      }
    };
    const take = (n: number): Uint8Array => {
      if (pos + n > buf.length) throw new Error("protobuf: truncated field");
      const out = buf.subarray(pos, pos + n);
      pos += n;
      return out;
    };
    while (pos < buf.length) {
      const key = Number(readVarint());
      const field = key >>> 3;
      const wire = key & 7;
      let v: WireValue;
      switch (wire) {
        case 0:
          v = { wire: 0, value: readVarint() };
          break;
        case 1:
          v = { wire: 1, bytes: take(8) };
          break;
        case 2:
          v = { wire: 2, bytes: take(Number(readVarint())) };
          break;
        case 5:
          v = { wire: 5, bytes: take(4) };
          break;
        default:
          throw new Error(`protobuf: unsupported wire type ${wire}`);
      }
      const list = this.fields.get(field);
      if (list) list.push(v);
      else this.fields.set(field, [v]);
    }
  }

  has(field: number): boolean {
    return this.fields.has(field);
  }

  private last(field: number): WireValue | undefined {
    const list = this.fields.get(field);
    return list ? list[list.length - 1] : undefined;
  }

  /** uint32/uint64/int32/int64/bool/enum as a JS number (int64 > 2^53 loses precision; use `int64String`). */
  uint(field: number, dflt = 0): number {
    const v = this.last(field);
    if (!v) return dflt;
    if (v.wire !== 0) throw new Error(`protobuf: field ${field} is not a varint`);
    return Number(BigInt.asUintN(64, v.value));
  }

  int(field: number, dflt = 0): number {
    const v = this.last(field);
    if (!v) return dflt;
    if (v.wire !== 0) throw new Error(`protobuf: field ${field} is not a varint`);
    return Number(BigInt.asIntN(64, v.value));
  }

  /** int64 as an exact decimal string. */
  int64String(field: number): string | null {
    const v = this.last(field);
    if (!v) return null;
    if (v.wire !== 0) throw new Error(`protobuf: field ${field} is not a varint`);
    return BigInt.asIntN(64, v.value).toString();
  }

  sint(field: number, dflt = 0): number {
    const v = this.last(field);
    if (!v) return dflt;
    if (v.wire !== 0) throw new Error(`protobuf: field ${field} is not a varint`);
    const n = BigInt.asUintN(64, v.value);
    return Number((n >> 1n) ^ -(n & 1n));
  }

  bool(field: number, dflt = false): boolean {
    return this.has(field) ? this.uint(field) !== 0 : dflt;
  }

  float(field: number, dflt = 0): number {
    const v = this.last(field);
    if (!v) return dflt;
    if (v.wire !== 5) throw new Error(`protobuf: field ${field} is not fixed32`);
    return new DataView(v.bytes.buffer, v.bytes.byteOffset, 4).getFloat32(0, true);
  }

  /** `repeated float`, accepting both packed and unpacked encodings. */
  floats(field: number): number[] {
    const out: number[] = [];
    for (const v of this.fields.get(field) ?? []) {
      if (v.wire === 5) {
        out.push(new DataView(v.bytes.buffer, v.bytes.byteOffset, 4).getFloat32(0, true));
      } else if (v.wire === 2) {
        const dv = new DataView(v.bytes.buffer, v.bytes.byteOffset, v.bytes.byteLength);
        for (let i = 0; i + 4 <= v.bytes.byteLength; i += 4) out.push(dv.getFloat32(i, true));
      } else {
        throw new Error(`protobuf: field ${field} is not a float`);
      }
    }
    return out;
  }

  /** `repeated uint32`, packed or unpacked. */
  uints(field: number): number[] {
    const out: number[] = [];
    for (const v of this.fields.get(field) ?? []) {
      if (v.wire === 0) out.push(Number(v.value));
      else if (v.wire === 2) {
        let pos = 0;
        const b = v.bytes;
        while (pos < b.length) {
          let result = 0;
          let mul = 1;
          for (;;) {
            const byte = b[pos++]!;
            result += (byte & 0x7f) * mul;
            mul *= 128;
            if ((byte & 0x80) === 0) break;
          }
          out.push(result);
        }
      }
    }
    return out;
  }

  bytes(field: number): Uint8Array | null {
    const v = this.last(field);
    if (!v) return null;
    if (v.wire !== 2) throw new Error(`protobuf: field ${field} is not length-delimited`);
    return v.bytes;
  }

  string(field: number, dflt = ""): string {
    const b = this.bytes(field);
    return b ? utf8.decode(b) : dflt;
  }

  message(field: number): ProtoMessage | null {
    const b = this.bytes(field);
    return b ? new ProtoMessage(b) : null;
  }

  messages(field: number): ProtoMessage[] {
    return (this.fields.get(field) ?? []).map((v) => {
      if (v.wire !== 2) throw new Error(`protobuf: field ${field} is not a message`);
      return new ProtoMessage(v.bytes);
    });
  }
}

export const utf8 = new TextDecoder("utf-8");
