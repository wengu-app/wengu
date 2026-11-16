/**
 * Helpers for changing an `AnkiPackage` in memory so that it stays a valid
 * package: they keep the derived columns (sort field, checksum, card data
 * text), ids, timestamps and USNs the way Anki keeps them.
 *
 * All helpers mutate the package passed in and return the touched objects.
 * Times default to `Date.now()`; pass `now` (unix ms) for reproducibility.
 */
import type { AnkiPackage, Card, CardData, Note, Notetype, RevlogEntry, Tag } from "./model.js";
import { clozeNumbers, isFieldEmpty, renderCard } from "./render.js";
import { noteSortFieldAndChecksum } from "./sortfield.js";
import { cardDataJson } from "./write.js";

export interface EditOptions {
  /** Unix ms. Default `Date.now()`. */
  now?: number;
}

/** Unsynced changes carry USN −1 in Anki. */
const USN_PENDING = -1;

function nowMs(o?: EditOptions): number {
  return o?.now ?? Date.now();
}

/**
 * A new id in Anki's style (unix ms), not in `taken`: the first free value
 * at or after `now`.
 */
export function newId(taken: ReadonlySet<number> | Iterable<number>, now: number = Date.now()): number {
  const set = taken instanceof Set ? (taken as ReadonlySet<number>) : new Set(taken);
  let id = Math.floor(now);
  while (set.has(id)) id++;
  return id;
}

const GUID_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&()*+,-./:;<=>?@[]^_`{|}~";

/** A random note guid in Anki's alphabet (10 characters, ~65 bits). */
export function newGuid(): string {
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += GUID_CHARS[b % GUID_CHARS.length];
  return s;
}

/** Empty `CardData` (a new card). */
export function emptyCardData(): CardData {
  return { originalPosition: null, memoryState: null, desiredRetention: null, decay: null, lastReviewTime: null, customData: null, extra: {} };
}

function getNote(pkg: AnkiPackage, noteId: number): Note {
  const n = pkg.notes.find((x) => x.id === noteId);
  if (!n) throw new Error(`note ${noteId} not found`);
  return n;
}

function getNotetype(pkg: AnkiPackage, id: number): Notetype {
  const nt = pkg.notetypes.find((x) => x.id === id);
  if (!nt) throw new Error(`notetype ${id} not found`);
  return nt;
}

/** Field values by name or as a full array → array in notetype order (missing names keep `base`). */
function resolveFields(nt: Notetype, fields: Record<string, string> | readonly string[], base: readonly string[]): string[] {
  let out: string[];
  if (Array.isArray(fields)) {
    if (fields.length !== nt.fields.length) throw new Error(`notetype "${nt.name}" has ${nt.fields.length} fields, got ${fields.length}`);
    out = fields.map((f) => f.normalize("NFC"));
  } else {
    out = nt.fields.map((_, i) => base[i] ?? "");
    for (const [name, value] of Object.entries(fields)) {
      const i = nt.fields.findIndex((f) => f.name === name);
      if (i < 0) throw new Error(`notetype "${nt.name}" has no field "${name}"`);
      out[i] = (value as string).normalize("NFC");
    }
  }
  for (const [i, f] of out.entries()) if (f.includes("\x1f")) throw new Error(`field ${nt.fields[i]!.name} contains U+001F`);
  return out;
}

function registerTags(pkg: AnkiPackage, tags: readonly string[]): void {
  const known = new Set(pkg.tags.map((t) => t.name.toLowerCase()));
  let added = false;
  for (const t of tags) {
    if (known.has(t.toLowerCase())) continue;
    known.add(t.toLowerCase());
    pkg.tags.push({ name: t, usn: null, collapsed: false } satisfies Tag);
    added = true;
  }
  if (added) pkg.tags.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * Drop tags that no note uses any more and that only existed because a note
 * used them (`usn === null`), so `pkg.tags` stays what the reader would derive.
 */
function pruneDerivedTags(pkg: AnkiPackage): void {
  const used = new Set(pkg.notes.flatMap((n) => n.tags.map((t) => t.toLowerCase())));
  pkg.tags = pkg.tags.filter((t) => t.usn !== null || used.has(t.name.toLowerCase()));
}

function checkTags(tags: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of tags) {
    if (!t || /\s/.test(t)) throw new Error(`invalid tag ${JSON.stringify(t)}: tags cannot be empty or contain whitespace`);
    if (!seen.has(t.toLowerCase())) out.push(t.normalize("NFC"));
    seen.add(t.toLowerCase());
  }
  return out;
}

/**
 * Change a note's fields (by field name, or all fields as an array) and/or
 * tags. Recomputes the sort field and checksum, bumps mtime and marks it
 * unsynced. Does not add or remove cards (see `cardOrdinalsForNote`).
 */
export function updateNote(
  pkg: AnkiPackage,
  noteId: number,
  change: { fields?: Record<string, string> | readonly string[]; tags?: readonly string[] },
  options?: EditOptions,
): Note {
  const note = getNote(pkg, noteId);
  const nt = getNotetype(pkg, note.notetypeId);
  if (change.fields) note.fields = resolveFields(nt, change.fields, note.fields);
  if (change.tags) {
    note.tags = checkTags(change.tags);
    registerTags(pkg, note.tags);
    pruneDerivedTags(pkg);
  }
  Object.assign(note, noteSortFieldAndChecksum(note, nt));
  note.mtime = Math.floor(nowMs(options) / 1000);
  note.usn = USN_PENDING;
  return note;
}

/**
 * Card ordinals Anki generates for these field values: for a cloze notetype
 * one per cloze number (ord = number − 1); otherwise each template whose
 * front side shows at least one non-empty field.
 */
export function cardOrdinalsForNote(nt: Notetype, fields: readonly string[]): number[] {
  if (nt.kind === "cloze") {
    const nums = new Set<number>();
    for (const f of fields) for (const n of clozeNumbers(f)) nums.add(n);
    return [...nums].sort((a, b) => a - b).map((n) => n - 1);
  }
  const effective = fields.map((f) => (isFieldEmpty(f) ? "" : f));
  const blank = fields.map(() => "");
  return nt.templates
    .filter((t) => {
      const q = (fs: string[]) => renderCard({ notetype: nt, note: { fields: fs, tags: [] }, cardOrd: t.ord }).question;
      return q(effective) !== q(blank);
    })
    .map((t) => t.ord);
}

/** The next new-card position (`due` of new cards), as Anki's "nextPos". */
export function nextNewPosition(pkg: AnkiPackage): number {
  let max = 0;
  for (const c of pkg.cards) {
    if (c.type === 0) max = Math.max(max, c.due);
    if (c.data.originalPosition !== null) max = Math.max(max, c.data.originalPosition);
  }
  return max + 1;
}

export interface NewNote {
  notetypeId: number;
  /** Deck for the new cards (a template's deck override wins, as in Anki). */
  deckId: number;
  fields: Record<string, string> | readonly string[];
  tags?: readonly string[];
  guid?: string;
}

/**
 * Add a note and the cards Anki would generate for it (new cards at the
 * next new position). Ids are `now` (unix ms), or one past the largest
 * existing id. Throws if no card would be generated. Cost is linear in the
 * package size per call.
 */
export function addNote(pkg: AnkiPackage, input: NewNote, options?: EditOptions): { note: Note; cards: Card[] } {
  const now = nowMs(options);
  const nt = getNotetype(pkg, input.notetypeId);
  if (!pkg.decks.some((d) => d.id === input.deckId && d.kind === "normal")) throw new Error(`deck ${input.deckId} is not a normal deck in the package`);
  const fields = resolveFields(nt, input.fields, []);
  const ords = cardOrdinalsForNote(nt, fields);
  if (ords.length === 0) {
    throw new Error(nt.kind === "cloze" ? "cloze note has no cloze deletions" : "note would have no cards: the front side of every template is empty");
  }
  const tags = checkTags(input.tags ?? []);
  const guid = input.guid ?? newGuid();
  // One pass per table (no per-call Sets): ids are `now`, or one past the largest id when `now` is not newer.
  let maxNoteId = 0;
  for (const n of pkg.notes) {
    if (n.guid === guid) throw new Error(`guid ${guid} already in use`);
    if (n.id > maxNoteId) maxNoteId = n.id;
  }
  let nextCardId = Math.floor(now);
  for (const c of pkg.cards) if (c.id >= nextCardId) nextCardId = c.id + 1;
  const secs = Math.floor(now / 1000);
  const note: Note = {
    id: Math.max(Math.floor(now), maxNoteId + 1),
    guid,
    notetypeId: nt.id,
    mtime: secs,
    usn: USN_PENDING,
    tags,
    fields,
    sortField: "",
    checksum: 0,
    flags: 0,
    data: "",
  };
  Object.assign(note, noteSortFieldAndChecksum(note, nt));
  const due = nextNewPosition(pkg);
  const deckIds = new Set(pkg.decks.filter((d) => d.kind === "normal").map((d) => d.id));
  const cards = ords.map((ord) => {
    const t = nt.kind === "cloze" ? nt.templates[0] : nt.templates.find((x) => x.ord === ord);
    const target = t?.targetDeckId && deckIds.has(t.targetDeckId) ? t.targetDeckId : input.deckId;
    const id = nextCardId++;
    const data = emptyCardData();
    return {
      id, noteId: note.id, deckId: target, ord, mtime: secs, usn: USN_PENDING, type: 0, queue: 0, due, interval: 0,
      easeFactor: 0, reps: 0, lapses: 0, left: 0, originalDue: 0, originalDeckId: 0, flags: 0, data, rawData: cardDataJson(data),
    } as Card;
  });
  pkg.notes.push(note);
  pkg.cards.push(...cards);
  registerTags(pkg, tags);
  return { note, cards };
}

/** Delete notes with their cards and those cards' review log. */
export function deleteNotes(pkg: AnkiPackage, noteIds: Iterable<number>): { notes: number; cards: number; revlog: number } {
  const ids = new Set(noteIds);
  const before = { notes: pkg.notes.length, cards: pkg.cards.length, revlog: pkg.revlog.length };
  const cardIds = new Set(pkg.cards.filter((c) => ids.has(c.noteId)).map((c) => c.id));
  pkg.notes = pkg.notes.filter((n) => !ids.has(n.id));
  pkg.cards = pkg.cards.filter((c) => !cardIds.has(c.id));
  pkg.revlog = pkg.revlog.filter((r) => !cardIds.has(r.cardId));
  pruneDerivedTags(pkg);
  return { notes: before.notes - pkg.notes.length, cards: before.cards - pkg.cards.length, revlog: before.revlog - pkg.revlog.length };
}

export type CardChange = Partial<Omit<Card, "id" | "noteId" | "rawData" | "data">> & { data?: Partial<CardData> };

/**
 * Change a card's scheduling (or deck, flags…). `data` is merged into the
 * card's `CardData`; `rawData` is regenerated. Bumps mtime and marks the
 * card unsynced unless `mtime`/`usn` are given. When a new card becomes a
 * learning/review card its new-queue position is kept in
 * `data.originalPosition`, as Anki does.
 */
export function updateCard(pkg: AnkiPackage, cardId: number, change: CardChange, options?: EditOptions): Card {
  const card = pkg.cards.find((c) => c.id === cardId);
  if (!card) throw new Error(`card ${cardId} not found`);
  const { data, ...rest } = change;
  const wasNew = card.type === 0;
  const position = card.due;
  Object.assign(card, { mtime: Math.floor(nowMs(options) / 1000), usn: USN_PENDING }, rest);
  if (data) card.data = { ...card.data, ...data, extra: { ...card.data.extra, ...(data.extra ?? {}) } };
  // Like Anki, remember a new card's position when it leaves the new queue (used by "reset"/"forget"
  // and by exports without scheduling).
  if (wasNew && card.type !== 0 && card.data.originalPosition === null && data?.originalPosition === undefined) {
    card.data = { ...card.data, originalPosition: position };
  }
  card.rawData = cardDataJson(card.data);
  return card;
}

/**
 * Append a review-log entry. `id` (the review time, unix ms) defaults to
 * `now`, moved forward if taken; `usn` defaults to −1.
 */
export function addReview(
  pkg: AnkiPackage,
  entry: Omit<RevlogEntry, "id" | "usn"> & { id?: number; usn?: number },
  options?: EditOptions,
): RevlogEntry {
  if (!pkg.cards.some((c) => c.id === entry.cardId)) throw new Error(`card ${entry.cardId} not found`);
  const id = newId(new Set(pkg.revlog.map((r) => r.id)), entry.id ?? nowMs(options));
  const r: RevlogEntry = { ...entry, id, usn: entry.usn ?? USN_PENDING };
  // keep the log in id order, as the reader returns it
  const at = pkg.revlog.findIndex((x) => x.id > id);
  if (at < 0) pkg.revlog.push(r);
  else pkg.revlog.splice(at, 0, r);
  return r;
}
