/**
 * Exporting to an AnkiPackage (the @wengu/anki writer turns it into .apkg bytes).
 *
 * With scheduling: everything as stored (original ids, timestamps, card data, review log).
 * Without scheduling: what Anki's own "shared deck" export produces (checked against the fixture
 * shared-latest.apkg, which Anki exported from the same collection): items reset to new at their original
 * position (keeping `left`), flags cleared, card data loses pos/s/d; "marked"/"leech" tags dropped; decks use preset 1 and
 * have zeroed counters and (except the Default deck) expanded state; only preset 1 is included; no review log.
 */
import type { AnkiPackage, Card, CardData, Deck, DeckConfig, MediaFile, Note, PackageFormat, RevlogEntry, Tag } from "@wengu/anki";

import type { ExportOptions } from "../types.js";
import { defaultPreset } from "./defaults.js";
import type { Engine } from "./engine.js";
import type { ItemRow, KpRow, RevlogRow } from "./rows.js";
import { FIELD_SEP, ITEM_COLS } from "./rows.js";
import { mediaReferences, splitTags } from "./text.js";

const LATEST_FORMAT: PackageFormat = {
  metaVersion: 3,
  collectionEntry: "collection.anki21b",
  schemaVersion: 18,
  zstdCollection: true,
  mediaManifest: "protobuf",
};

/** Same parsing as @wengu/anki's reader (card `data` column → CardData). */
export function cardDataOf(raw: string): CardData {
  const out: CardData = { originalPosition: null, memoryState: null, desiredRetention: null, decay: null, lastReviewTime: null, customData: null, extra: {} };
  if (!raw) return out;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw) as Record<string, unknown>;
  } catch {
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
  if (typeof obj["s"] === "number" && typeof obj["d"] === "number") out.memoryState = { stability: obj["s"], difficulty: obj["d"] };
  return out;
}

const SCHEDULING_TAGS = new Set(["marked", "leech"]);

export async function exportPackage(e: Engine, opts: ExportOptions): Promise<AnkiPackage> {
  const sched = opts.includeScheduling ?? true;
  const withMedia = opts.includeMedia ?? true;
  const whole = opts.deckId === undefined;
  if (!whole && !e.decks.has(opts.deckId!)) throw new Error(`no deck ${opts.deckId}`);
  const db = e.db;
  const deckIds = whole ? [...e.decks.keys()] : e.subtree(opts.deckId!);
  const deckSet = new Set(deckIds);
  const list = deckIds.map((d) => Math.trunc(d)).join(",") || "NULL";

  const itemRows = whole
    ? db.all<ItemRow>(`SELECT ${ITEM_COLS} FROM review_items ORDER BY id`)
    : db.all<ItemRow>(`SELECT ${ITEM_COLS} FROM review_items WHERE deck_id IN (${list}) OR odid IN (${list}) ORDER BY id`);
  const kpRows = whole
    ? db.all<KpRow>("SELECT * FROM knowledge_points ORDER BY id")
    : db.all<KpRow>(`SELECT * FROM knowledge_points WHERE id IN (SELECT kp_id FROM review_items WHERE deck_id IN (${list}) OR odid IN (${list})) ORDER BY id`);

  // ---- notes ----
  const notes: Note[] = kpRows.map((k) => {
    let tags = splitTags(k.tags);
    if (!sched) tags = tags.filter((t) => !SCHEDULING_TAGS.has(t.toLowerCase()));
    return {
      id: k.id,
      guid: k.guid,
      notetypeId: k.note_type_id,
      mtime: k.mtime,
      usn: k.usn,
      tags,
      fields: k.fields.split(FIELD_SEP),
      sortField: k.sort_field,
      checksum: k.checksum,
      flags: k.flags,
      data: k.data,
    };
  });

  // ---- cards ----
  let nextPos = 1;
  for (const r of itemRows) if (r.type === 0 && r.due >= nextPos) nextPos = r.due + 1;
  const cards: Card[] = itemRows.map((r) => {
    if (sched) {
      return {
        id: r.id,
        noteId: r.kp_id,
        deckId: r.deck_id,
        ord: r.ord,
        mtime: r.mtime,
        usn: r.usn,
        type: r.type as Card["type"],
        queue: r.queue as Card["queue"],
        due: r.due,
        interval: r.ivl,
        easeFactor: r.factor,
        reps: r.reps,
        lapses: r.lapses,
        left: r.left,
        originalDue: r.odue,
        originalDeckId: r.odid,
        flags: r.flags,
        data: cardDataOf(r.data),
        rawData: r.data,
      };
    }
    let raw = r.data;
    let pos: number | null = null;
    try {
      const obj = r.data ? (JSON.parse(r.data) as Record<string, unknown>) : null;
      if (obj && typeof obj === "object") {
        if (typeof obj["pos"] === "number") pos = obj["pos"];
        if ("pos" in obj || "s" in obj || "d" in obj) {
          delete obj["pos"];
          delete obj["s"];
          delete obj["d"];
          raw = JSON.stringify(obj);
        }
      }
    } catch {
      /* keep raw */
    }
    const due = r.type === 0 ? (r.odid && r.odue ? r.odue : r.due) : (pos ?? nextPos++);
    return {
      id: r.id,
      noteId: r.kp_id,
      deckId: r.odid || r.deck_id,
      ord: r.ord,
      mtime: r.mtime,
      usn: r.usn,
      type: 0,
      queue: 0,
      due,
      interval: 0,
      easeFactor: 0,
      reps: 0,
      lapses: 0,
      left: r.left, // kept, as Anki does
      originalDue: 0,
      originalDeckId: 0,
      flags: 0,
      data: cardDataOf(raw),
      rawData: raw,
    };
  });

  // ---- note types ----
  const usedNt = new Set(kpRows.map((k) => k.note_type_id));
  const notetypes = [...e.noteTypes.values()].filter((n) => whole || usedNt.has(n.id)).sort((a, b) => a.id - b.id);

  // ---- decks & presets ----
  const decks: Deck[] = [...e.decks.values()]
    .filter((d) => deckSet.has(d.id))
    .sort((a, b) => a.id - b.id)
    .map((d) => {
      const parentName = d.name.includes("::") ? d.name.slice(0, d.name.lastIndexOf("::")) : null;
      const pid = parentName === null ? null : (e.deckIdByName(parentName) ?? null);
      const deck: Deck = { ...d, path: [...d.path], parentId: pid !== null && deckSet.has(pid) ? pid : null, stats: { ...d.stats } };
      if (!sched) {
        // Anki leaves the Default deck (id 1) as it is.
        if (deck.id !== 1) {
          deck.collapsed = false;
          deck.browserCollapsed = false;
        }
        if (deck.kind === "normal") deck.configId = 1;
        deck.stats = { lastDayStudied: 0, newStudied: 0, reviewStudied: 0, learningStudied: 0, millisecondsStudied: 0 };
      }
      return deck;
    });
  let deckConfigs: DeckConfig[];
  if (!sched) deckConfigs = [e.presets.get(1) ?? defaultPreset()];
  else {
    const used = new Set(decks.map((d) => d.configId));
    deckConfigs = [...e.presets.values()].filter((p) => whole || used.has(p.id)).sort((a, b) => a.id - b.id);
  }

  // ---- review log ----
  let revlog: RevlogEntry[] = [];
  if (sched) {
    const rows = whole
      ? db.all<RevlogRow>("SELECT * FROM revlog ORDER BY id")
      : db.all<RevlogRow>(`SELECT * FROM revlog WHERE card_id IN (SELECT id FROM review_items WHERE deck_id IN (${list}) OR odid IN (${list})) ORDER BY id`);
    revlog = rows.map((r) => ({
      id: r.id,
      cardId: r.card_id,
      usn: r.usn,
      ease: r.ease,
      interval: r.ivl,
      lastInterval: r.last_ivl,
      factor: r.factor,
      taken: r.taken,
      kind: r.kind as RevlogEntry["kind"],
    }));
  }

  // ---- tags ----
  const usedTags = new Map<string, string>();
  for (const n of notes) for (const t of n.tags) if (!usedTags.has(t.toLowerCase())) usedTags.set(t.toLowerCase(), t);
  const registry = db.all<{ name: string; usn: number | null; collapsed: number }>("SELECT name, usn, collapsed FROM tags");
  const tagMap = new Map<string, Tag>();
  for (const r of registry) {
    const k = r.name.toLowerCase();
    if (!sched && SCHEDULING_TAGS.has(k)) continue;
    if (!whole && !usedTags.has(k)) continue;
    tagMap.set(k, { name: r.name, usn: r.usn, collapsed: !!r.collapsed });
  }
  for (const [k, name] of usedTags) if (!tagMap.has(k)) tagMap.set(k, { name, usn: null, collapsed: false });
  const tags = [...tagMap.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  // ---- media ----
  const media: MediaFile[] = [];
  if (withMedia) {
    let names: string[] | null = null;
    if (!whole) {
      const refs = new Set<string>();
      for (const n of notes) for (const f of n.fields) for (const m of mediaReferences(f)) refs.add(m);
      for (const nt of notetypes) {
        for (const m of mediaReferences(`<style>${nt.css}</style>` + nt.templates.map((t) => t.qfmt + t.afmt).join(""))) refs.add(m);
      }
      names = [...refs];
    }
    const rows = db.all<{ name: string; hash: string; sha1: string | null }>("SELECT name, hash, sha1 FROM media ORDER BY position");
    const wanted = names ? new Set(names) : null;
    for (const r of rows) {
      if (wanted && !wanted.has(r.name)) continue;
      const data = await e.media.bytes(r.hash);
      if (!data) continue;
      media.push({ name: r.name, data, sha1: r.sha1 });
    }
  }

  const collection = {
    crt: e.crtSecs(),
    mod: e.getMeta<number>("mod") ?? e.clock.now(),
    scm: e.getMeta<number>("scm") ?? e.clock.now(),
    usn: e.getMeta<number>("usn") ?? 0,
    ls: e.getMeta<number>("ls") ?? 0,
    config: e.ankiConfig(),
  };
  return {
    format: e.getMeta<PackageFormat>("format") ?? LATEST_FORMAT,
    collection,
    notetypes,
    notes,
    cards,
    decks,
    deckConfigs,
    revlog,
    media,
    tags,
    warnings: [],
  };
}
