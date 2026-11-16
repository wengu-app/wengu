/**
 * Importing an AnkiPackage.
 *
 * Into an empty collection, the package is taken over exactly (ids, timestamps, collection creation time and
 * config), so that exporting gives the same package back.
 *
 * Into a non-empty collection (re-import / another deck), matching follows Anki's importer:
 *  - note types by id; reused when fields and templates line up, updated if the incoming one is newer;
 *    an incompatible note type with the same id is added as a copy under a new id;
 *  - deck presets by id, updated if the incoming one is newer;
 *  - decks by name (case-insensitive), so re-importing a deck lands in the same deck;
 *  - knowledge points by guid: updated (fields, tags) only if the incoming note is newer, otherwise left alone;
 *  - review items by (knowledge point, template): existing ones keep their schedule (progress made here is
 *    never overwritten); missing ones are added with the package's schedule;
 *  - review log by id (answer time in ms): duplicates are skipped;
 *  - media by name: same content is skipped; different content under an existing name is stored under
 *    "name-<hash8>.ext" and the imported fields are rewritten to it.
 * Ids that are already taken by unrelated rows get fresh ids. Day-based due dates are shifted when the
 * package's collection was created on a different day than this one.
 */
import type { AnkiPackage, Card, Deck, Notetype } from "@wengu/anki";

import { sha256Hex } from "../media/store.js";
import type { ImportOptions, ImportPhase, ImportResult } from "../types.js";
import type { Engine } from "./engine.js";
import type { KpRow } from "./rows.js";
import { FIELD_SEP, ITEM_INSERT, KP_INSERT, REVLOG_INSERT, kpValues } from "./rows.js";
import { searchText, sortFieldText } from "./text.js";
import { clearUndo } from "./undo.js";

const DAY_DUE_LIMIT = 1_000_000_000;

function progressReporter(cb: ImportOptions["onProgress"]) {
  let last = 0;
  return (phase: ImportPhase, done: number, total: number, force = false) => {
    if (!cb) return;
    const now = Date.now();
    if (!force && now - last < 100 && done !== total) return;
    last = now;
    cb({ phase, done, total });
  };
}

function compatible(a: Notetype, b: Notetype): boolean {
  return (
    a.kind === b.kind &&
    a.fields.length === b.fields.length &&
    a.fields.every((f, i) => f.name === b.fields[i]!.name) &&
    a.templates.length === b.templates.length
  );
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether a card's due (or original due) counts days rather than seconds/positions. */
function dayBased(type: number, due: number): boolean {
  return type === 2 || ((type === 1 || type === 3) && due < DAY_DUE_LIMIT);
}

export async function importPackage(e: Engine, pkg: AnkiPackage, options: ImportOptions): Promise<ImportResult> {
  const report = progressReporter(options.onProgress);
  const result: ImportResult = {
    noteTypes: { added: 0, reused: 0 },
    decks: { added: 0, reused: 0 },
    presets: { added: 0, reused: 0 },
    knowledgePoints: { added: 0, updated: 0, unchanged: 0 },
    reviewItems: { added: 0, kept: 0 },
    reviewLog: { added: 0, duplicates: 0 },
    media: { added: 0, unchanged: 0, renamed: 0 },
    warnings: [...pkg.warnings],
    durationMs: 0,
  };

  // ---- media first (async: hashing and file writes happen outside the database transaction) ----
  const renames = new Map<string, string>();
  const mediaRows: { name: string; hash: string; size: number; sha1: string | null }[] = [];
  const takenNames = new Set<string>();
  for (let i = 0; i < pkg.media.length; i++) {
    const m = pkg.media[i]!;
    report("media", i, pkg.media.length);
    const hash = await sha256Hex(m.data);
    const existing = e.db.get<{ hash: string }>("SELECT hash FROM media WHERE name = ?", [m.name]);
    if (existing && existing.hash === hash) {
      result.media.unchanged++;
      continue;
    }
    let name = m.name;
    if (existing) {
      const dot = m.name.lastIndexOf(".");
      const base = dot > 0 ? m.name.slice(0, dot) : m.name;
      const ext = dot > 0 ? m.name.slice(dot) : "";
      name = `${base}-${hash.slice(0, 8)}${ext}`;
      renames.set(m.name, name);
      result.media.renamed++;
      const again = e.db.get<{ hash: string }>("SELECT hash FROM media WHERE name = ?", [name]);
      if (again) continue;
    }
    if (takenNames.has(name)) continue;
    takenNames.add(name);
    await e.media.put(hash, m.data);
    mediaRows.push({ name, hash, size: m.data.length, sha1: m.sha1 });
    result.media.added++;
  }
  report("media", pkg.media.length, pkg.media.length, true);
  const renameRes = [...renames].map(([from, to]) => [new RegExp(escapeRe(from), "g"), to] as const);
  const applyRenames = (fields: string[]) => (renameRes.length ? fields.map((f) => renameRes.reduce((acc, [re, to]) => acc.replace(re, to), f)) : fields);

  e.db.transaction(() => {
    const db = e.db;
    const empty = e.isEmpty();
    const nowSecs = Math.floor(e.clock.now() / 1000);
    let dayShift = 0;
    if (empty) {
      e.setMeta("crt", pkg.collection.crt);
      e.setMeta("mod", pkg.collection.mod);
      e.setMeta("scm", pkg.collection.scm);
      e.setMeta("usn", pkg.collection.usn);
      e.setMeta("ls", pkg.collection.ls);
      e.setMeta("config", pkg.collection.config);
      e.setMeta("format", pkg.format);
      e.reload();
    } else {
      dayShift = Math.round((pkg.collection.crt - e.crtSecs()) / 86400);
    }

    // ---- media rows ----
    let pos = Number(db.value("SELECT coalesce(max(position), -1) FROM media") ?? -1) + 1;
    for (const m of mediaRows) {
      db.run("INSERT OR REPLACE INTO media (name, hash, size, sha1, position, added_at) VALUES (?, ?, ?, ?, ?, ?)", [m.name, m.hash, m.size, m.sha1, pos++, e.clock.now()]);
    }

    // ---- note types ----
    report("note-types", 0, pkg.notetypes.length, true);
    const ntMap = new Map<number, number>();
    for (const nt of pkg.notetypes) {
      const ex = e.noteTypes.get(nt.id);
      if (!ex) {
        e.saveNoteType(nt);
        ntMap.set(nt.id, nt.id);
        result.noteTypes.added++;
      } else if (compatible(ex, nt)) {
        if (nt.mtime > ex.mtime) e.saveNoteType(nt);
        ntMap.set(nt.id, nt.id);
        result.noteTypes.reused++;
      } else {
        const id = e.newId("note_types");
        e.saveNoteType({ ...nt, id });
        ntMap.set(nt.id, id);
        result.noteTypes.added++;
        result.warnings.push(`note type "${nt.name}" differs from the existing one with the same id; imported as a copy`);
      }
    }

    // ---- presets ----
    for (const p of pkg.deckConfigs) {
      const ex = e.presets.get(p.id);
      if (!ex) {
        e.savePreset(p);
        result.presets.added++;
      } else {
        if (p.mtime > ex.mtime) e.savePreset(p);
        result.presets.reused++;
      }
    }

    // ---- decks (parents first) ----
    report("decks", 0, pkg.decks.length, true);
    const deckMap = new Map<number, number>();
    const sorted = [...pkg.decks].sort((a, b) => a.path.length - b.path.length || (a.name < b.name ? -1 : 1));
    for (const d of sorted) {
      const byName = e.deckIdByName(d.name);
      if (byName !== undefined) {
        deckMap.set(d.id, byName);
        const ex = e.decks.get(byName)!;
        if (d.mtime > ex.mtime) e.saveDeck({ ...d, id: byName, stats: ex.stats, configId: d.configId !== null && e.presets.has(d.configId) ? d.configId : ex.configId });
        result.decks.reused++;
        continue;
      }
      const id = e.decks.has(d.id) ? e.newId("decks") : d.id;
      let configId = d.configId;
      if (d.kind === "normal" && (configId === null || !e.presets.has(configId))) configId = e.ensureDefaultPreset().id;
      e.saveDeck({ ...d, id, configId } as Deck);
      deckMap.set(d.id, id);
      result.decks.added++;
    }
    // parents named but missing from the package
    for (const d of [...e.decks.values()]) {
      const parts = d.name.split("::");
      for (let i = 1; i < parts.length; i++) {
        const n = parts.slice(0, i).join("::");
        if (e.deckIdByName(n) === undefined) e.createDeck(n);
      }
    }
    let fallbackDeck: number | null = null;
    const deckFor = (id: number) => {
      const m = deckMap.get(id);
      if (m !== undefined) return m;
      if (e.decks.has(id)) return id;
      fallbackDeck ??= e.createDeck("Default");
      return fallbackDeck;
    };

    // ---- knowledge points ----
    const kpMap = new Map<number, { id: number; isNew: boolean }>();
    const byGuid = (guid: string) => db.get<{ id: number; mtime: number; note_type_id: number }>("SELECT id, mtime, note_type_id FROM knowledge_points WHERE guid = ?", [guid]);
    const idTaken = (table: string, id: number) => !!db.value(`SELECT 1 FROM ${table} WHERE id = ?`, [id]);
    const writeTagIndex = (kpId: number, tags: string[]) => {
      for (const t of tags) {
        db.run("INSERT OR IGNORE INTO knowledge_point_tags (tag, kp_id) VALUES (?, ?)", [t, kpId]);
      }
    };
    const notes = pkg.notes;
    // Indexing text row by row is ~5x slower than rebuilding the index once; do that for large imports.
    const bulkFts = notes.length > 2000;
    const ftsTrigger = bulkFts ? String(db.value("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'knowledge_points_ai'")) : "";
    if (bulkFts) db.exec("DROP TRIGGER knowledge_points_ai");
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i]!;
      if (i % 500 === 0) report("knowledge-points", i, notes.length);
      const ntId = ntMap.get(n.notetypeId) ?? (e.noteTypes.has(n.notetypeId) ? n.notetypeId : undefined);
      if (ntId === undefined) {
        result.warnings.push(`note ${n.id}: note type ${n.notetypeId} missing; skipped`);
        continue;
      }
      const fields = applyRenames(n.fields);
      const renamed = fields.some((f, j) => f !== n.fields[j]);
      const nt = e.noteTypes.get(ntId)!;
      const sortField = renamed ? sortFieldText(fields[nt.sortFieldIndex] ?? "") : n.sortField;
      const ex = empty ? undefined : byGuid(n.guid);
      if (ex) {
        kpMap.set(n.id, { id: ex.id, isNew: false });
        if (ex.note_type_id !== ntId) {
          result.warnings.push(`note ${n.guid}: exists with a different note type; left unchanged`);
          result.knowledgePoints.unchanged++;
        } else if (n.mtime > ex.mtime) {
          db.run(
            "UPDATE knowledge_points SET mtime = ?, usn = ?, tags = ?, fields = ?, sort_field = ?, checksum = ?, flags = ?, data = ?, search_text = ? WHERE id = ?",
            [n.mtime, n.usn, n.tags.join(" "), fields.join(FIELD_SEP), sortField, n.checksum, n.flags, n.data, searchText(fields), ex.id],
          );
          db.run("DELETE FROM knowledge_point_tags WHERE kp_id = ?", [ex.id]);
          writeTagIndex(ex.id, n.tags);
          result.knowledgePoints.updated++;
        } else result.knowledgePoints.unchanged++;
        continue;
      }
      const id = !empty && idTaken("knowledge_points", n.id) ? e.newId("knowledge_points") : n.id;
      const row: KpRow = {
        id,
        guid: n.guid,
        note_type_id: ntId,
        mtime: n.mtime,
        usn: n.usn,
        tags: n.tags.join(" "),
        fields: fields.join(FIELD_SEP),
        sort_field: sortField,
        checksum: n.checksum,
        flags: n.flags,
        data: n.data,
        search_text: searchText(fields),
      };
      db.run(KP_INSERT, [...kpValues(row)]);
      writeTagIndex(id, n.tags);
      kpMap.set(n.id, { id, isNew: true });
      result.knowledgePoints.added++;
    }
    if (bulkFts) {
      db.exec(ftsTrigger);
      db.exec("INSERT INTO knowledge_points_fts (knowledge_points_fts) VALUES ('rebuild')");
    }
    report("knowledge-points", notes.length, notes.length, true);

    // ---- tags registry ----
    for (const t of pkg.tags) db.run("INSERT OR IGNORE INTO tags (name, usn, collapsed) VALUES (?, ?, ?)", [t.name, t.usn, t.collapsed ? 1 : 0]);

    // ---- review items ----
    const cardMap = new Map<number, number>();
    const cards: Card[] = pkg.cards;
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i]!;
      if (i % 1000 === 0) report("review-items", i, cards.length);
      const kp = kpMap.get(c.noteId);
      if (!kp) {
        result.warnings.push(`card ${c.id}: note ${c.noteId} not imported; skipped`);
        continue;
      }
      if (!kp.isNew) {
        const ex = db.value("SELECT id FROM review_items WHERE kp_id = ? AND ord = ?", [kp.id, c.ord]);
        if (ex !== undefined) {
          cardMap.set(c.id, Number(ex));
          result.reviewItems.kept++;
          continue;
        }
      }
      const id = !empty && idTaken("review_items", c.id) ? e.newId("review_items") : c.id;
      const due = dayShift && dayBased(c.type, c.due) ? c.due + dayShift : c.due;
      const odue = dayShift && c.originalDeckId && dayBased(c.type, c.originalDue) ? c.originalDue + dayShift : c.originalDue;
      db.run(ITEM_INSERT, [
        id,
        kp.id,
        deckFor(c.deckId),
        c.ord,
        c.mtime,
        c.usn,
        c.type,
        c.queue,
        due,
        c.interval,
        c.easeFactor,
        c.reps,
        c.lapses,
        c.left,
        odue,
        c.originalDeckId ? deckFor(c.originalDeckId) : 0,
        c.flags,
        c.rawData,
      ]);
      cardMap.set(c.id, id);
      result.reviewItems.added++;
    }
    report("review-items", cards.length, cards.length, true);

    // ---- review log ----
    const rl = pkg.revlog;
    for (let i = 0; i < rl.length; i++) {
      const r = rl[i]!;
      if (i % 5000 === 0) report("review-log", i, rl.length);
      const cid = cardMap.get(r.cardId) ?? r.cardId;
      const changes = db.run(empty ? REVLOG_INSERT : REVLOG_INSERT.replace("INSERT", "INSERT OR IGNORE"), [r.id, cid, r.usn, r.ease, r.interval, r.lastInterval, r.factor, r.taken, r.kind]).changes;
      if (changes) result.reviewLog.added++;
      else result.reviewLog.duplicates++;
    }
    report("review-log", rl.length, rl.length, true);

    report("finishing", 0, 1, true);
    const changed =
      result.knowledgePoints.added + result.knowledgePoints.updated + result.reviewItems.added + result.reviewLog.added + result.media.added + result.decks.added + result.noteTypes.added + result.presets.added;
    if (!empty && changed) e.touch();
    clearUndo(db);
    void nowSecs;
  });
  e.reload();
  report("finishing", 1, 1, true);
  return result;
}
