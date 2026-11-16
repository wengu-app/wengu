/** Browsing, searching and editing knowledge points. */
import type { Notetype } from "@wengu/anki";
import { clozeNumbers, htmlToText, renderCard } from "@wengu/anki";

import type { SqlValue } from "../db/driver.js";
import type {
  AddKnowledgePointInput,
  AddResult,
  BrowsePage,
  BrowseQuery,
  BrowseRow,
  ItemState,
  KnowledgePointDetail,
  UpdateKnowledgePointInput,
  UpdateResult,
} from "../types.js";
import type { Engine } from "./engine.js";
import type { UndoRecorder } from "./undo.js";
import type { ItemRow, KpRow } from "./rows.js";
import { FIELD_SEP, ITEM_COLS, ITEM_INSERT, KP_INSERT, itemToPublic, itemValues, kpToPublic, kpValues, noteTypeToPublic } from "./rows.js";
import { itemStateOf } from "./scheduler.js";
import { fieldChecksum, newGuid, normaliseSearch, normaliseTags, searchText, sortFieldText, splitTags } from "./text.js";

const totalCache = new WeakMap<Engine, { key: string; total: number }>();

export function search(e: Engine, q: BrowseQuery): BrowsePage {
  const where: string[] = [];
  const params: SqlValue[] = [];
  const terms = normaliseSearch(q.text ?? "").split(" ").filter(Boolean);
  for (const term of terms) {
    if ([...term].length >= 3) {
      // trigram index: substring match without reading the rows
      where.push("k.id IN (SELECT rowid FROM knowledge_points_fts WHERE knowledge_points_fts MATCH ?)");
      params.push(`"${term.replace(/"/g, '""')}"`);
    } else {
      // 1–2 characters (common for CJK): the trigram index cannot help; scan the stored text
      where.push("instr(k.search_text, ?) > 0");
      params.push(term);
    }
  }
  let deckList: number[] | null = null;
  if (q.deckId !== undefined) {
    deckList = q.includeSubdecks === false ? [q.deckId] : e.subtree(q.deckId);
  }
  for (const tag of q.tags ?? []) {
    // the tag itself, or a child "tag::…" (range on the NOCASE index; ';' follows ':')
    where.push("k.id IN (SELECT kp_id FROM knowledge_point_tags WHERE tag = ? OR (tag >= ? AND tag < ?))");
    params.push(tag, `${tag}::`, `${tag}:;`);
  }
  if (q.noteTypeId !== undefined) {
    where.push("k.note_type_id = ?");
    params.push(q.noteTypeId);
  }
  const t = e.timing();
  let stateCond: string | null = null;
  switch (q.state) {
    case undefined:
      break;
    case "new":
      stateCond = "queue = 0";
      break;
    case "learning":
      stateCond = "queue IN (1, 3, 4)";
      break;
    case "review":
      stateCond = "queue = 2";
      break;
    case "due":
      stateCond = `(queue IN (2, 3) AND due <= ${t.today}) OR (queue IN (1, 4) AND due <= ${Math.floor(t.nextDayAtMs / 1000)})`;
      break;
    case "suspended":
      stateCond = "queue = -1";
      break;
    case "buried":
      stateCond = "queue IN (-2, -3)";
      break;
    case "flagged":
      stateCond = "(flags & 7) != 0";
      break;
  }
  // Item conditions as an IN subquery: answered from the (deck_id, queue, due) / (queue, due) indexes.
  const deckCond = deckList ? `deck_id IN (${deckList.map((d) => Math.trunc(d)).join(",") || "NULL"})` : null;
  const itemConds = [deckCond, stateCond && `(${stateCond})`].filter(Boolean);
  if (itemConds.length) {
    // With a text condition the candidate set is already small: probe each candidate's items (EXISTS).
    // Otherwise collect matching items through the (deck_id, queue, due) / (queue, due) indexes (IN).
    if (terms.length) where.push(`EXISTS (SELECT 1 FROM review_items WHERE kp_id = k.id AND ${itemConds.join(" AND ")})`);
    else where.push(`k.id IN (SELECT kp_id FROM review_items WHERE ${itemConds.join(" AND ")})`);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const by = q.sort?.by ?? "created";
  const dir = (q.sort?.direction ?? (by === "sortField" ? "asc" : "desc")) === "asc" ? "ASC" : "DESC";
  const order = by === "modified" ? `k.mtime ${dir}, k.id ${dir}` : by === "sortField" ? `k.sort_field COLLATE NOCASE ${dir}, k.id ${dir}` : `k.id ${dir}`;
  const limit = Math.min(Math.max(1, Math.trunc(q.limit ?? 50)), 1000);
  const offset = Math.max(0, Math.trunc(q.offset ?? 0));

  // The total is cached while the collection is unchanged (paging and re-sorting reuse it).
  const changes = Number(e.db.value("SELECT total_changes()") ?? 0);
  const key = JSON.stringify([whereSql, params, changes]);
  let total: number;
  if (totalCache.get(e)?.key === key) total = totalCache.get(e)!.total;
  else {
    total = Number(e.db.value(`SELECT count(*) FROM knowledge_points k ${whereSql}`, params) ?? 0);
    totalCache.set(e, { key, total });
  }
  const kps = e.db.all<Pick<KpRow, "id" | "note_type_id" | "sort_field" | "tags" | "mtime">>(
    `SELECT k.id, k.note_type_id, k.sort_field, k.tags, k.mtime FROM knowledge_points k ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  const rows: BrowseRow[] = [];
  if (kps.length) {
    const items = e.db.all<Pick<ItemRow, "kp_id" | "deck_id" | "type" | "queue">>(
      `SELECT kp_id, deck_id, type, queue FROM review_items WHERE kp_id IN (${kps.map((k) => k.id).join(",")})`,
    );
    const byKp = new Map<number, typeof items>();
    for (const it of items) {
      const l = byKp.get(it.kp_id);
      if (l) l.push(it);
      else byKp.set(it.kp_id, [it]);
    }
    for (const k of kps) {
      const its = byKp.get(k.id) ?? [];
      const states = [...new Set(its.map((i) => itemStateOf(i.type)))] as ItemState[];
      rows.push({
        id: k.id,
        noteTypeId: k.note_type_id,
        noteTypeName: e.noteTypes.get(k.note_type_id)?.name ?? "",
        sortField: htmlToText(String(k.sort_field ?? "")).slice(0, 200),
        tags: splitTags(k.tags),
        deckIds: [...new Set(its.map((i) => i.deck_id))],
        itemCount: its.length,
        states,
        suspended: its.length > 0 && its.every((i) => i.queue === -1),
        createdAt: k.id,
        modifiedAt: k.mtime * 1000,
      });
    }
  }
  return { total, offset, limit, rows };
}

export function getKnowledgePoint(e: Engine, id: number): KnowledgePointDetail | null {
  const kp = e.getKpRow(id);
  if (!kp) return null;
  const nt = e.noteTypes.get(kp.note_type_id);
  if (!nt) return null;
  const days = e.schedulerDays();
  const items = e.db.all<ItemRow>(`SELECT ${ITEM_COLS} FROM review_items WHERE kp_id = ? ORDER BY ord`, [id]);
  const deckNames: Record<number, string> = {};
  for (const it of items) deckNames[it.deck_id] = e.decks.get(it.deck_id)?.name ?? "";
  return {
    ...kpToPublic(kp),
    noteType: noteTypeToPublic(nt),
    fieldNames: nt.fields.map((f) => f.name),
    items: items.map((r) => itemToPublic(r, (d) => days.dayStart(d))),
    deckNames,
  };
}

/** Derived columns of a knowledge point from its fields. */
function derived(nt: Notetype, fields: string[]): Pick<KpRow, "sort_field" | "checksum" | "search_text"> {
  return {
    sort_field: sortFieldText(fields[nt.sortFieldIndex] ?? ""),
    checksum: fieldChecksum(fields[0] ?? ""),
    search_text: searchText(fields),
  };
}

function fitFields(nt: Notetype, fields: readonly string[]): string[] {
  return nt.fields.map((_, i) => (fields[i] ?? "").replace(/\x1f/g, " "));
}

/** Template ordinals a note needs review items for: non-empty fronts (normal) or cloze numbers (cloze). */
export function requiredOrds(nt: Notetype, fields: string[]): number[] {
  if (nt.kind === "cloze") {
    const nums = new Set<number>();
    for (const f of fields) for (const n of clozeNumbers(f)) nums.add(n);
    return nums.size ? [...nums].sort((a, b) => a - b).map((n) => n - 1) : [0];
  }
  const empty = nt.fields.map(() => "");
  const ords: number[] = [];
  for (const t of nt.templates) {
    const withFields = renderCard({ notetype: nt, note: { fields, tags: [] }, cardOrd: t.ord }).question;
    const blank = renderCard({ notetype: nt, note: { fields: empty, tags: [] }, cardOrd: t.ord }).question;
    if (withFields !== blank) ords.push(t.ord);
  }
  return ords;
}

/** Writes a knowledge point's tags (row, tag index, registry). */
export function writeTags(e: Engine, kpId: number, tags: readonly string[], nowSecs: number): void {
  const clean = normaliseTags(tags);
  e.db.run("UPDATE knowledge_points SET tags = ?, mtime = ?, usn = -1 WHERE id = ?", [clean.join(" "), nowSecs, kpId]);
  e.db.run("DELETE FROM knowledge_point_tags WHERE kp_id = ?", [kpId]);
  for (const t of clean) {
    e.db.run("INSERT OR IGNORE INTO knowledge_point_tags (tag, kp_id) VALUES (?, ?)", [t, kpId]);
    e.db.run("INSERT OR IGNORE INTO tags (name, usn, collapsed) VALUES (?, -1, 0)", [t]);
  }
}

function newItemsFor(e: Engine, kpId: number, nt: Notetype, ords: number[], deckId: number, nowSecs: number, undo: UndoRecorder): number[] {
  const config = e.ankiConfig();
  let pos = typeof config["nextPos"] === "number" ? (config["nextPos"] as number) : 1;
  const maxNewDue = Number(e.db.value("SELECT coalesce(max(due), 0) FROM review_items WHERE type = 0") ?? 0);
  pos = Math.max(pos, maxNewDue + 1);
  const ids: number[] = [];
  for (const ord of ords) {
    const template = nt.kind === "cloze" ? null : nt.templates.find((t) => t.ord === ord);
    const target = template?.targetDeckId && e.decks.has(template.targetDeckId) ? template.targetDeckId : deckId;
    const id = e.newId("review_items");
    const row: ItemRow = {
      id,
      kp_id: kpId,
      deck_id: target,
      ord,
      mtime: nowSecs,
      usn: -1,
      type: 0,
      queue: 0,
      due: pos,
      ivl: 0,
      factor: 0,
      reps: 0,
      lapses: 0,
      left: 0,
      odue: 0,
      odid: 0,
      flags: 0,
      data: "{}",
    };
    undo.item(id);
    e.db.run(ITEM_INSERT, [...itemValues(row)]);
    ids.push(id);
  }
  e.setMeta("config", { ...config, nextPos: pos + 1 });
  e.invalidateTotals();
  return ids;
}

export function addKnowledgePoint(e: Engine, input: AddKnowledgePointInput): AddResult {
  const nt = e.noteTypes.get(input.noteTypeId);
  if (!nt) throw new Error(`no note type ${input.noteTypeId}`);
  if (!e.decks.has(input.deckId)) throw new Error(`no deck ${input.deckId}`);
  const fields = fitFields(nt, input.fields);
  const ords = requiredOrds(nt, fields);
  if (!ords.length) throw new Error("the knowledge point would have no review items: fill in the fields its card templates use");
  const nowSecs = Math.floor(e.clock.now() / 1000);
  return e.undoable("Add", (undo) => {
    const id = e.newId("knowledge_points");
    let guid = newGuid();
    while (e.db.value("SELECT 1 FROM knowledge_points WHERE guid = ?", [guid])) guid = newGuid();
    const row: KpRow = { id, guid, note_type_id: nt.id, mtime: nowSecs, usn: -1, tags: "", fields: fields.join(FIELD_SEP), flags: 0, data: "", ...derived(nt, fields) };
    undo.kp(id);
    e.db.run(KP_INSERT, [...kpValues(row)]);
    writeTags(e, id, input.tags ?? [], nowSecs);
    const itemIds = newItemsFor(e, id, nt, ords, input.deckId, nowSecs, undo);
    e.touch();
    return { id, itemIds };
  });
}

export function updateKnowledgePoint(e: Engine, input: UpdateKnowledgePointInput): UpdateResult {
  const kp = e.getKpRow(input.id);
  if (!kp) throw new Error(`no knowledge point ${input.id}`);
  const nt = e.noteTypes.get(kp.note_type_id);
  if (!nt) throw new Error(`note type ${kp.note_type_id} missing`);
  const nowSecs = Math.floor(e.clock.now() / 1000);
  return e.undoable("Edit", (undo) => {
    undo.kp(kp.id);
    let added: number[] = [];
    if (input.fields) {
      const fields = fitFields(nt, input.fields);
      const joined = fields.join(FIELD_SEP);
      if (joined !== kp.fields) {
        const d = derived(nt, fields);
        e.db.run("UPDATE knowledge_points SET fields = ?, sort_field = ?, checksum = ?, search_text = ?, mtime = ?, usn = -1 WHERE id = ?", [
          joined,
          d.sort_field,
          d.checksum,
          d.search_text,
          nowSecs,
          kp.id,
        ]);
        const existing = e.db.all<{ ord: number; deck_id: number }>("SELECT ord, deck_id FROM review_items WHERE kp_id = ? ORDER BY ord", [kp.id]);
        const have = new Set(existing.map((r) => r.ord));
        const missing = requiredOrds(nt, fields).filter((o) => !have.has(o));
        if (missing.length) {
          const deckId = existing[0]?.deck_id ?? e.createDeck("Default");
          added = newItemsFor(e, kp.id, nt, missing, deckId, nowSecs, undo);
        }
      }
    }
    if (input.tags) {
      const next = normaliseTags(input.tags).join(" ");
      if (next !== kp.tags) writeTags(e, kp.id, input.tags, nowSecs);
    }
    e.touch();
    return { addedItemIds: added };
  });
}

export function deleteKnowledgePoints(e: Engine, ids: number[]): number {
  let n = 0;
  e.undoable("Delete", (undo) => {
    for (const id of ids) {
      if (!e.db.value("SELECT 1 FROM knowledge_points WHERE id = ?", [id])) continue;
      undo.kp(id);
      for (const r of e.db.values("SELECT id FROM review_items WHERE kp_id = ?", [id])) undo.item(Number(r[0]));
      e.db.run("DELETE FROM review_items WHERE kp_id = ?", [id]);
      e.db.run("DELETE FROM knowledge_point_tags WHERE kp_id = ?", [id]);
      e.db.run("DELETE FROM presentations WHERE kp_id = ?", [id]);
      e.db.run("DELETE FROM knowledge_points WHERE id = ?", [id]);
      n++;
    }
    // Review history is kept (as Anki does), so statistics stay complete.
    e.touch();
  });
  e.invalidateTotals();
  return n;
}
