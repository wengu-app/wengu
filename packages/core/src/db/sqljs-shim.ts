import type { Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import type { ReadOptions } from "@wengu/anki";

import { SqliteWasmDatabase, deserializeDatabase } from "./sqlite-wasm.js";
import type { SqlValue } from "./driver.js";

type SqlJsStatic = NonNullable<ReadOptions["sqlJs"]>;

/**
 * The subset of sql.js that @wengu/anki's reader and writer use (`new Database(bytes?)`, `exec`, `run`,
 * `prepare().run/free`, `export`, `close`), implemented on the SQLite WASM build the core already loads. This way
 * the worker reads and writes `.apkg` files without loading (and serving) a second SQLite WebAssembly binary.
 */
export function sqlJsShim(sqlite3: Sqlite3Static): SqlJsStatic {
  class Database {
    private readonly db;
    /** Fast path (raw C exports) for the writer's bulk inserts. */
    private readonly fast;
    constructor(bytes?: Uint8Array) {
      this.db = bytes ? deserializeDatabase(sqlite3, bytes) : new sqlite3.oo1.DB(":memory:", "c");
      this.fast = new SqliteWasmDatabase(sqlite3, this.db);
    }
    exec(sql: string): { columns: string[]; values: unknown[][] }[] {
      const values: never[] = [];
      const columns: string[] = [];
      this.db.exec({ sql, rowMode: "array", resultRows: values, columnNames: columns });
      return columns.length ? [{ columns, values }] : [];
    }
    run(sql: string, params?: unknown[]): this {
      if (params && params.length) this.fast.run(sql, params as SqlValue[]);
      else this.db.exec(sql);
      return this;
    }
    prepare(sql: string) {
      const fast = this.fast;
      return {
        run(params?: unknown[]): void {
          fast.run(sql, (params ?? []) as SqlValue[]);
        },
        free(): boolean {
          return true; // cached statements are finalised on close()
        },
      };
    }
    export(): Uint8Array {
      return sqlite3.capi.sqlite3_js_db_export(this.db.pointer!);
    }
    close(): void {
      this.fast.close(); // finalises cached statements, then closes the database
    }
  }
  return { Database } as unknown as SqlJsStatic;
}
