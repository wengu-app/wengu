import { unzipSync } from "fflate";
import { decompress as zstdDecompress } from "fzstd";
import initSqlJs from "sql.js";
import type { Database, SqlJsStatic, SqlValue } from "sql.js";

import type {
  AnkiPackage,
  Card,
  CardData,
  CardQueue,
  CardType,
  Collection,
  MediaFile,
  Note,
  PackageFormat,
  RevlogEntry,
  RevlogKind,
  Tag,
} from "./model.js";
import { ProtoMessage, utf8 } from "./protobuf.js";
import { readSchema11 } from "./schema11.js";
import { readSchema18 } from "./schema18.js";

export interface ReadOptions {
  /**
   * An initialised sql.js module. Recommended in browsers, where the caller
   * decides how the .wasm file is served. When omitted, `initSqlJs(sqlJsConfig)`
   * is called once and cached.
   */
  sqlJs?: SqlJsStatic;
  /** Passed to `initSqlJs()` when `sqlJs` is not given (e.g. `{ locateFile }`). */
  sqlJsConfig?: Parameters<typeof initSqlJs>[0];
  /** Read media file contents (default true). When false, `media[].data` is empty. */
  includeMedia?: boolean;
}

let cachedSqlJs: Promise<SqlJsStatic> | null = null;

export function getSqlJs(options: Pick<ReadOptions, "sqlJs" | "sqlJsConfig">): Promise<SqlJsStatic> {
  if (options.sqlJs) return Promise.resolve(options.sqlJs);
  if (options.sqlJsConfig) return initSqlJs(options.sqlJsConfig);
  cachedSqlJs ??= initSqlJs();
  return cachedSqlJs;
}

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd] as const;

function isZstd(b: Uint8Array): boolean {
  return b.length >= 4 && ZSTD_MAGIC.every((m, i) => b[i] === m);
}

const COLLECTION_ENTRIES = ["collection.anki21b", "collection.anki21", "collection.anki2"] as const;

/**
 * Read an Anki package (`.apkg` or `.colpkg`) into a typed model.
 *
 * Handles all package generations:
 *  - legacy 1: `collection.anki2` (schema 11), JSON media map, no `meta`;
 *  - legacy 2: `collection.anki21` (schema 11) + a dummy `collection.anki2`,
 *    JSON media map, `meta` = {version: 2} (or absent in 2.1.x < 2.1.50);
 *  - latest:   `collection.anki21b` (zstd, schema 18) + dummy `collection.anki2`,
 *    zstd protobuf media manifest, zstd media files, `meta` = {version: 3}.
 */
export async function readAnkiPackage(bytes: Uint8Array, options: ReadOptions = {}): Promise<AnkiPackage> {
  const warnings: string[] = [];
  const entries = unzipSync(bytes);

  // --- meta -----------------------------------------------------------------
  let metaVersion: number | null = null;
  if (entries["meta"]) {
    // PackageMetadata { Version version = 1; }
    metaVersion = new ProtoMessage(entries["meta"]).uint(1);
  }

  // --- pick the collection file ---------------------------------------------
  let collectionEntry: PackageFormat["collectionEntry"];
  if (metaVersion !== null && metaVersion >= 3) {
    if (!entries["collection.anki21b"]) throw new Error("package meta says 'latest' but collection.anki21b is missing");
    collectionEntry = "collection.anki21b";
    if (metaVersion > 3) warnings.push(`unknown package meta version ${metaVersion}; reading as latest`);
  } else {
    const found = COLLECTION_ENTRIES.find((e) => entries[e]);
    if (!found) throw new Error("not an Anki package: no collection.anki2/anki21/anki21b entry");
    collectionEntry = found;
  }
  let dbBytes: Uint8Array = entries[collectionEntry]!;
  const zstdCollection = isZstd(dbBytes);
  if (zstdCollection) dbBytes = zstdDecompress(dbBytes);

  // --- database -------------------------------------------------------------
  const SQL = await getSqlJs(options);
  const db = new SQL.Database(dbBytes);
  try {
    neutraliseUnicaseCollation(db);
    const tables = new Set(all(db, "SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => String(r[0])));
    const colRow = all(db, "SELECT crt, mod, scm, ver, usn, ls, conf, models, decks, dconf, tags FROM col")[0];
    if (!colRow) throw new Error("collection has no col row");
    const schemaVersion = num(colRow[3]);

    const modern = tables.has("notetypes");
    const parts = modern ? readSchema18(db, all) : readSchema11(colRow);

    const collection: Collection = {
      crt: num(colRow[0]),
      mod: num(colRow[1]),
      scm: num(colRow[2]),
      usn: num(colRow[4]),
      ls: num(colRow[5]),
      config: parts.config,
    };

    const notes: Note[] = all(db, "SELECT id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data FROM notes ORDER BY id").map(
      (r) => ({
        id: num(r[0]),
        guid: str(r[1]),
        notetypeId: num(r[2]),
        mtime: num(r[3]),
        usn: num(r[4]),
        tags: splitTags(str(r[5])),
        fields: str(r[6]).split("\x1f"),
        sortField: typeof r[7] === "number" ? r[7] : str(r[7]),
        checksum: num(r[8]),
        flags: num(r[9]),
        data: str(r[10]),
      }),
    );

    const cards: Card[] = all(
      db,
      "SELECT id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data FROM cards ORDER BY id",
    ).map((r) => {
      const rawData = str(r[17]);
      return {
        id: num(r[0]),
        noteId: num(r[1]),
        deckId: num(r[2]),
        ord: num(r[3]),
        mtime: num(r[4]),
        usn: num(r[5]),
        type: num(r[6]) as CardType,
        queue: num(r[7]) as CardQueue,
        due: num(r[8]),
        interval: num(r[9]),
        easeFactor: num(r[10]),
        reps: num(r[11]),
        lapses: num(r[12]),
        left: num(r[13]),
        originalDue: num(r[14]),
        originalDeckId: num(r[15]),
        flags: num(r[16]),
        data: parseCardData(rawData, warnings, num(r[0])),
        rawData,
      };
    });

    const revlog: RevlogEntry[] = all(db, "SELECT id, cid, usn, ease, ivl, lastIvl, factor, time, type FROM revlog ORDER BY id").map(
      (r) => ({
        id: num(r[0]),
        cardId: num(r[1]),
        usn: num(r[2]),
        ease: num(r[3]),
        interval: num(r[4]),
        lastInterval: num(r[5]),
        factor: num(r[6]),
        taken: num(r[7]),
        kind: num(r[8]) as RevlogKind,
      }),
    );

    // --- tags: registry + everything used on notes ---------------------------
    const tagMap = new Map<string, Tag>();
    for (const t of parts.tags) tagMap.set(t.name.toLowerCase(), t);
    for (const n of notes)
      for (const t of n.tags) if (!tagMap.has(t.toLowerCase())) tagMap.set(t.toLowerCase(), { name: t, usn: null, collapsed: false });
    const tags = [...tagMap.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    // --- media ----------------------------------------------------------------
    const { media, manifest } = readMedia(entries, options.includeMedia ?? true, warnings);

    const format: PackageFormat = {
      metaVersion,
      collectionEntry,
      schemaVersion,
      zstdCollection,
      mediaManifest: manifest,
    };

    // Integrity checks that are cheap and catch importer bugs early.
    const ntIds = new Set(parts.notetypes.map((n) => n.id));
    for (const n of notes) if (!ntIds.has(n.notetypeId)) warnings.push(`note ${n.id} references missing notetype ${n.notetypeId}`);
    const deckIds = new Set(parts.decks.map((d) => d.id));
    for (const c of cards) if (!deckIds.has(c.deckId)) warnings.push(`card ${c.id} references missing deck ${c.deckId}`);

    return {
      format,
      collection,
      notetypes: parts.notetypes,
      notes,
      cards,
      decks: parts.decks,
      deckConfigs: parts.deckConfigs,
      revlog,
      media,
      tags,
      warnings,
    };
  } finally {
    db.close();
  }
}

export type QueryFn = (db: Database, sql: string) => SqlValue[][];

const all: QueryFn = (db, sql) => {
  const res = db.exec(sql);
  return res[0]?.values ?? [];
};

/**
 * Anki declares text columns and indexes with a custom `unicase` collation.
 * sql.js cannot register collations, and SQLite refuses to prepare queries
 * that touch an index (or WITHOUT ROWID primary key) using an unknown
 * collation. We only ever full-scan our private in-memory copy, so we strip
 * the collation from the schema text and reload the schema.
 */
function neutraliseUnicaseCollation(db: Database): void {
  const n = all(db, "SELECT count(*) FROM sqlite_master WHERE sql LIKE '%COLLATE unicase%'")[0]?.[0];
  if (!n) return;
  db.exec(`PRAGMA writable_schema = ON;
UPDATE sqlite_master SET sql = replace(sql, 'COLLATE unicase', '') WHERE sql LIKE '%COLLATE unicase%';
PRAGMA writable_schema = RESET;`);
}

function readMedia(
  entries: Record<string, Uint8Array>,
  includeData: boolean,
  warnings: string[],
): { media: MediaFile[]; manifest: PackageFormat["mediaManifest"] } {
  const raw = entries["media"];
  if (!raw) return { media: [], manifest: "none" };
  const media: MediaFile[] = [];
  const load = (zipName: string, name: string): Uint8Array => {
    const d = entries[zipName];
    if (!d) {
      warnings.push(`media file "${name}" (zip entry ${zipName}) is missing from the package`);
      return new Uint8Array(0);
    }
    if (!includeData) return new Uint8Array(0);
    return isZstd(d) ? zstdDecompress(d) : d;
  };

  // Latest format: zstd-compressed protobuf. Legacy: JSON object {"0": "name"}.
  const decoded = isZstd(raw) ? zstdDecompress(raw) : raw;
  const text = utf8.decode(decoded);
  const looksJson = !isZstd(raw) && /^\s*\{/.test(text);
  if (looksJson) {
    const map = JSON.parse(text) as Record<string, string>;
    const keys = Object.keys(map).sort((a, b) => Number(a) - Number(b));
    for (const k of keys) media.push({ name: map[k]!, data: load(k, map[k]!), sha1: null });
    return { media, manifest: "json" };
  }
  // MediaEntries { repeated MediaEntry entries = 1; }
  // MediaEntry { string name = 1; uint32 size = 2; bytes sha1 = 3; optional uint32 legacy_zip_filename = 255; }
  const msg = new ProtoMessage(decoded);
  msg.messages(1).forEach((e, index) => {
    const name = e.string(1);
    const zipName = e.has(255) ? String(e.uint(255)) : String(index);
    const sha1 = e.bytes(3);
    const data = load(zipName, name);
    const size = e.uint(2);
    if (includeData && data.length !== size && entries[zipName]) warnings.push(`media "${name}": size ${data.length} != manifest ${size}`);
    media.push({ name, data, sha1: sha1 ? hex(sha1) : null });
  });
  return { media, manifest: "protobuf" };
}

export function parseCardData(raw: string, warnings: string[], cardId: number): CardData {
  const out: CardData = {
    originalPosition: null,
    memoryState: null,
    desiredRetention: null,
    decay: null,
    lastReviewTime: null,
    customData: null,
    extra: {},
  };
  if (!raw) return out;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    warnings.push(`card ${cardId}: unparseable data column`);
    out.extra["raw"] = raw;
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    switch (k) {
      case "pos":
        out.originalPosition = Number(v);
        break;
      case "s":
      case "d":
        break;
      case "dr":
        out.desiredRetention = Number(v);
        break;
      case "decay":
        out.decay = Number(v);
        break;
      case "lrt":
        out.lastReviewTime = Number(v);
        break;
      case "cd":
        out.customData = typeof v === "string" ? v : JSON.stringify(v);
        break;
      default:
        out.extra[k] = v;
    }
  }
  if (typeof obj["s"] === "number" && typeof obj["d"] === "number") {
    out.memoryState = { stability: obj["s"], difficulty: obj["d"] };
  }
  return out;
}

export function splitTags(s: string): string[] {
  return s.split(/[ 　]+/).filter((t) => t.length > 0);
}

export function num(v: SqlValue | undefined): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v);
  if (v === null || v === undefined) return 0;
  throw new Error("expected number, got blob");
}

export function str(v: SqlValue | undefined): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (v instanceof Uint8Array) return utf8.decode(v);
  return "";
}

function hex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}
