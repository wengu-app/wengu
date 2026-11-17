/**
 * The database worker (module worker). Import this module from the app's worker file:
 *
 *   // src/db.worker.ts
 *   import "@wengu/core/worker";
 *
 * Storage: SQLite WASM with the "opfs-sahpool" VFS (Origin Private File System, synchronous access handles).
 * No COOP/COEP headers needed; requires a secure context (https or localhost) and a dedicated worker.
 * Only one tab/window can hold the database at a time; a second one gets an error saying so.
 */
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import type { Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import { readAnkiPackage } from "@wengu/anki";

import { SqliteWasmDatabase } from "../db/sqlite-wasm.js";
import { sqlJsShim } from "../db/sqljs-shim.js";
import { Engine } from "../engine/engine.js";
import type { ExportSink } from "../engine/engine.js";
import { MemoryMediaStore, OpfsMediaStore } from "../media/store.js";
import type { OpenOptions, Port } from "../rpc/protocol.js";
import { serve } from "../rpc/server.js";

const VFS_NAME = "wengu-sahpool";
const VFS_DIR = ".wengu-sahpool";
const LOCK_NAME = "wengu-database";

type PoolUtil = Awaited<ReturnType<Sqlite3Static["installOpfsSAHPoolVfs"]>>;
let pool: PoolUtil | null = null;
let releaseLock: (() => void) | null = null;

/** Holds a Web Lock for as long as the database is open, so a second tab fails fast with a clear message. */
async function acquireLock(): Promise<void> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks) return;
  await new Promise<void>((resolve, reject) => {
    void locks.request(LOCK_NAME, { ifAvailable: true }, (lock) => {
      if (!lock) {
        reject(new Error("Wengu is already open in another tab or window. Close it there, then reload."));
        return undefined;
      }
      resolve();
      return new Promise<void>((release) => {
        releaseLock = release;
      });
    });
  });
}

export async function openEngine(options: OpenOptions): Promise<Engine> {
  // The init function accepts Emscripten module options (locateFile) although its typings do not say so.
  const init = sqlite3InitModule as unknown as (opts?: { locateFile?: (path: string) => string }) => Promise<Sqlite3Static>;
  const sqlite3 = await init(options.sqliteWasmUrl ? { locateFile: () => options.sqliteWasmUrl! } : {});
  const shim = sqlJsShim(sqlite3);
  const readPackage = (bytes: Uint8Array) => readAnkiPackage(bytes, { sqlJs: shim });
  if (options.storage === "memory") {
    const db = new SqliteWasmDatabase(sqlite3, new sqlite3.oo1.DB(":memory:", "c"));
    return Engine.open(db, new MemoryMediaStore(), { storage: "memory", sqliteVersion: sqlite3.version.libVersion, readPackage, sqlJs: shim });
  }
  await acquireLock();
  try {
    pool ??= await sqlite3.installOpfsSAHPoolVfs({ name: VFS_NAME, directory: VFS_DIR, initialCapacity: 6 });
    if (pool.isPaused()) await pool.unpauseVfs();
    const raw = new pool.OpfsSAHPoolDb(options.dbName ?? "/wengu.sqlite3");
    const db = new SqliteWasmDatabase(sqlite3, raw);
    // Exclusive locking: this connection is the only one (the Web Lock above guarantees it), so SQLite keeps its
    // page cache and skips the hot-journal / change-counter checks at the start of every transaction.
    // Rollback journal (the SAH pool VFS has no WAL), kept between transactions; synchronous=NORMAL.
    // (WAL also works in exclusive mode and halves the answer latency, ~17 ms vs ~32 ms at 20k notes, but the SAH
    // pool VFS does not officially support WAL and large imports get 2x slower; revisit if commits matter.)
    db.exec("PRAGMA locking_mode = EXCLUSIVE; PRAGMA journal_mode = PERSIST; PRAGMA synchronous = NORMAL;");
    const media = await OpfsMediaStore.open();
    const engine = Engine.open(db, media, { storage: "opfs-sahpool", sqliteVersion: sqlite3.version.libVersion, readPackage, sqlJs: shim, exportSink: opfsExportSink });
    // Page cache: up to 128 MB (a 50k-note collection with history is ~75 MB), so after first use reads rarely
    // touch OPFS. Memory grows only as pages are actually read.
    db.exec("PRAGMA cache_size = -131072");
    return engine;
  } catch (e) {
    releaseLock?.();
    releaseLock = null;
    throw e;
  }
}

/** Streams an export into OPFS (`wengu-exports/export-<time>.apkg`, older exports deleted) and returns the File. */
async function opfsExportSink(): Promise<ExportSink> {
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle("wengu-exports", { create: true });
  for await (const name of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) await dir.removeEntry(name).catch(() => undefined);
  const handle = await dir.getFileHandle(`export-${Date.now()}.apkg`, { create: true });
  const writable = await handle.createWritable();
  let chain: Promise<void> = Promise.resolve();
  let failure: unknown = null;
  return {
    // The writer hands over chunks synchronously; writes are chained (media chunks are not modified later).
    write(chunk) {
      chain = chain.then(() => writable.write(chunk as Uint8Array<ArrayBuffer>)).catch((e: unknown) => {
        failure ??= e;
      });
    },
    async close() {
      await chain;
      if (failure) throw failure;
      await writable.close();
      return handle.getFile();
    },
    async abort() {
      await chain;
      await writable.abort().catch(() => undefined);
    },
  };
}

export async function closeEngine(engine: Engine): Promise<void> {
  engine.db.close();
  pool?.pauseVfs();
  releaseLock?.();
  releaseLock = null;
}

let current: Engine | null = null;
/** The open engine (for diagnostics in the benchmark harness). */
export function currentEngine(): Engine | null {
  return current;
}

serve(self as unknown as Port, {
  open: async (o) => (current = await openEngine(o)),
  close: async (e) => {
    current = null;
    await closeEngine(e);
  },
});
