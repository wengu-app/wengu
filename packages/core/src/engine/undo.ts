/**
 * Undo: before an undoable operation changes a row, the row's current image is recorded; undo writes the
 * images back. Steps are stored in `undo_steps`, so undo also works after the app is reopened.
 */
import type { SqlDatabase } from "../db/driver.js";
import type { UndoResult } from "../types.js";
import type { Engine } from "./engine.js";
import type { DeckStatsRow, ItemRow, KpRow } from "./rows.js";
import { ITEM_COLS, ITEM_INSERT, KP_INSERT, itemValues, kpValues } from "./rows.js";
import { splitTags } from "./text.js";

interface Payload {
  items: [number, ItemRow | null][];
  kps: [number, KpRow | null][];
  revlogInserted: number[];
  deckStats: DeckStatsRow[];
  /** Whole deck rows (deck deletion); absent in steps recorded by older versions. */
  decks?: Record<string, unknown>[];
}

export class UndoRecorder {
  private readonly payload: Payload = { items: [], kps: [], revlogInserted: [], deckStats: [] };
  private readonly seenItems = new Set<number>();
  private readonly seenKps = new Set<number>();
  private readonly seenDecks = new Set<number>();

  constructor(
    private readonly db: SqlDatabase,
    readonly label: string,
  ) {}

  /** Records an item's current row (null if it does not exist yet, i.e. the operation creates it). */
  item(id: number): void {
    if (this.seenItems.has(id)) return;
    this.seenItems.add(id);
    this.payload.items.push([id, this.db.get<ItemRow>(`SELECT ${ITEM_COLS} FROM review_items WHERE id = ?`, [id]) ?? null]);
  }

  kp(id: number): void {
    if (this.seenKps.has(id)) return;
    this.seenKps.add(id);
    this.payload.kps.push([id, this.db.get<KpRow>("SELECT * FROM knowledge_points WHERE id = ?", [id]) ?? null]);
  }

  revlogInserted(id: number): void {
    this.payload.revlogInserted.push(id);
  }

  deckStats(id: number): void {
    if (this.seenDecks.has(id)) return;
    this.seenDecks.add(id);
    const r = this.db.get<DeckStatsRow>("SELECT id, last_day_studied, new_studied, review_studied, learning_studied, ms_studied FROM decks WHERE id = ?", [id]);
    if (r) this.payload.deckStats.push(r);
  }

  /** Records a whole deck row (before deleting it). */
  deck(id: number): void {
    const r = this.db.get<Record<string, unknown>>("SELECT * FROM decks WHERE id = ?", [id]);
    if (r) (this.payload.decks ??= []).push(r);
  }

  get empty(): boolean {
    const p = this.payload;
    return !p.items.length && !p.kps.length && !p.revlogInserted.length && !p.deckStats.length && !p.decks?.length;
  }

  commit(nowMs: number, limit: number): void {
    if (this.empty) return;
    this.db.run("INSERT INTO undo_steps (label, created_at, payload) VALUES (?, ?, ?)", [this.label, nowMs, JSON.stringify(this.payload)]);
    // Prune old steps only every 16th step: each write transaction pays per page it touches (~2 ms on OPFS),
    // and the oldest steps live on another page than the newest.
    const id = Number(this.db.value("SELECT last_insert_rowid()") ?? 0);
    if (id % 16 === 0) this.db.run("DELETE FROM undo_steps WHERE id <= ?", [id - limit]);
  }
}

export function clearUndo(db: SqlDatabase): void {
  db.run("DELETE FROM undo_steps");
}

export function applyUndo(e: Engine): Omit<UndoResult, "code" | "state"> | null {
  const db = e.db;
  const step = db.get<{ id: number; label: string; payload: string }>("SELECT id, label, payload FROM undo_steps ORDER BY id DESC LIMIT 1");
  if (!step) return null;
  const p = JSON.parse(step.payload) as Payload;
  for (const id of p.revlogInserted) db.run("DELETE FROM revlog WHERE id = ?", [id]);
  for (const d of p.decks ?? []) {
    const cols = Object.keys(d);
    db.run(`INSERT OR REPLACE INTO decks (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, cols.map((c) => d[c] as never));
  }
  for (const s of p.deckStats) {
    db.run("UPDATE decks SET last_day_studied = ?, new_studied = ?, review_studied = ?, learning_studied = ?, ms_studied = ? WHERE id = ?", [
      s.last_day_studied,
      s.new_studied,
      s.review_studied,
      s.learning_studied,
      s.ms_studied,
      s.id,
    ]);
  }
  for (const [id, row] of [...p.kps].reverse()) {
    if (row === null) {
      db.run("DELETE FROM knowledge_points WHERE id = ?", [id]);
      db.run("DELETE FROM knowledge_point_tags WHERE kp_id = ?", [id]);
      continue;
    }
    const exists = db.value("SELECT 1 FROM knowledge_points WHERE id = ?", [id]);
    if (exists) {
      db.run(
        "UPDATE knowledge_points SET guid = ?, note_type_id = ?, mtime = ?, usn = ?, tags = ?, fields = ?, sort_field = ?, checksum = ?, flags = ?, data = ?, search_text = ? WHERE id = ?",
        [row.guid, row.note_type_id, row.mtime, row.usn, row.tags, row.fields, row.sort_field, row.checksum, row.flags, row.data, row.search_text, id],
      );
    } else db.run(KP_INSERT, [...kpValues(row)]);
    db.run("DELETE FROM knowledge_point_tags WHERE kp_id = ?", [id]);
    for (const t of splitTags(row.tags)) db.run("INSERT OR IGNORE INTO knowledge_point_tags (tag, kp_id) VALUES (?, ?)", [t, id]);
    for (const t of splitTags(row.tags)) db.run("INSERT OR IGNORE INTO tags (name, usn, collapsed) VALUES (?, -1, 0)", [t]);
  }
  for (const [id, row] of [...p.items].reverse()) {
    db.run("DELETE FROM review_items WHERE id = ?", [id]);
    if (row) db.run(ITEM_INSERT, [...itemValues(row)]);
  }
  db.run("DELETE FROM undo_steps WHERE id = ?", [step.id]);
  e.invalidateTotals();
  return { label: step.label, itemIds: p.items.map(([id]) => id) };
}
