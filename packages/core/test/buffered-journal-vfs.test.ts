import type { Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import { describe, expect, it } from "vitest";
import { bufferRollbackJournal } from "../src/worker/buffered-journal-vfs.js";

/** Model the VFS boundary, including transient WASM input and SQLite's no-sync journal invalidation. */
function harness() {
  const heap = new Uint8Array(512 * 1024);
  const calls: unknown[][] = [];
  const functions = new Map<number, (...args: any[]) => number>();
  let nextFn = 1;
  const register = (fn: (...args: any[]) => number) => { const id = nextFn++; functions.set(id, fn); return id; };
  let failWrite = false;
  const io: Record<string, any> = {};
  io.$xWrite = register((p, src, n, offset) => {
    if (failWrite) return 10;
    calls.push(["write", p, Number(offset), [...heap.subarray(src, src + n)]]);
    return 0;
  });
  for (const m of ["xRead", "xSync", "xFileSize", "xTruncate", "xUnlock", "xClose"]) {
    io[`$${m}`] = register((...args) => { calls.push([m, ...args]); return 0; });
  }
  const installMethods = function(this: Record<string, any>, methods: Record<string, (...args: any[]) => number>) {
    for (const [name, fn] of Object.entries(methods)) this[`$${name}`] = register(fn);
  };
  io.installMethods = installMethods;
  const vfs = { $xOpen: register(() => 0), installMethods };
  let allocated = 65536;
  const sqlite3 = {
    capi: {
      SQLITE_OPEN_MAIN_JOURNAL: 4, SQLITE_IOERR: 10,
      sqlite3_vfs_find: () => 1,
      sqlite3_vfs: function() { return vfs; },
      sqlite3_file: function() { return { $pMethods: 2 }; },
      sqlite3_io_methods: function() { return io; },
    },
    wasm: {
      functionEntry: (id: number) => functions.get(id),
      heap8u: () => heap,
      alloc: (n: number) => { const p = allocated; allocated += n; return p; },
      dealloc: (p: number) => calls.push(["free", p]),
    },
  } as unknown as Sqlite3Static;
  bufferRollbackJournal(sqlite3, "test");
  functions.get(vfs.$xOpen)!(1, 0, 100, 4, 0);
  const call = (m: string, ...args: any[]) => functions.get(io[`$${m}`])!(...args);
  const write = (p: number, offset: number, bytes: number[]) => {
    heap.set(bytes, 0);
    const rc = call("xWrite", p, 0, bytes.length, BigInt(offset));
    heap.fill(99, 0, bytes.length);
    return rc;
  };
  return { calls, call, write, fail: () => { failWrite = true; } };
}

describe("buffered SAH journal VFS", () => {
  it("writes the complete journal before sync; invalidates immediately without requiring another sync", () => {
    const h = harness();
    h.write(100, 4096, [1, 2]);
    h.write(100, 4098, [3, 4]);
    expect(h.calls).toEqual([]);
    h.call("xSync", 100, 2);
    h.write(200, 8192, [5]); // database writes bypass buffering
    h.call("xSync", 200, 2);
    h.write(100, 0, [0, 0]); // PERSIST commit invalidation
    expect(h.calls).toEqual([
      ["write", 100, 4096, [1, 2, 3, 4]], ["xSync", 100, 2],
      ["write", 200, 8192, [5]], ["xSync", 200, 2], ["write", 100, 0, [0, 0]],
    ]);
  });

  for (const m of ["xRead", "xFileSize", "xTruncate", "xUnlock", "xClose"]) {
    it(`drains pending bytes before ${m} (including rollback reads)`, () => {
      const h = harness();
      h.write(100, 4096, [1]);
      expect(h.call(m, 100, 0, 0, 0n)).toBe(0);
      expect(h.calls.slice(0, 2)).toEqual([["write", 100, 4096, [1]], [m, 100, 0, 0, 0n]]);
    });
  }

  it("closes the underlying file even when draining fails", () => {
    const h = harness();
    h.write(100, 4096, [1]);
    h.fail();
    expect(h.call("xClose", 100)).toBe(10);
    expect(h.calls[0]).toEqual(["xClose", 100]);
    expect(h.calls[1]?.[0]).toBe("free");
  });

  it("does not acknowledge a sync or invalidate the journal when the preceding write fails", () => {
    const h = harness();
    h.write(100, 4096, [1]);
    h.fail();
    expect(h.call("xSync", 100, 2)).toBe(10);
    expect(h.write(100, 0, [0])).toBe(10);
    expect(h.calls).toEqual([]);
  });
});
