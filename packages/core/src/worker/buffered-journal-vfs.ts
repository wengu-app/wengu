import type { Sqlite3Static, WasmPointer } from "@sqlite.org/sqlite-wasm";
import { JournalBuffer } from "./journal-buffer.js";

/**
 * Coalesce rollback-journal records (page number, page image, checksum) before sending them to OPFS.
 * SAH writes each cost a browser-process round trip, even for a four-byte checksum. SQLite's sync
 * boundaries are unchanged: pending journal bytes reach the underlying VFS BEFORE its xSync, and
 * before any read, size query, truncate or close. Database-file writes are never buffered here.
 * Install once on the private SAH-pool VFS, before opening a connection.
 */
export function bufferRollbackJournal(sqlite3: Sqlite3Static, name: string): void {
  const { capi, wasm } = sqlite3;
  type Callback = (...args: any[]) => number;
  type Methods = Record<string, WasmPointer>;
  const vfs = new capi.sqlite3_vfs(capi.sqlite3_vfs_find(name));
  const originalOpen = wasm.functionEntry((vfs as unknown as Methods).$xOpen!)! as Callback;
  const files = new Map<WasmPointer, { buffer: JournalBuffer; scratch: WasmPointer }>();
  let installed = false;
  const installIo = (file: WasmPointer) => {
    const f = new capi.sqlite3_file(file);
    const io = new capi.sqlite3_io_methods(f.$pMethods);
    const methods = io as unknown as Methods;
    const write = wasm.functionEntry(methods.$xWrite!)! as Callback;
    const wrappers: Record<string, Callback> = {};
    wrappers.xWrite = (p, src, n, offset) => {
      const state = files.get(p);
      if (!state) return write(p, src, n, offset);
      try {
        // Journal invalidation at commit MUST reach OPFS before COMMIT returns, even when SQLite
        // does not sync it. Never defer header writes (the SAH pool sector size is 4096).
        if (Number(offset) < 4096) return state.buffer.flush() || write(p, src, n, offset);
        return state.buffer.write(wasm.heap8u().subarray(Number(src), Number(src) + n), Number(offset));
      } catch { return capi.SQLITE_IOERR; }
    };
    for (const method of ["xRead", "xSync", "xFileSize", "xTruncate", "xUnlock", "xClose"]) {
      const original = wasm.functionEntry(methods[`$${method}`]!)! as Callback;
      wrappers[method] = (p, ...args) => {
        const state = files.get(p);
        try {
          const rc = state?.buffer.flush() ?? 0;
          // SQLite releases the file even if xClose fails: close the underlying handle as well.
          if (rc && method !== "xClose") return rc;
          const result = original(p, ...args);
          return rc || result;
        } catch { return capi.SQLITE_IOERR; }
        finally {
          if (method === "xClose" && state) {
            wasm.dealloc(state.scratch);
            files.delete(p);
          }
        }
      };
    }
    io.installMethods(wrappers, false);
    // The structs wrap existing pointers. Keep their installed callbacks for the VFS's lifetime.
    return write;
  };
  let originalWrite: Callback;
  vfs.installMethods({ xOpen: (...args: any[]) => {
    const rc = originalOpen(...args);
    if (rc || !(args[3] & capi.SQLITE_OPEN_MAIN_JOURNAL)) return rc;
    try {
      const file = args[2] as WasmPointer;
      if (!installed) { originalWrite = installIo(file); installed = true; }
      const scratch = wasm.alloc(64 * 1024);
      const buffer = new JournalBuffer((bytes, offset) => {
        // Oversized writes bypass the JS buffer, so allocate enough temporary WASM space for them.
        const ptr = bytes.length > 64 * 1024 ? wasm.alloc(bytes.length) : scratch;
        try {
          wasm.heap8u().set(bytes, Number(ptr));
          return originalWrite(file, ptr, bytes.length, BigInt(offset));
        } finally { if (ptr !== scratch) wasm.dealloc(ptr); }
      });
      files.set(file, { buffer, scratch });
      return rc;
    } catch { return capi.SQLITE_IOERR; }
  } }, false);
}
