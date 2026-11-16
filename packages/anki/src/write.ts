/**
 * Write an `AnkiPackage` as an `.apkg` that Anki imports.
 *
 * Output format: the legacy-compatible package every Anki version since
 * 2.1 imports (and 2.0 sees an "update Anki" note):
 *
 *   meta                 protobuf PackageMetadata { version = 2 (LEGACY_2) }
 *   collection.anki21    SQLite, schema 11, deflated
 *   collection.anki2     compatibility collection with one "please update" note
 *   0, 1, 2, …           media files, stored
 *   media                JSON {"0": "name", …}
 *
 * The entry order, compression choices, schema and JSON layout are those of
 * Anki's own legacy export. Verified against the official `anki` library:
 * importing a package written here gives the same collection as importing
 * the package Anki exported (test/write-oracle.test.ts).
 */
import type { Database, SqlJsStatic } from "sql.js";
import type initSqlJs from "sql.js";

import { basicNotetype, defaultDeck, defaultDeckConfig } from "./defaults.js";
import { stringifyJson } from "./json.js";
import type { AnkiPackage, Card, CardData, Deck, MediaFile, Note, Notetype } from "./model.js";
import { parseCardData, getSqlJs } from "./read.js";
import { latexImageNames } from "./render.js";
import { cardDataObject, deckConfigJson, deckJson, notetypeJson } from "./schema11-write.js";
import { decodeEntitiesStrict, fieldChecksum, sortFieldText } from "./sortfield.js";
import { AnkiPackageValidationError, validateAnkiPackage } from "./validate.js";
import { ZipWriter } from "./zip.js";

/** Which part of the model goes into the package (the choices Anki's export dialog offers). */
export interface ExportSelection {
  /**
   * Include scheduling: card states, FSRS memory state, review log, deck
   * statistics (Anki: "Include scheduling information"). Default true.
   * When false the package is what Anki writes without scheduling: every
   * card becomes new (at its original new position), FSRS memory state and
   * the review log are dropped, the "marked" and "leech" tags are removed,
   * filtered decks become normal decks.
   */
  includeScheduling?: boolean;
  /** Include deck option presets (Anki: "Include deck presets"). Default: same as `includeScheduling`. */
  includeDeckConfigs?: boolean;
  /** Include media files. Default true. */
  includeMedia?: boolean;
  /**
   * Export only these decks and their subdecks, like exporting a deck in
   * Anki: the notes with a card in them, all cards of those notes, the decks
   * those cards are in plus parents, the notetypes and presets they use and
   * the media the notes reference. Default: the whole model.
   */
  deckIds?: readonly number[];
}

export interface WriteOptions extends ExportSelection {
  /**
   * Recompute each note's sort field and checksum from its fields (default
   * true), so edited notes never carry stale values. Anki itself recomputes
   * them on import; other readers may not.
   */
  recomputeSortFields?: boolean;
  /** Validate the model first and throw `AnkiPackageValidationError` on errors (default true). */
  validate?: boolean;
  /** Receives warnings (validation warnings, data that schema 11 cannot hold). */
  onWarning?: (message: string) => void;
  /** Unix ms used for zip timestamps and the compatibility collection. Default `Date.now()`. */
  now?: number;
  /** Deflate level for the collection database, 0–9 (default 6). Media are stored, as Anki does. */
  compressionLevel?: number;
  /** As for `readAnkiPackage`. */
  sqlJs?: SqlJsStatic;
  sqlJsConfig?: Parameters<typeof initSqlJs>[0];
}

/**
 * Write a package and return its bytes. Peak memory is roughly the model's
 * media plus the finished package; use `writeAnkiPackageChunks` to stream
 * the output instead (e.g. into a Blob or a file) for large media sets.
 */
export async function writeAnkiPackage(pkg: AnkiPackage, options: WriteOptions = {}): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  await writeAnkiPackageChunks(pkg, options, (c) => {
    chunks.push(c);
    total += c.length;
  });
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/**
 * Write a package as a sequence of chunks, in order. Media file contents
 * are passed through as the model's own `Uint8Array`s (not copied), so the
 * consumer must not modify them.
 */
export async function writeAnkiPackageChunks(
  pkg: AnkiPackage,
  options: WriteOptions,
  onChunk: (chunk: Uint8Array) => void,
): Promise<void> {
  const warn = options.onWarning ?? (() => {});
  if (options.validate ?? true) {
    const r = validateAnkiPackage(pkg);
    r.warnings.forEach(warn);
    if (r.errors.length) throw new AnkiPackageValidationError(r.errors, r.warnings);
  }
  const view = packageForExport(pkg, options);
  const now = options.now ?? Date.now();
  const level = options.compressionLevel ?? 6;
  if (!Number.isInteger(level) || level < 0 || level > 9) throw new Error(`compressionLevel must be 0–9, got ${level}`);

  const SQL = await getSqlJs(options);
  const collection = buildLegacyCollection(SQL, view, options.recomputeSortFields ?? true, warn);
  const compat = buildLegacyCollection(SQL, compatibilityPackage(now), true, warn);

  const zip = new ZipWriter(onChunk, new Date(now));
  zip.add("meta", PACKAGE_META_LEGACY_2, null);
  zip.add("collection.anki21", collection, level);
  zip.add("collection.anki2", compat, null);
  const map: Record<string, string> = {};
  view.media.forEach((m, i) => {
    zip.add(String(i), m.data, null);
    map[String(i)] = m.name;
  });
  zip.add("media", new TextEncoder().encode(JSON.stringify(map)), null);
  zip.end();
}

/** PackageMetadata { version: LEGACY_2 } (field 1, varint 2). */
const PACKAGE_META_LEGACY_2 = new Uint8Array([0x08, 0x02]);

// ---------------------------------------------------------------------------
// selection
// ---------------------------------------------------------------------------

const SCHEDULING_TAGS = new Set(["marked", "leech"]);

/**
 * The model as it will be written: the selected decks, with scheduling and
 * presets stripped the way Anki strips them. Pure; the input is not
 * modified (unchanged objects are shared).
 */
export function packageForExport(pkg: AnkiPackage, options: ExportSelection = {}): AnkiPackage {
  const scheduling = options.includeScheduling ?? true;
  const presets = options.includeDeckConfigs ?? scheduling;
  const includeMedia = options.includeMedia ?? true;

  let notes = pkg.notes;
  let cards = pkg.cards;
  let decks = pkg.decks;
  let notetypes = pkg.notetypes;
  let deckConfigs = pkg.deckConfigs;
  let media: MediaFile[] = includeMedia ? pkg.media : [];

  if (options.deckIds) {
    const byId = new Map(pkg.decks.map((d) => [d.id, d]));
    const byName = new Map(pkg.decks.map((d) => [d.name.toLowerCase(), d]));
    const selected = new Set<number>();
    for (const id of options.deckIds) {
      const d = byId.get(id);
      if (!d) throw new Error(`deckIds: deck ${id} is not in the package`);
      const prefix = `${d.name.toLowerCase()}::`;
      for (const x of pkg.decks) if (x.id === id || x.name.toLowerCase().startsWith(prefix)) selected.add(x.id);
    }
    const noteIds = new Set(cards.filter((c) => selected.has(c.deckId) || selected.has(c.originalDeckId)).map((c) => c.noteId));
    notes = notes.filter((n) => noteIds.has(n.id));
    cards = cards.filter((c) => noteIds.has(c.noteId));
    const deckIds = new Set<number>([1, ...selected]);
    for (const c of cards) {
      deckIds.add(c.deckId);
      if (c.originalDeckId) deckIds.add(c.originalDeckId);
    }
    for (const id of [...deckIds]) {
      const d = byId.get(id);
      if (!d) continue;
      for (let i = 1; i < d.path.length; i++) {
        const parent = byName.get(d.path.slice(0, i).join("::").toLowerCase());
        if (parent) deckIds.add(parent.id);
      }
    }
    decks = pkg.decks.filter((d) => deckIds.has(d.id));
    const ntIds = new Set(notes.map((n) => n.notetypeId));
    notetypes = notetypes.filter((n) => ntIds.has(n.id));
    const confIds = new Set<number>([1]);
    for (const d of decks) if (d.kind === "normal" && d.configId !== null) confIds.add(d.configId);
    deckConfigs = deckConfigs.filter((c) => confIds.has(c.id));
    if (includeMedia) {
      const used = referencedMedia(notes, notetypes, pkg.media);
      media = pkg.media.filter((m) => used.has(m.name));
    }
  }

  if (!decks.some((d) => d.id === 1)) decks = [defaultDeck(), ...decks];
  if (!presets) {
    deckConfigs = [defaultDeckConfig()];
    decks = decks.map((d) => (d.kind === "normal" && d.configId !== 1 ? { ...d, configId: 1 } : d));
  } else if (!deckConfigs.some((c) => c.id === 1)) {
    deckConfigs = [defaultDeckConfig(), ...deckConfigs];
  }

  const cardIds = new Set(cards.map((c) => c.id));
  let revlog = pkg.revlog.filter((r) => cardIds.has(r.cardId));

  if (!scheduling) {
    notes = notes.map((n) => {
      const tags = n.tags.filter((t) => !SCHEDULING_TAGS.has(t.toLowerCase()));
      return tags.length === n.tags.length ? n : { ...n, tags };
    });
    cards = resetCards(cards);
    decks = decks.map(resetDeck);
    revlog = [];
    // FSRS parameters are trained on the review history, which is not exported either.
    deckConfigs = deckConfigs.map((c) =>
      c.fsrsParams4.length || c.fsrsParams5.length || c.fsrsParams6.length ? { ...c, fsrsParams4: [], fsrsParams5: [], fsrsParams6: [] } : c,
    );
  }

  const usedTags = new Set(notes.flatMap((n) => n.tags.map((t) => t.toLowerCase())));
  const tags = pkg.tags.filter((t) => usedTags.has(t.name.toLowerCase()));
  return { ...pkg, notes, cards, decks, notetypes, deckConfigs, revlog, media, tags, warnings: [] };
}

/** What Anki does to cards when exporting without scheduling (observed with Anki 26.09). */
function resetCards(cards: readonly Card[]): Card[] {
  let next = 0;
  for (const c of cards) {
    if (c.type === 0) next = Math.max(next, c.due);
    if (c.data.originalPosition !== null) next = Math.max(next, c.data.originalPosition);
  }
  const positionless = new Set(
    cards.filter((c) => c.type !== 0 && c.data.originalPosition === null).sort((a, b) => a.id - b.id).map((c) => c.id),
  );
  const assigned = new Map<number, number>();
  for (const id of positionless) assigned.set(id, ++next);
  return cards.map((c) => {
    const due = c.type === 0 ? c.due : (c.data.originalPosition ?? assigned.get(c.id)!);
    // Only these keys survive; position and memory state go, unknown keys are dropped (as Anki does).
    const data: CardData = {
      originalPosition: null,
      memoryState: null,
      desiredRetention: c.data.desiredRetention,
      decay: c.data.decay,
      lastReviewTime: c.data.lastReviewTime,
      customData: c.data.customData,
      extra: {},
    };
    return {
      ...c,
      type: 0,
      queue: 0,
      due,
      interval: 0,
      easeFactor: 0,
      reps: 0,
      lapses: 0,
      originalDue: 0,
      originalDeckId: 0,
      flags: 0,
      data,
      rawData: cardDataJson(data),
    } as Card;
  });
}

function resetDeck(d: Deck): Deck {
  const out: Deck = {
    ...d,
    stats: { lastDayStudied: 0, newStudied: 0, reviewStudied: 0, learningStudied: 0, millisecondsStudied: 0 },
    reviewLimit: null,
    newLimit: null,
    reviewLimitToday: null,
    newLimitToday: null,
  };
  if (d.id !== 1) {
    out.collapsed = false;
    out.browserCollapsed = false;
  }
  if (d.kind === "filtered") {
    // Exported without scheduling, a filtered deck becomes an ordinary deck that keeps its cards.
    Object.assign(out, {
      kind: "normal",
      configId: 1,
      filtered: null,
      extendNew: 0,
      extendReview: 0,
      desiredRetention: null,
      markdownDescription: false,
      extra: {},
    });
  }
  return out;
}

/**
 * Media names referenced by these notes (`src=`/`data=` attributes,
 * `[sound:…]`, CSS `url(…)`, LaTeX images) or by their notetypes
 * (templates and CSS, including `_`-prefixed files named anywhere in them).
 */
export function referencedMedia(notes: readonly Note[], notetypes: readonly Notetype[], media: readonly MediaFile[]): Set<string> {
  const refs = new Set<string>();
  const svgByNt = new Map(notetypes.map((n) => [n.id, n.latexSvg]));
  const scan = (text: string) => {
    for (const m of text.matchAll(MEDIA_REF)) {
      const raw = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? "";
      for (const v of [raw, decodeEntitiesStrict(raw)]) {
        refs.add(v);
        try {
          refs.add(decodeURIComponent(v));
        } catch {
          // not percent-encoded
        }
      }
    }
  };
  for (const n of notes) {
    const svg = svgByNt.get(n.notetypeId) ?? false;
    for (const f of n.fields) {
      scan(f);
      for (const name of latexImageNames(f, svg)) refs.add(name);
    }
  }
  const templateText: string[] = [];
  for (const nt of notetypes) {
    templateText.push(nt.css);
    for (const t of nt.templates) templateText.push(t.qfmt, t.afmt);
  }
  const templates = templateText.join("\n");
  scan(templates);
  const used = new Set<string>();
  for (const m of media) {
    if (refs.has(m.name) || (m.name.startsWith("_") && templates.includes(m.name))) used.add(m.name);
  }
  return used;
}

// src="x" | src='x' | src=x | [sound:x] | url(x) (data= for <object>)
const MEDIA_REF = /\b(?:src|data)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))|\[sound:([^\]]+)\]|url\(\s*['"]?([^'")]+?)['"]?\s*\)/gi;

// ---------------------------------------------------------------------------
// card data
// ---------------------------------------------------------------------------

/** Serialise `CardData` to the `cards.data` JSON text. */
export function cardDataJson(data: CardData): string {
  if (Object.keys(data.extra).length === 1 && typeof data.extra["raw"] === "string" && isEmptyData(data)) {
    return data.extra["raw"]; // unparseable original, kept verbatim by the reader
  }
  return stringifyJson(cardDataObject(data));
}

function isEmptyData(d: CardData): boolean {
  return d.originalPosition === null && d.memoryState === null && d.desiredRetention === null && d.decay === null &&
    d.lastReviewTime === null && d.customData === null;
}

/**
 * `cards.data` text for a card: the stored `rawData` while it still says
 * the same as `data` (keeps Anki's exact number formatting), otherwise
 * `data` serialised. `data` is authoritative.
 */
export function cardDataText(card: Pick<Card, "id" | "data" | "rawData">): string {
  if (card.rawData !== undefined && deepEqual(parseCardData(card.rawData, [], card.id), card.data)) return card.rawData;
  return cardDataJson(card.data);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

// ---------------------------------------------------------------------------
// schema 11 database
// ---------------------------------------------------------------------------

// The schema of a collection.anki21 written by Anki (2.1.50+ legacy export).
const SCHEMA_11 = `
CREATE TABLE col (
  id integer PRIMARY KEY,
  crt integer NOT NULL,
  mod integer NOT NULL,
  scm integer NOT NULL,
  ver integer NOT NULL,
  dty integer NOT NULL,
  usn integer NOT NULL,
  ls integer NOT NULL,
  conf text NOT NULL,
  models text NOT NULL,
  decks text NOT NULL,
  dconf text NOT NULL,
  tags text NOT NULL
);
CREATE TABLE notes (
  id integer PRIMARY KEY,
  guid text NOT NULL,
  mid integer NOT NULL,
  mod integer NOT NULL,
  usn integer NOT NULL,
  tags text NOT NULL,
  flds text NOT NULL,
  -- integer affinity on purpose: numeric sort fields sort numerically
  sfld integer NOT NULL,
  csum integer NOT NULL,
  flags integer NOT NULL,
  data text NOT NULL
);
CREATE TABLE cards (
  id integer PRIMARY KEY,
  nid integer NOT NULL,
  did integer NOT NULL,
  ord integer NOT NULL,
  mod integer NOT NULL,
  usn integer NOT NULL,
  type integer NOT NULL,
  queue integer NOT NULL,
  due integer NOT NULL,
  ivl integer NOT NULL,
  factor integer NOT NULL,
  reps integer NOT NULL,
  lapses integer NOT NULL,
  left integer NOT NULL,
  odue integer NOT NULL,
  odid integer NOT NULL,
  flags integer NOT NULL,
  data text NOT NULL
);
CREATE TABLE revlog (
  id integer PRIMARY KEY,
  cid integer NOT NULL,
  usn integer NOT NULL,
  ease integer NOT NULL,
  ivl integer NOT NULL,
  lastIvl integer NOT NULL,
  factor integer NOT NULL,
  time integer NOT NULL,
  type integer NOT NULL
);
CREATE TABLE graves (
  usn integer NOT NULL,
  oid integer NOT NULL,
  type integer NOT NULL
);
CREATE INDEX ix_notes_usn ON notes (usn);
CREATE INDEX ix_cards_usn ON cards (usn);
CREATE INDEX ix_revlog_usn ON revlog (usn);
CREATE INDEX ix_cards_nid ON cards (nid);
CREATE INDEX ix_cards_sched ON cards (did, queue, due);
CREATE INDEX ix_revlog_cid ON revlog (cid);
CREATE INDEX ix_notes_csum ON notes (csum);
`;

function buildLegacyCollection(SQL: SqlJsStatic, pkg: AnkiPackage, recompute: boolean, warn: (m: string) => void): Uint8Array {
  const db: Database = new SQL.Database();
  try {
    db.exec("PRAGMA page_size = 4096; PRAGMA encoding = 'UTF-8';");
    db.exec(SCHEMA_11);
    db.exec("BEGIN");
    const keyed = <T extends { id: number }>(items: readonly T[], f: (x: T) => unknown) => {
      const o: Record<string, unknown> = {};
      for (const x of items) o[String(x.id)] = f(x);
      return stringifyJson(o);
    };
    const registry: Record<string, number> = {};
    for (const t of pkg.tags) if (t.usn !== null) registry[t.name] = t.usn;
    const c = pkg.collection;
    db.run("INSERT INTO col VALUES (1, ?, ?, ?, 11, 0, ?, ?, ?, ?, ?, ?, ?)", [
      c.crt, c.mod, c.scm, c.usn, c.ls,
      stringifyJson(c.config),
      keyed(pkg.notetypes, (n) => notetypeJson(n, warn)),
      keyed(pkg.decks, (d) => deckJson(d, warn)),
      keyed(pkg.deckConfigs, (d) => deckConfigJson(d, warn)),
      stringifyJson(registry),
    ]);

    const notetypes = new Map(pkg.notetypes.map((n) => [n.id, n]));
    const insNote = db.prepare("INSERT INTO notes VALUES (?,?,?,?,?,?,?,?,?,?,?)");
    for (const n of pkg.notes) {
      const nt = notetypes.get(n.notetypeId);
      const sfld = recompute && nt ? sortFieldText(n.fields, nt.sortFieldIndex) : String(n.sortField);
      const csum = recompute ? fieldChecksum(n.fields[0] ?? "") : n.checksum;
      insNote.run([n.id, n.guid, n.notetypeId, n.mtime, n.usn, n.tags.length ? ` ${n.tags.join(" ")} ` : "", n.fields.join("\x1f"), sfld, csum, n.flags, n.data]);
    }
    insNote.free();

    const insCard = db.prepare("INSERT INTO cards VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    for (const k of pkg.cards) {
      insCard.run([
        k.id, k.noteId, k.deckId, k.ord, k.mtime, k.usn, k.type, k.queue, k.due, k.interval, k.easeFactor, k.reps,
        k.lapses, k.left, k.originalDue, k.originalDeckId, k.flags, cardDataText(k),
      ]);
    }
    insCard.free();

    const insRev = db.prepare("INSERT INTO revlog VALUES (?,?,?,?,?,?,?,?,?)");
    for (const r of pkg.revlog) insRev.run([r.id, r.cardId, r.usn, r.ease, r.interval, r.lastInterval, r.factor, r.taken, r.kind]);
    insRev.free();
    db.exec("COMMIT");
    return db.export();
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// compatibility collection (collection.anki2)
// ---------------------------------------------------------------------------

const UPDATE_MESSAGE = "Please update to the latest Anki version, then import the .colpkg/.apkg file again.";

/** What Anki puts in `collection.anki2` of a legacy-2 package: a collection whose only note asks to update Anki. */
function compatibilityPackage(nowMs: number): AnkiPackage {
  const secs = Math.floor(nowMs / 1000);
  const nt = basicNotetype(nowMs, secs);
  const deck = defaultDeck();
  return {
    format: { metaVersion: null, collectionEntry: "collection.anki2", schemaVersion: 11, zstdCollection: false, mediaManifest: "json" },
    collection: { crt: dayStart(secs), mod: nowMs, scm: nowMs, usn: 0, ls: 0, config: { curModel: nowMs, nextPos: 2, schedVer: 2 } },
    notetypes: [nt],
    notes: [{
      id: nowMs, guid: "wenguCompat", notetypeId: nt.id, mtime: secs, usn: -1, tags: [], fields: [UPDATE_MESSAGE, ""],
      sortField: UPDATE_MESSAGE, checksum: 0, flags: 0, data: "",
    }],
    cards: [{
      id: nowMs, noteId: nowMs, deckId: deck.id, ord: 0, mtime: secs, usn: -1, type: 0, queue: 0, due: 1, interval: 0,
      easeFactor: 0, reps: 0, lapses: 0, left: 0, originalDue: 0, originalDeckId: 0, flags: 0,
      data: { originalPosition: null, memoryState: null, desiredRetention: null, decay: null, lastReviewTime: null, customData: null, extra: {} },
      rawData: "{}",
    }],
    decks: [deck],
    deckConfigs: [defaultDeckConfig()],
    revlog: [],
    media: [],
    tags: [],
    warnings: [],
  };
}

function dayStart(secs: number): number {
  return secs - (secs % 86400);
}
