/**
 * Minimal synchronous SQL interface the engine is written against.
 *
 * There is exactly one implementation in production code (`SqliteWasmDatabase`, over the official
 * SQLite WebAssembly build), used both in the browser worker (OPFS) and in Node (in memory), so the
 * schema and every query run on the same SQLite build everywhere.
 */
export type SqlValue = number | string | Uint8Array | bigint | null;
export type SqlParams = readonly SqlValue[];
export type Row = Record<string, SqlValue>;

export interface RunResult {
  changes: number;
}

export interface SqlDatabase {
  /** Runs one or more statements without parameters. */
  exec(sql: string): void;
  run(sql: string, params?: SqlParams): RunResult;
  get<T = Row>(sql: string, params?: SqlParams): T | undefined;
  all<T = Row>(sql: string, params?: SqlParams): T[];
  /** Rows as arrays (cheaper than objects for bulk reads). */
  values(sql: string, params?: SqlParams): SqlValue[][];
  /** First column of the first row. */
  value(sql: string, params?: SqlParams): SqlValue | undefined;
  /** Runs `fn` in a transaction (a savepoint when nested). Rolls back if it throws. */
  transaction<T>(fn: () => T): T;
  close(): void;
  /** Serialises the whole database (tests, backups). */
  exportBytes(): Uint8Array;
}
