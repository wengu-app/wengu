import type { Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import type { ReadOptions } from "@wengu/anki";

import { deserializeDatabase } from "./sqlite-wasm.js";

type SqlJsStatic = NonNullable<ReadOptions["sqlJs"]>;

/**
 * The subset of sql.js that @wengu/anki's reader and writer use (`new Database(bytes?)`, `exec`, `run`,
 * `prepare().run/free`, `export`, `close`), implemented on the SQLite WASM build the core already loads. This way
 * the worker reads and writes `.apkg` files without loading (and serving) a second SQLite WebAssembly binary.
 */
export function sqlJsShim(sqlite3: Sqlite3Static): SqlJsStatic {
  class Database {
    private readonly db;
    constructor(bytes?: Uint8Array) {
      this.db = bytes ? deserializeDatabase(sqlite3, bytes) : new sqlite3.oo1.DB(":memory:", "c");
    }
    exec(sql: string): { columns: string[]; values: unknown[][] }[] {
      const values: never[] = [];
      const columns: string[] = [];
      this.db.exec({ sql, rowMode: "array", resultRows: values, columnNames: columns });
      return columns.length ? [{ columns, values }] : [];
    }
    run(sql: string, params?: unknown[]): this {
      this.db.exec({ sql, ...(params ? { bind: params as never } : {}) });
      return this;
    }
    prepare(sql: string) {
      const stmt = this.db.prepare(sql);
      return {
        run(params?: unknown[]): void {
          if (params && params.length) stmt.bind(params as never);
          stmt.stepReset();
          stmt.clearBindings();
        },
        free(): boolean {
          stmt.finalize();
          return true;
        },
      };
    }
    export(): Uint8Array {
      return sqlite3.capi.sqlite3_js_db_export(this.db.pointer!);
    }
    close(): void {
      this.db.close();
    }
  }
  return { Database } as unknown as SqlJsStatic;
}
