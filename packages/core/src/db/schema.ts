import type { SqlDatabase } from "./driver.js";

/**
 * Schema migrations. Append-only: never edit a released migration, add a new one.
 * `schema_migrations` records every applied version; `migrate()` applies the missing ones in order,
 * each in its own transaction.
 */
export interface Migration {
  version: number;
  name: string;
  up(db: SqlDatabase): void;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "initial schema",
    up(db) {
      db.exec(`
-- Collection-level values (JSON-encoded): crt, mod, scm, usn, ls, config (Anki's), settings (Wengu's).
CREATE TABLE collection (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Anki note types. 'data' is the full @wengu/anki Notetype as JSON (fields, templates, css, extra).
CREATE TABLE note_types (
  id    INTEGER PRIMARY KEY,
  name  TEXT NOT NULL,
  kind  TEXT NOT NULL,
  mtime INTEGER NOT NULL,
  data  TEXT NOT NULL
);

-- Deck option presets ('data' = DeckConfig JSON).
CREATE TABLE deck_presets (
  id    INTEGER PRIMARY KEY,
  name  TEXT NOT NULL,
  mtime INTEGER NOT NULL,
  data  TEXT NOT NULL
);

-- Decks ('data' = Deck JSON without the daily counters, which live in columns because every answer updates them).
CREATE TABLE decks (
  id               INTEGER PRIMARY KEY,
  name             TEXT NOT NULL COLLATE NOCASE UNIQUE,
  kind             TEXT NOT NULL,
  preset_id        INTEGER,
  mtime            INTEGER NOT NULL,
  last_day_studied INTEGER NOT NULL DEFAULT 0,
  new_studied      INTEGER NOT NULL DEFAULT 0,
  review_studied   INTEGER NOT NULL DEFAULT 0,
  learning_studied INTEGER NOT NULL DEFAULT 0,
  ms_studied       INTEGER NOT NULL DEFAULT 0,
  data             TEXT NOT NULL
);

-- Knowledge points (an Anki note maps to one). Columns mirror Anki's notes table so nothing is lost.
CREATE TABLE knowledge_points (
  id           INTEGER PRIMARY KEY,
  guid         TEXT NOT NULL UNIQUE,
  note_type_id INTEGER NOT NULL,
  mtime        INTEGER NOT NULL,   -- unix seconds
  usn          INTEGER NOT NULL,
  tags         TEXT NOT NULL,      -- space-separated
  fields       TEXT NOT NULL,      -- field HTML joined by U+001F
  sort_field,                      -- as Anki stored it (text or integer), no affinity
  checksum     INTEGER NOT NULL,
  flags        INTEGER NOT NULL,
  data         TEXT NOT NULL,
  search_text  TEXT NOT NULL       -- plain text of all fields, lower-cased, for search
);
CREATE INDEX knowledge_points_note_type ON knowledge_points (note_type_id);
CREATE INDEX knowledge_points_mtime ON knowledge_points (mtime);
CREATE INDEX knowledge_points_sort ON knowledge_points (sort_field COLLATE NOCASE, id);

CREATE TABLE knowledge_point_tags (
  tag   TEXT NOT NULL COLLATE NOCASE,
  kp_id INTEGER NOT NULL,
  PRIMARY KEY (tag, kp_id)
) WITHOUT ROWID;
CREATE INDEX knowledge_point_tags_kp ON knowledge_point_tags (kp_id);

-- Tag registry (Anki's tags table: usn, collapsed state).
CREATE TABLE tags (
  name      TEXT PRIMARY KEY COLLATE NOCASE,
  usn       INTEGER,
  collapsed INTEGER NOT NULL DEFAULT 0
);

-- Substring search over field text (trigram: works for CJK; LIKE patterns use the index from 3 characters).
CREATE VIRTUAL TABLE knowledge_points_fts USING fts5(
  search_text, content = 'knowledge_points', content_rowid = 'id', tokenize = 'trigram'
);
CREATE TRIGGER knowledge_points_ai AFTER INSERT ON knowledge_points BEGIN
  INSERT INTO knowledge_points_fts (rowid, search_text) VALUES (new.id, new.search_text);
END;
CREATE TRIGGER knowledge_points_ad AFTER DELETE ON knowledge_points BEGIN
  INSERT INTO knowledge_points_fts (knowledge_points_fts, rowid, search_text) VALUES ('delete', old.id, old.search_text);
END;
CREATE TRIGGER knowledge_points_au AFTER UPDATE OF search_text ON knowledge_points BEGIN
  INSERT INTO knowledge_points_fts (knowledge_points_fts, rowid, search_text) VALUES ('delete', old.id, old.search_text);
  INSERT INTO knowledge_points_fts (rowid, search_text) VALUES (new.id, new.search_text);
END;

-- Review items (an Anki card maps to one): memory state and schedule. Columns mirror Anki's cards table;
-- 'data' is Anki's card data JSON (FSRS memory state s/d, dr, decay, lrt, pos, ...), kept verbatim.
CREATE TABLE review_items (
  id      INTEGER PRIMARY KEY,
  kp_id   INTEGER NOT NULL,
  deck_id INTEGER NOT NULL,
  ord     INTEGER NOT NULL,
  mtime   INTEGER NOT NULL,
  usn     INTEGER NOT NULL,
  type    INTEGER NOT NULL,
  queue   INTEGER NOT NULL,
  due     INTEGER NOT NULL,
  ivl     INTEGER NOT NULL,
  factor  INTEGER NOT NULL,
  reps    INTEGER NOT NULL,
  lapses  INTEGER NOT NULL,
  left    INTEGER NOT NULL,
  odue    INTEGER NOT NULL,
  odid    INTEGER NOT NULL,
  flags   INTEGER NOT NULL,
  data    TEXT NOT NULL
);
CREATE INDEX review_items_kp ON review_items (kp_id, ord);
CREATE INDEX review_items_deck_queue_due ON review_items (deck_id, queue, due);
CREATE INDEX review_items_queue_due ON review_items (queue, due);

-- Presentations: ways to show a review item. The Anki template presentation of every review item is
-- implicit (note type template 'ord'); rows here are additional presentations of other kinds, attached to a
-- review item or to a whole knowledge point (review_item_id NULL).
CREATE TABLE presentations (
  id             INTEGER PRIMARY KEY,
  kp_id          INTEGER NOT NULL,
  review_item_id INTEGER,
  kind           TEXT NOT NULL,
  kind_version   INTEGER NOT NULL DEFAULT 1,
  status         TEXT NOT NULL DEFAULT 'active',
  payload        TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX presentations_kp ON presentations (kp_id);
CREATE INDEX presentations_item ON presentations (review_item_id);

-- Review log, as Anki's revlog (id = answer time in ms).
CREATE TABLE revlog (
  id       INTEGER PRIMARY KEY,
  card_id  INTEGER NOT NULL,
  usn      INTEGER NOT NULL,
  ease     INTEGER NOT NULL,
  ivl      INTEGER NOT NULL,
  last_ivl INTEGER NOT NULL,
  factor   INTEGER NOT NULL,
  taken    INTEGER NOT NULL,
  kind     INTEGER NOT NULL
);
CREATE INDEX revlog_card ON revlog (card_id, id);

-- Media: file name -> content hash; the bytes live in the media store (content-addressed), not here.
CREATE TABLE media (
  name     TEXT PRIMARY KEY,
  hash     TEXT NOT NULL,        -- SHA-256, lowercase hex
  size     INTEGER NOT NULL,
  sha1     TEXT,                 -- as given by the Anki manifest, if any
  position INTEGER NOT NULL,
  added_at INTEGER NOT NULL
);
CREATE INDEX media_hash ON media (hash);

-- Undo stack: row images taken before each undoable operation.
CREATE TABLE undo_steps (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  label      TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  payload    TEXT NOT NULL
);
`);
    },
  },
  {
    version: 2,
    name: "covering indexes for browse filters",
    up(db) {
      // Browse filters on items ("state", "deck") collect knowledge-point ids; with kp_id in the index that is an
      // index-only scan instead of one table lookup per item (state=review at 50k notes: 250 ms -> see bench).
      db.exec(`
DROP INDEX review_items_queue_due;
CREATE INDEX review_items_queue_due ON review_items (queue, due, kp_id);
DROP INDEX review_items_deck_queue_due;
CREATE INDEX review_items_deck_queue_due ON review_items (deck_id, queue, due, kp_id);
`);
    },
  },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

export function currentSchemaVersion(db: SqlDatabase): number {
  const exists = db.value("SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'");
  if (!exists) return 0;
  return Number(db.value("SELECT coalesce(max(version), 0) FROM schema_migrations") ?? 0);
}

/** Applies pending migrations. Returns the versions applied. Refuses databases from a newer Wengu. */
export function migrate(db: SqlDatabase, migrations: readonly Migration[] = MIGRATIONS, now = Date.now()): number[] {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)");
  const current = currentSchemaVersion(db);
  const latest = migrations.length ? migrations[migrations.length - 1]!.version : 0;
  if (current > latest) throw new Error(`database schema version ${current} is newer than this Wengu (${latest}); update the app`);
  const applied: number[] = [];
  for (const m of migrations) {
    if (m.version <= current) continue;
    db.transaction(() => {
      m.up(db);
      db.run("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)", [m.version, m.name, now]);
    });
    applied.push(m.version);
  }
  return applied;
}
