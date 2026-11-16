/**
 * Node entry: the engine over an in-memory SQLite (the same WASM build and schema as the browser), for tests,
 * benchmarks and tools. The official SQLite WASM build has no persistent file storage in Node; `exportBytes()`
 * / `bytes` let tests simulate closing and reopening a collection.
 */
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import type { Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import { readAnkiPackage } from "@wengu/anki";

import { SqliteWasmDatabase, deserializeDatabase } from "./db/sqlite-wasm.js";
import { sqlJsShim } from "./db/sqljs-shim.js";
import { Engine } from "./engine/engine.js";
import type { EngineOptions } from "./engine/engine.js";
import type { MediaStore } from "./media/store.js";
import { MemoryMediaStore } from "./media/store.js";

let sqlite3Promise: Promise<Sqlite3Static> | null = null;

export function loadSqlite(): Promise<Sqlite3Static> {
  sqlite3Promise ??= sqlite3InitModule();
  return sqlite3Promise;
}

export interface NodeEngineOptions extends Omit<EngineOptions, "readPackage" | "storage" | "sqliteVersion"> {
  /** Start from a database image (from `engine.db.exportBytes()`). */
  bytes?: Uint8Array;
  media?: MediaStore;
}

export async function openNodeEngine(opts: NodeEngineOptions = {}): Promise<Engine> {
  const sqlite3 = await loadSqlite();
  const raw = opts.bytes ? deserializeDatabase(sqlite3, opts.bytes) : new sqlite3.oo1.DB(":memory:", "c");
  const db = new SqliteWasmDatabase(sqlite3, raw);
  const shim = sqlJsShim(sqlite3);
  return Engine.open(db, opts.media ?? new MemoryMediaStore(), {
    ...opts,
    storage: "memory",
    sqliteVersion: sqlite3.version.libVersion,
    readPackage: (bytes) => readAnkiPackage(bytes, { sqlJs: shim }),
  });
}

export { Engine } from "./engine/engine.js";
export { ManualClock } from "./engine/time.js";
export { MemoryMediaStore } from "./media/store.js";
