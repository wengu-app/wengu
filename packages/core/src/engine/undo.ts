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

  get empty(): boolean {
    const p = this.payload;
    return !p.items.length && !p.kps.length && !p.revlogInserted.length && !p.deckStats.length;
  }

  commit(nowMs: number, limit: number): void {
    if (this.empty) return;
    this.db.run("INSERT INTO undo_steps (label, created_at, payload) VALUES (?, ?, ?)", [this.label, nowMs, JSON.stringify(this.payload)]);
    this.db.run("DELETE FROM undo_steps WHERE id <= (SELECT max(id) FROM undo_steps) - ?", [limit]);
  }
}

export function clearUndo(db: SqlDatabase): void {
  db.run("DELETE FROM undo_steps");
}

export function applyUndo(e: Engine): UndoResult | null {
  const db = e.db;
  const step = db.get<{ id: number; label: string; payload: string }>("SELECT id, label, payload FROM undo_steps ORDER BY id DESC LIMIT 1");
  if (!step) return null;
  const p = JSON.parse(step.payload) as Payload;
  for (const id of p.revlogInserted) db.run("DELETE FROM revlog WHERE id = ?", [id]);
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
