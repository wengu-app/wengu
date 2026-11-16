/**
 * Checks that an `AnkiPackage` (typically one edited in memory) can be
 * written as a package Anki imports correctly. Errors make the writer
 * refuse; warnings describe data that will be dropped or repaired.
 */
import type { AnkiPackage } from "./model.js";

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

export class AnkiPackageValidationError extends Error {
  constructor(
    readonly errors: string[],
    readonly warnings: string[],
  ) {
    const shown = errors.slice(0, 20);
    super(
      `invalid Anki package (${errors.length} error${errors.length === 1 ? "" : "s"}):\n` +
        shown.map((e) => `  - ${e}`).join("\n") +
        (errors.length > shown.length ? `\n  … and ${errors.length - shown.length} more` : ""),
    );
    this.name = "AnkiPackageValidationError";
  }
}

const I64_MIN = -(2n ** 63n);
const I64_MAX = 2n ** 63n - 1n;

function isId(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v > 0;
}
function isInt(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v);
}
function isI64String(v: string): boolean {
  if (!/^-?\d+$/.test(v)) return false;
  const b = BigInt(v);
  return b >= I64_MIN && b <= I64_MAX;
}

export function validateAnkiPackage(pkg: AnkiPackage): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const err = (m: string) => errors.push(m);

  const unique = <T>(items: readonly T[], key: (x: T) => unknown, what: string) => {
    const seen = new Set<unknown>();
    for (const x of items) {
      const k = key(x);
      if (seen.has(k)) err(`duplicate ${what} ${String(k)}`);
      seen.add(k);
    }
  };

  // --- notetypes -----------------------------------------------------------
  unique(pkg.notetypes, (n) => n.id, "notetype id");
  const notetypes = new Map(pkg.notetypes.map((n) => [n.id, n]));
  for (const nt of pkg.notetypes) {
    const w = `notetype ${nt.id} "${nt.name}"`;
    if (!isId(nt.id)) err(`${w}: id must be a positive integer`);
    if (!nt.name.trim()) err(`${w}: empty name`);
    if (nt.fields.length === 0) err(`${w}: has no fields`);
    if (nt.templates.length === 0) err(`${w}: has no card templates`);
    if (nt.kind === "cloze" && nt.templates.length !== 1) err(`${w}: a cloze notetype must have exactly one template`);
    nt.fields.forEach((f, i) => {
      if (f.ord !== i) err(`${w}: field "${f.name}" has ord ${f.ord}, expected ${i} (fields must be in ord order)`);
      if (!f.name.trim()) err(`${w}: field ${i} has an empty name`);
      if (f.id !== null && !isI64String(f.id)) err(`${w}: field "${f.name}" id "${f.id}" is not a 64-bit integer`);
    });
    nt.templates.forEach((t, i) => {
      if (t.ord !== i) err(`${w}: template "${t.name}" has ord ${t.ord}, expected ${i} (templates must be in ord order)`);
      if (!t.name.trim()) err(`${w}: template ${i} has an empty name`);
      if (t.id !== null && !isI64String(t.id)) err(`${w}: template "${t.name}" id "${t.id}" is not a 64-bit integer`);
    });
    unique(nt.fields, (f) => f.name.toLowerCase(), `${w}: field name`);
    unique(nt.templates, (t) => t.name.toLowerCase(), `${w}: template name`);
    if (!isInt(nt.sortFieldIndex) || nt.sortFieldIndex < 0 || nt.sortFieldIndex >= nt.fields.length) {
      err(`${w}: sortFieldIndex ${nt.sortFieldIndex} out of range`);
    }
  }

  // --- deck presets / decks ---------------------------------------------------
  unique(pkg.deckConfigs, (c) => c.id, "deck preset id");
  for (const c of pkg.deckConfigs) if (!isId(c.id)) err(`deck preset ${c.id}: id must be a positive integer`);
  const configIds = new Set(pkg.deckConfigs.map((c) => c.id));
  unique(pkg.decks, (d) => d.id, "deck id");
  unique(pkg.decks, (d) => d.name.toLowerCase(), "deck name");
  const decks = new Map(pkg.decks.map((d) => [d.id, d]));
  const deckNames = new Set(pkg.decks.map((d) => d.name.toLowerCase()));
  for (const d of pkg.decks) {
    const w = `deck ${d.id} "${d.name}"`;
    if (!isId(d.id)) err(`${w}: id must be a positive integer`);
    if (d.path.length === 0 || d.path.some((p) => !p.trim())) err(`${w}: empty name or name component`);
    if (d.path.join("::") !== d.name) err(`${w}: name and path disagree (${JSON.stringify(d.path)})`);
    if (d.kind === "normal") {
      if (d.configId !== null && d.configId !== 1 && !configIds.has(d.configId)) err(`${w}: deck preset ${d.configId} does not exist`);
      if (d.desiredRetention !== null && !(d.desiredRetention > 0 && d.desiredRetention < 1)) {
        err(`${w}: desiredRetention ${d.desiredRetention} must be between 0 and 1`);
      }
    } else if (!d.filtered) err(`${w}: filtered deck without filtered settings`);
    for (let i = 1; i < d.path.length; i++) {
      const parent = d.path.slice(0, i).join("::");
      if (!deckNames.has(parent.toLowerCase())) {
        warnings.push(`${w}: parent deck "${parent}" is not in the package (Anki creates it on import)`);
        break;
      }
    }
  }

  // --- notes ------------------------------------------------------------------
  unique(pkg.notes, (n) => n.id, "note id");
  unique(pkg.notes, (n) => n.guid, "note guid");
  const notes = new Map(pkg.notes.map((n) => [n.id, n]));
  for (const n of pkg.notes) {
    const w = `note ${n.id}`;
    if (!isId(n.id)) err(`${w}: id must be a positive integer`);
    if (!n.guid) err(`${w}: empty guid`);
    if (!isInt(n.mtime) || !isInt(n.usn)) err(`${w}: mtime/usn must be integers`);
    const nt = notetypes.get(n.notetypeId);
    if (!nt) err(`${w}: notetype ${n.notetypeId} does not exist`);
    else if (n.fields.length !== nt.fields.length) {
      err(`${w}: has ${n.fields.length} fields, notetype "${nt.name}" has ${nt.fields.length}`);
    }
    n.fields.forEach((f, i) => {
      if (typeof f !== "string") err(`${w}: field ${i} is not a string`);
      else if (f.includes("\x1f")) err(`${w}: field ${i} contains the field separator U+001F`);
    });
    for (const t of n.tags) if (!t || /\s/.test(t)) err(`${w}: invalid tag ${JSON.stringify(t)} (tags cannot be empty or contain whitespace)`);
  }

  // --- cards ------------------------------------------------------------------
  unique(pkg.cards, (c) => c.id, "card id");
  unique(pkg.cards, (c) => `${c.noteId}/${c.ord}`, "card (note/ord)");
  const cardIds = new Set(pkg.cards.map((c) => c.id));
  const notesWithCards = new Set<number>();
  for (const c of pkg.cards) {
    const w = `card ${c.id}`;
    if (!isId(c.id)) err(`${w}: id must be a positive integer`);
    for (const [k, v] of Object.entries({
      ord: c.ord, mtime: c.mtime, usn: c.usn, due: c.due, interval: c.interval, easeFactor: c.easeFactor, reps: c.reps,
      lapses: c.lapses, left: c.left, originalDue: c.originalDue, originalDeckId: c.originalDeckId, flags: c.flags,
    })) {
      if (!isInt(v)) err(`${w}: ${k} must be an integer (got ${String(v)})`);
    }
    const note = notes.get(c.noteId);
    if (!note) err(`${w}: note ${c.noteId} does not exist`);
    else notesWithCards.add(note.id);
    const deck = decks.get(c.deckId);
    if (!deck) err(`${w}: deck ${c.deckId} does not exist`);
    if (c.originalDeckId !== 0) {
      if (!decks.has(c.originalDeckId)) err(`${w}: original deck ${c.originalDeckId} does not exist`);
      if (deck && deck.kind !== "filtered") err(`${w}: has an original deck but is not in a filtered deck`);
    } else if (deck && deck.kind === "filtered") err(`${w}: is in filtered deck ${deck.id} but has no original deck`);
    const nt = note ? notetypes.get(note.notetypeId) : undefined;
    if (nt) {
      if (nt.kind === "normal" && !nt.templates.some((t) => t.ord === c.ord)) err(`${w}: ord ${c.ord} has no template in "${nt.name}"`);
      if (nt.kind === "cloze" && (c.ord < 0 || c.ord > 498)) err(`${w}: cloze ord ${c.ord} out of range`);
    }
    if (![0, 1, 2, 3].includes(c.type)) err(`${w}: invalid type ${c.type}`);
    if (![-3, -2, -1, 0, 1, 2, 3, 4].includes(c.queue)) err(`${w}: invalid queue ${c.queue}`);
    else if (c.queue >= 0) {
      const ok: Record<number, number[]> = { 0: [0], 1: [1, 3], 2: [2], 3: [1, 3], 4: [0, 1, 2, 3] };
      if (!ok[c.queue]!.includes(c.type)) err(`${w}: queue ${c.queue} does not match type ${c.type}`);
    }
    const d = c.data;
    const nums: [string, number | null][] = [
      ["originalPosition", d.originalPosition], ["desiredRetention", d.desiredRetention], ["decay", d.decay],
      ["lastReviewTime", d.lastReviewTime], ["stability", d.memoryState?.stability ?? null], ["difficulty", d.memoryState?.difficulty ?? null],
    ];
    for (const [k, v] of nums) if (v !== null && !Number.isFinite(v)) err(`${w}: data.${k} is not a finite number`);
    if (d.memoryState && (d.memoryState.stability <= 0 || d.memoryState.difficulty < 1 || d.memoryState.difficulty > 10)) {
      err(`${w}: implausible FSRS memory state ${JSON.stringify(d.memoryState)} (stability > 0, difficulty 1–10)`);
    }
  }
  for (const n of pkg.notes) if (!notesWithCards.has(n.id)) warnings.push(`note ${n.id} has no cards (Anki would not keep it)`);

  // --- review log ---------------------------------------------------------------
  unique(pkg.revlog, (r) => r.id, "review log id");
  let orphans = 0;
  for (const r of pkg.revlog) {
    const w = `review log ${r.id}`;
    if (!isId(r.id)) err(`${w}: id must be a positive integer (unix ms)`);
    for (const [k, v] of Object.entries({ usn: r.usn, ease: r.ease, interval: r.interval, lastInterval: r.lastInterval, factor: r.factor, taken: r.taken })) {
      if (!isInt(v)) err(`${w}: ${k} must be an integer (got ${String(v)})`);
    }
    if (r.ease < 0 || r.ease > 4) err(`${w}: ease ${r.ease} must be 0–4`);
    if (![0, 1, 2, 3, 4, 5].includes(r.kind)) err(`${w}: invalid kind ${r.kind}`);
    if (!cardIds.has(r.cardId)) orphans++;
  }
  if (orphans) warnings.push(`${orphans} review log entr${orphans === 1 ? "y refers" : "ies refer"} to cards not in the package and will not be written`);

  // --- media -----------------------------------------------------------------------
  unique(pkg.media, (m) => m.name, "media file name");
  for (const m of pkg.media) {
    if (!m.name || /[/\\\x00]/.test(m.name) || m.name === "." || m.name === "..") err(`media file ${JSON.stringify(m.name)}: invalid name`);
    if (m.name.normalize("NFC") !== m.name) warnings.push(`media file ${JSON.stringify(m.name)}: name is not NFC (Anki normalises it on import)`);
  }

  return { errors, warnings };
}
