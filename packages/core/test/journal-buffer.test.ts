import { describe, expect, it } from "vitest";
import { JournalBuffer } from "../src/worker/journal-buffer.js";

describe("rollback journal write coalescing", () => {
  it("copies transient SQLite buffers and combines page number, image and checksum", () => {
    const writes: { bytes: number[]; offset: number }[] = [];
    const b = new JournalBuffer((bytes, offset) => { writes.push({ bytes: [...bytes], offset }); return 0; });
    const transient = new Uint8Array([1, 2]);
    b.write(transient, 4096);
    transient.fill(9);
    b.write(new Uint8Array([3, 4, 5]), 4098);
    b.write(new Uint8Array([6]), 4101);
    expect(writes).toEqual([]);
    expect(b.flush()).toBe(0);
    expect(writes).toEqual([{ bytes: [1, 2, 3, 4, 5, 6], offset: 4096 }]);
    b.flush();
    expect(writes).toHaveLength(1);
  });

  it("flushes before a non-contiguous header overwrite and at capacity", () => {
    const writes: [number, number[]][] = [];
    const b = new JournalBuffer((bytes, offset) => { writes.push([offset, [...bytes]]); return 0; }, 4);
    b.write(new Uint8Array([1, 2, 3]), 0);
    b.write(new Uint8Array([4, 5]), 3);
    b.write(new Uint8Array([6]), 0);
    b.write(new Uint8Array([7, 8, 9, 10, 11]), 1);
    b.flush();
    expect(writes).toEqual([[0, [1, 2, 3]], [3, [4, 5]], [0, [6]], [1, [7, 8, 9, 10, 11]]]);
  });

  it("propagates failed writes without losing pending journal bytes or accepting later writes", () => {
    let fail = true;
    const writes: number[][] = [];
    const b = new JournalBuffer((bytes) => { if (fail) return 10; writes.push([...bytes]); return 0; }, 4);
    b.write(new Uint8Array([1, 2, 3, 4]), 0);
    expect(b.write(new Uint8Array([5]), 4)).toBe(10);
    expect(b.flush()).toBe(10);
    fail = false;
    expect(b.flush()).toBe(0);
    expect(writes).toEqual([[1, 2, 3, 4]]);
  });
});
