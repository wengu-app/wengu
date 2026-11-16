import type { Database, PreparedStatement, Sqlite3Static } from "@sqlite.org/sqlite-wasm";

import type { Row, RunResult, SqlDatabase, SqlParams, SqlValue } from "./driver.js";

/** The raw C exports the hot path calls (pointer-level; the oo1 wrappers cost ~10x more per value). */
interface RawExports {
  sqlite3_step(stmt: number): number;
  sqlite3_reset(stmt: number): number;
  sqlite3_clear_bindings(stmt: number): number;
  sqlite3_bind_int(stmt: number, i: number, v: number): number;
  sqlite3_bind_int64(stmt: number, i: number, v: bigint): number;
  sqlite3_bind_double(stmt: number, i: number, v: number): number;
  sqlite3_bind_text(stmt: number, i: number, ptr: number, n: number, destructor: number): number;
  sqlite3_bind_blob(stmt: number, i: number, ptr: number, n: number, destructor: number): number;
  sqlite3_bind_null(stmt: number, i: number): number;
  sqlite3_column_type(stmt: number, i: number): number;
  sqlite3_column_double(stmt: number, i: number): number;
  sqlite3_column_int64(stmt: number, i: number): bigint;
  sqlite3_column_text(stmt: number, i: number): number;
  sqlite3_column_blob(stmt: number, i: number): number;
  sqlite3_column_bytes(stmt: number, i: number): number;
  sqlite3_changes(db: number): number;
  sqlite3_errmsg(db: number): number;
}

const SQLITE_ROW = 100;
const SQLITE_DONE = 101;
const SQLITE_TRANSIENT = -1;
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

interface Stmt {
  oo1: PreparedStatement;
  ptr: number;
  columns: string[];
}

/**
 * `SqlDatabase` over the official SQLite WASM build. Statements are prepared once per SQL string (oo1 API) and
 * cached; binding, stepping and reading columns call the C exports directly.
 */
export class SqliteWasmDatabase implements SqlDatabase {
  private readonly cache = new Map<string, Stmt>();
  private readonly raw: RawExports;
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();
  private scratch = 0;
  private scratchSize = 0;
  private depth = 0;

  constructor(
    readonly sqlite3: Sqlite3Static,
    readonly db: Database,
  ) {
    this.raw = sqlite3.wasm.exports as unknown as RawExports;
  }

  private heap(): Uint8Array {
    return this.sqlite3.wasm.heap8u();
  }

  private ensureScratch(n: number): number {
    if (n > this.scratchSize) {
      if (this.scratch) this.sqlite3.wasm.dealloc(this.scratch);
      this.scratchSize = Math.max(n, this.scratchSize * 2, 4096);
      this.scratch = this.sqlite3.wasm.alloc(this.scratchSize) as unknown as number;
    }
    return this.scratch;
  }

  private check(rc: number): void {
    if (rc !== 0) throw this.error(rc);
  }

  private error(rc: number): Error {
    const ptr = this.raw.sqlite3_errmsg(this.db.pointer as unknown as number);
    const msg = this.sqlite3.wasm.cstrToJs(ptr as never);
    const e = new Error(`SQLite error ${rc}: ${msg}`);
    e.name = "SQLiteError";
    return e;
  }

  private stmt(sql: string): Stmt {
    let s = this.cache.get(sql);
    if (!s) {
      const oo1 = this.db.prepare(sql);
      s = { oo1, ptr: oo1.pointer as unknown as number, columns: oo1.columnCount ? oo1.getColumnNames() : [] };
      this.cache.set(sql, s);
    }
    return s;
  }

  private bind(s: Stmt, params: SqlParams | undefined): void {
    if (params === undefined) return;
    if (!Array.isArray(params)) throw new Error("named parameters are not supported; pass an array");
    const raw = this.raw;
    const p = s.ptr;
    for (let i = 0; i < params.length; i++) {
      const v = (params as readonly SqlValue[])[i];
      const idx = i + 1;
      let rc: number;
      if (v === null || v === undefined) rc = raw.sqlite3_bind_null(p, idx);
      else if (typeof v === "number") {
        if (Number.isInteger(v)) rc = v >= -2147483648 && v <= 2147483647 ? raw.sqlite3_bind_int(p, idx, v) : raw.sqlite3_bind_int64(p, idx, BigInt(v));
        else rc = raw.sqlite3_bind_double(p, idx, v);
      } else if (typeof v === "string") {
        const max = v.length * 3;
        const ptr = this.ensureScratch(max + 1);
        const { written } = this.encoder.encodeInto(v, this.heap().subarray(ptr, ptr + max));
        rc = raw.sqlite3_bind_text(p, idx, ptr, written, SQLITE_TRANSIENT);
      } else if (typeof v === "bigint") rc = raw.sqlite3_bind_int64(p, idx, v);
      else if (typeof v === "boolean") rc = raw.sqlite3_bind_int(p, idx, v ? 1 : 0);
      else if (v instanceof Uint8Array) {
        const ptr = this.ensureScratch(v.length + 1);
        this.heap().set(v, ptr);
        rc = raw.sqlite3_bind_blob(p, idx, ptr, v.length, SQLITE_TRANSIENT);
      } else throw new Error(`cannot bind value of type ${typeof v}`);
      if (rc !== 0) throw this.error(rc);
    }
  }

  private column(p: number, i: number): SqlValue {
    const raw = this.raw;
    switch (raw.sqlite3_column_type(p, i)) {
      case 1: {
        const d = raw.sqlite3_column_double(p, i);
        if (d > MAX_SAFE || d < -MAX_SAFE) return raw.sqlite3_column_int64(p, i);
        return d;
      }
      case 2:
        return raw.sqlite3_column_double(p, i);
      case 3: {
        const ptr = raw.sqlite3_column_text(p, i);
        const n = raw.sqlite3_column_bytes(p, i);
        return n ? this.decoder.decode(this.heap().subarray(ptr, ptr + n)) : "";
      }
      case 4: {
        const ptr = raw.sqlite3_column_blob(p, i);
        const n = raw.sqlite3_column_bytes(p, i);
        return n ? this.heap().slice(ptr, ptr + n) : new Uint8Array(0);
      }
      default:
        return null;
    }
  }

  /** Steps; true when a row is available. Throws on errors. */
  private step(s: Stmt): boolean {
    const rc = this.raw.sqlite3_step(s.ptr);
    if (rc === SQLITE_ROW) return true;
    if (rc === SQLITE_DONE) return false;
    throw this.error(rc);
  }

  private reset(s: Stmt): void {
    this.raw.sqlite3_reset(s.ptr);
    this.raw.sqlite3_clear_bindings(s.ptr);
  }

  private rowObject<T>(s: Stmt): T {
    const o: Record<string, SqlValue> = {};
    const names = s.columns;
    for (let i = 0; i < names.length; i++) o[names[i]!] = this.column(s.ptr, i);
    return o as T;
  }

  private rowArray(s: Stmt): SqlValue[] {
    const n = s.columns.length;
    const out = new Array<SqlValue>(n);
    for (let i = 0; i < n; i++) out[i] = this.column(s.ptr, i);
    return out;
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  run(sql: string, params?: SqlParams): RunResult {
    const s = this.stmt(sql);
    try {
      this.bind(s, params);
      while (this.step(s)) {
        /* drain */
      }
    } finally {
      this.reset(s);
    }
    return { changes: this.raw.sqlite3_changes(this.db.pointer as unknown as number) };
  }

  get<T = Row>(sql: string, params?: SqlParams): T | undefined {
    const s = this.stmt(sql);
    try {
      this.bind(s, params);
      return this.step(s) ? this.rowObject<T>(s) : undefined;
    } finally {
      this.reset(s);
    }
  }

  all<T = Row>(sql: string, params?: SqlParams): T[] {
    const s = this.stmt(sql);
    const out: T[] = [];
    try {
      this.bind(s, params);
      while (this.step(s)) out.push(this.rowObject<T>(s));
    } finally {
      this.reset(s);
    }
    return out;
  }

  values(sql: string, params?: SqlParams): SqlValue[][] {
    const s = this.stmt(sql);
    const out: SqlValue[][] = [];
    try {
      this.bind(s, params);
      while (this.step(s)) out.push(this.rowArray(s));
    } finally {
      this.reset(s);
    }
    return out;
  }

  value(sql: string, params?: SqlParams): SqlValue | undefined {
    const s = this.stmt(sql);
    try {
      this.bind(s, params);
      return this.step(s) ? this.column(s.ptr, 0) : undefined;
    } finally {
      this.reset(s);
    }
  }

  transaction<T>(fn: () => T): T {
    const depth = this.depth;
    const sp = `sp${depth}`;
    this.db.exec(depth === 0 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${sp}`);
    this.depth++;
    try {
      const r = fn();
      if (r instanceof Promise) throw new Error("transaction callbacks must be synchronous");
      this.depth--;
      this.db.exec(depth === 0 ? "COMMIT" : `RELEASE ${sp}`);
      return r;
    } catch (e) {
      this.depth = depth;
      this.db.exec(depth === 0 ? "ROLLBACK" : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
      throw e;
    }
  }

  close(): void {
    for (const s of this.cache.values()) s.oo1.finalize();
    this.cache.clear();
    if (this.scratch) this.sqlite3.wasm.dealloc(this.scratch);
    this.scratch = 0;
    this.scratchSize = 0;
    this.db.close();
  }

  exportBytes(): Uint8Array {
    return this.sqlite3.capi.sqlite3_js_db_export(this.db.pointer!);
  }

  /** Throws if `rc` is an error code (for callers using the C API directly). */
  checkRc(rc: number): void {
    this.check(rc);
  }
}

/** Opens an in-memory database pre-filled with `bytes` (an SQLite file image). */
export function deserializeDatabase(sqlite3: Sqlite3Static, bytes: Uint8Array): Database {
  if (bytes.length >= 20 && (bytes[18] === 2 || bytes[19] === 2)) {
    // A WAL-mode image (Anki's collections are): an in-memory database cannot have a WAL file, so mark the copy
    // as rollback-journal mode, as `sqlite3_deserialize` users must.
    bytes = bytes.slice();
    bytes[18] = 1;
    bytes[19] = 1;
  }
  const db = new sqlite3.oo1.DB(":memory:", "c");
  const p = sqlite3.wasm.allocFromTypedArray(bytes);
  const { capi } = sqlite3;
  const rc = capi.sqlite3_deserialize(
    db.pointer!,
    "main",
    p,
    bytes.byteLength,
    bytes.byteLength,
    capi.SQLITE_DESERIALIZE_FREEONCLOSE | capi.SQLITE_DESERIALIZE_RESIZEABLE,
  );
  db.checkRc(rc);
  return db;
}
