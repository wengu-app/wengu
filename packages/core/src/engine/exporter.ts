/**
 * Exporting: an AnkiPackage built from the database; selection and the "without scheduling" reset are
 * @wengu/anki's (`packageForExport`), the bytes are its writer's (`writeAnkiPackageChunks`).
 */
import type { AnkiPackage, Card, Deck, DeckConfig, MediaFile, Note, PackageFormat, RevlogEntry, Tag, WriteOptions } from "@wengu/anki";
import { packageForExport, referencedMedia, writeAnkiPackageChunks } from "@wengu/anki";

import type { ExportOptions } from "../types.js";
import type { Engine } from "./engine.js";
import type { ItemRow, KpRow, RevlogRow } from "./rows.js";
import { FIELD_SEP, ITEM_COLS } from "./rows.js";
import { cardDataOf } from "./carddata.js";
import { splitTags } from "./text.js";

const LATEST_FORMAT: PackageFormat = {
  metaVersion: 3,
  collectionEntry: "collection.anki21b",
  schemaVersion: 18,
  zstdCollection: true,
  mediaManifest: "protobuf",
};

/**
 * The collection (or the part of it a deck export needs) as a scheduled AnkiPackage, straight from the
 * database. With `deckId`: the notes that have an item in that deck or its subdecks, all items of those notes,
 * their review log and referenced media; decks, presets and the tag registry are included whole (they are
 * small), so that @wengu/anki's `packageForExport` / writer can apply Anki's own selection rules.
 */
export async function sourcePackage(e: Engine, opts: { deckId?: number; includeMedia?: boolean }): Promise<AnkiPackage> {
  const whole = opts.deckId === undefined;
  if (!whole && !e.decks.has(opts.deckId!)) throw new Error(`no deck ${opts.deckId}`);
  const db = e.db;
  const list = whole ? "" : e.subtree(opts.deckId!).map((d) => Math.trunc(d)).join(",");
  const kpFilter = whole ? "" : `WHERE kp_id IN (SELECT kp_id FROM review_items WHERE deck_id IN (${list}) OR odid IN (${list}))`;

  const itemRows = db.all<ItemRow>(`SELECT ${ITEM_COLS} FROM review_items ${kpFilter} ORDER BY id`);
  const kpRows = whole
    ? db.all<KpRow>("SELECT * FROM knowledge_points ORDER BY id")
    : db.all<KpRow>(`SELECT * FROM knowledge_points WHERE id IN (SELECT kp_id FROM review_items WHERE deck_id IN (${list}) OR odid IN (${list})) ORDER BY id`);

  const notes: Note[] = kpRows.map((k) => ({
    id: k.id,
    guid: k.guid,
    notetypeId: k.note_type_id,
    mtime: k.mtime,
    usn: k.usn,
    tags: splitTags(k.tags),
    fields: k.fields.split(FIELD_SEP),
    sortField: k.sort_field,
    checksum: k.checksum,
    flags: k.flags,
    data: k.data,
  }));
  const cards: Card[] = itemRows.map((r) => ({
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
  }));

  const usedNt = new Set(kpRows.map((k) => k.note_type_id));
  const notetypes = [...e.noteTypes.values()].filter((n) => whole || usedNt.has(n.id)).sort((a, b) => a.id - b.id);
  const decks: Deck[] = [...e.decks.values()]
    .sort((a, b) => a.id - b.id)
    .map((d) => ({ ...d, path: [...d.path], stats: { ...d.stats } }));
  const deckConfigs: DeckConfig[] = [...e.presets.values()].sort((a, b) => a.id - b.id);

  const revRows = whole
    ? db.all<RevlogRow>("SELECT * FROM revlog ORDER BY id")
    : db.all<RevlogRow>(`SELECT * FROM revlog WHERE card_id IN (SELECT id FROM review_items ${kpFilter}) ORDER BY id`);
  const revlog: RevlogEntry[] = revRows.map((r) => ({
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

  // Tag registry, merged with the tags used on the exported notes (as the reader does).
  const tagMap = new Map<string, Tag>();
  for (const r of db.all<{ name: string; usn: number | null; collapsed: number }>("SELECT name, usn, collapsed FROM tags")) {
    tagMap.set(r.name.toLowerCase(), { name: r.name, usn: r.usn, collapsed: !!r.collapsed });
  }
  for (const n of notes) for (const t of n.tags) if (!tagMap.has(t.toLowerCase())) tagMap.set(t.toLowerCase(), { name: t, usn: null, collapsed: false });
  const tags = [...tagMap.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  // Media: bytes are loaded only for the files that go into the package.
  const media: MediaFile[] = [];
  if (opts.includeMedia ?? true) {
    const rows = db.all<{ name: string; hash: string; sha1: string | null }>("SELECT name, hash, sha1 FROM media ORDER BY position");
    const wanted = whole
      ? null
      : referencedMedia(notes, notetypes, rows.map((r) => ({ name: r.name, data: new Uint8Array(0), sha1: r.sha1 })));
    for (const r of rows) {
      if (wanted && !wanted.has(r.name)) continue;
      const data = await e.media.bytes(r.hash);
      if (!data) continue;
      media.push({ name: r.name, data, sha1: r.sha1 });
    }
  }

  return {
    format: e.getMeta<PackageFormat>("format") ?? LATEST_FORMAT,
    collection: {
      crt: e.crtSecs(),
      mod: e.getMeta<number>("mod") ?? e.clock.now(),
      scm: e.getMeta<number>("scm") ?? e.clock.now(),
      usn: e.getMeta<number>("usn") ?? 0,
      ls: e.getMeta<number>("ls") ?? 0,
      config: e.ankiConfig(),
    },
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

/**
 * Export as an AnkiPackage. The whole collection with scheduling is the stored data unchanged (exact round
 * trip). A deck, or an export without scheduling, goes through @wengu/anki's `packageForExport`, which applies
 * Anki's own rules (verified against Anki by the writer's tests): parents of the deck are included; without
 * scheduling items are reset to new, marked/leech tags and the review log are dropped, presets reset.
 */
export async function exportPackage(e: Engine, opts: ExportOptions): Promise<AnkiPackage> {
  const sched = opts.includeScheduling ?? true;
  const includeMedia = opts.includeMedia ?? true;
  const src = await sourcePackage(e, { ...(opts.deckId !== undefined ? { deckId: opts.deckId } : {}), includeMedia });
  if (opts.deckId === undefined && sched) return src;
  const view = packageForExport(src, {
    includeScheduling: sched,
    includeMedia,
    ...(opts.deckId !== undefined ? { deckIds: [opts.deckId] } : {}),
  });
  return { ...view, format: src.format };
}

/** Writes an .apkg (legacy-2 format, the one @wengu/anki writes) chunk by chunk. */
export async function writeApkg(e: Engine, opts: ExportOptions, sqlJs: WriteOptions["sqlJs"], onChunk: (c: Uint8Array) => void): Promise<string[]> {
  const includeMedia = opts.includeMedia ?? true;
  const src = await sourcePackage(e, { ...(opts.deckId !== undefined ? { deckId: opts.deckId } : {}), includeMedia });
  const warnings: string[] = [];
  await writeAnkiPackageChunks(
    src,
    {
      includeScheduling: opts.includeScheduling ?? true,
      includeMedia,
      ...(opts.deckId !== undefined ? { deckIds: [opts.deckId] } : {}),
      ...(sqlJs ? { sqlJs } : {}),
      now: e.clock.now(),
      onWarning: (m) => warnings.push(m),
    },
    onChunk,
  );
  return warnings;
}
