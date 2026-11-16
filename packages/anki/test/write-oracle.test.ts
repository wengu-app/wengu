/**
 * The writer, judged by Anki: packages we write are imported by the official
 * `anki` library into empty collections, and what Anki ends up with is
 * compared with what it ends up with from the package Anki itself wrote.
 *
 * Every import runs with the clock frozen at the fixtures' export time (as in
 * fixtures/generate.py), so import-time ids and timestamps are identical and
 * the dumps are compared exactly, with no normalisation. The dump is the
 * fixtures' ground-truth dump plus every column and JSON key of the imported
 * notes, cards, review log, notetypes, decks and presets, and Anki's protobuf
 * view of notetypes, decks and presets (fixtures/reimport.py).
 *
 * Needs fixtures/.venv (anki 26.9.4) and libfaketime; skipped otherwise.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { unzipSync, zipSync } from "fflate";
import { beforeAll, describe, expect, it } from "vitest";

import type { AnkiPackage, Card, Deck, Note } from "../src/index.js";
import { addNote, addReview, deleteNotes, readAnkiPackage, updateCard, updateNote, writeAnkiPackage } from "../src/index.js";
import type { WriteOptions } from "../src/index.js";
import { FIXTURES, expected, manifest } from "./helpers.js";
import { oracleUnavailable, runOracle, type OracleDump, type OracleJob } from "./oracle.js";

const unavailable = oracleUnavailable();
const NOW = manifest().now;
const NOW_MS = NOW * 1000;
const apkg = (name: string) => join(FIXTURES, "apkg", name);
const read = (name: string) => readAnkiPackage(new Uint8Array(readFileSync(apkg(name))));
const write = (pkg: AnkiPackage, o: WriteOptions = {}) => writeAnkiPackage(pkg, { now: NOW_MS, ...o });

/** Paths where two JSON values differ (empty = equal). */
function diff(a: unknown, b: unknown, path = "", out: string[] = []): string[] {
  if (out.length > 50) return out;
  if (a === b) return out;
  if (typeof a === "object" && typeof b === "object" && a !== null && b !== null && Array.isArray(a) === Array.isArray(b)) {
    if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length) out.push(`${path}: length ${a.length} vs ${b.length}`);
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) diff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}/${k}`, out);
    return out;
  }
  if (typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b)) return out;
  out.push(`${path}: ${JSON.stringify(a)?.slice(0, 120)} vs ${JSON.stringify(b)?.slice(0, 120)}`);
  return out;
}

const FIXTURE_NAMES = ["full-latest.apkg", "full-legacy.apkg", "derived-legacy1.apkg", "shared-latest.apkg", "full-latest.colpkg"] as const;
const SUBSET_DECK = "Wengu Test::Languages";

interface Case {
  key: string;
  ours: () => Promise<Uint8Array>;
  /** Anki-written package to compare with. */
  reference: string;
  scheduling: boolean;
}

function cases(): Case[] {
  const out: Case[] = [];
  for (const name of FIXTURE_NAMES) {
    const scheduling = name !== "shared-latest.apkg";
    // A .colpkg is restored, not imported; its apkg counterpart is Anki's full export of the same collection.
    const reference = name === "full-latest.colpkg" ? "full-latest.apkg" : name;
    out.push({ key: `fixture ${name}`, ours: async () => write(await read(name)), reference, scheduling });
  }
  out.push({
    key: "fixture full-latest.apkg, imported without scheduling",
    ours: async () => write(await read("full-latest.apkg")),
    reference: "full-latest.apkg",
    scheduling: false,
  });
  const refs: [string, string, WriteOptions & { subset?: boolean }][] = [
    ["without scheduling", "ref-legacy-nosched.apkg", { includeScheduling: false }],
    ["without scheduling, with presets", "ref-legacy-nosched-presets.apkg", { includeScheduling: false, includeDeckConfigs: true }],
    ["with scheduling, without presets", "ref-legacy-sched-nopresets.apkg", { includeScheduling: true, includeDeckConfigs: false }],
    ["one deck", "ref-legacy-subdeck.apkg", { subset: true }],
    ["one deck without scheduling", "ref-legacy-subdeck-nosched.apkg", { subset: true, includeScheduling: false }],
  ];
  for (const [what, ref, { subset, ...opts }] of refs) {
    for (const scheduling of [true, false]) {
      out.push({
        key: `${what} (Anki: ${ref}), imported ${scheduling ? "with" : "without"} scheduling`,
        ours: async () => {
          // The reference exports were made by Anki from this collection (fixtures/writer_refs.py).
          const pkg = await read("full-latest.colpkg");
          const deckIds = subset ? [pkg.decks.find((d) => d.name === SUBSET_DECK)!.id] : undefined;
          return write(pkg, { ...opts, ...(deckIds ? { deckIds } : {}) });
        },
        reference: ref,
        scheduling,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// edited model
// ---------------------------------------------------------------------------

const noteBy = (pkg: AnkiPackage, front: string) => pkg.notes.find((n) => n.fields[0]!.startsWith(front))!;
const cardOf = (pkg: AnkiPackage, note: Note, ord = 0) => pkg.cards.find((c) => c.noteId === note.id && c.ord === ord)!;
const deckNamed = (pkg: AnkiPackage, name: string) => pkg.decks.find((d) => d.name === name)!;
const ntNamed = (pkg: AnkiPackage, name: string) => pkg.notetypes.find((n) => n.name === name)!;

interface Edited {
  pkg: AnkiPackage;
  deletedGuid: string;
  reviewed: Card;
  learning: Card;
  added: Note[];
  filtered: Card[];
}

async function editedModel(): Promise<Edited> {
  const pkg = await read("full-latest.apkg");
  const t = NOW_MS - 60_000;
  // 1. changed field text and tags
  const basic = noteBy(pkg, "What is the");
  updateNote(pkg, basic.id, {
    fields: { Front: 'Quelle est la <b>capitale</b> de la France&nbsp;? 法国 🇫🇷 <img src="猫 cat.png"> é' },
    tags: [...basic.tags, "edited", "編集"],
  }, { now: t });
  // 2. added notes (cards generated as Anki would)
  const added = [
    addNote(pkg, {
      notetypeId: ntNamed(pkg, "Basic (and reversed card)").id,
      deckId: deckNamed(pkg, "Wengu Test::Languages::日本語").id,
      fields: { Front: "新しい<i>単語</i>", Back: "new word 🆕 &amp; more" },
      tags: ["added", "lang::ja"],
    }, { now: t + 1 }).note,
    addNote(pkg, {
      notetypeId: ntNamed(pkg, "Cloze").id,
      deckId: deckNamed(pkg, "Wengu Test::Science::Math ∑").id,
      fields: { Text: "{{c1::42}} is {{c3::the answer}} 🤔", "Back Extra": "" },
      tags: ["added"],
    }, { now: t + 2 }).note,
    addNote(pkg, {
      notetypeId: ntNamed(pkg, "Basic").id,
      deckId: deckNamed(pkg, "Wengu Test::Misc").id,
      fields: ["  0042 ", "a numeric sort field"],
    }, { now: t + 3 }).note,
    addNote(pkg, {
      notetypeId: ntNamed(pkg, "Basic (optional reversed card)").id,
      deckId: deckNamed(pkg, "Wengu Test::Languages::中文").id,
      fields: { Front: "早上好", Back: "good morning", "Add Reverse": "" },
    }, { now: t + 4 }).note,
  ];
  // 3. deleted note (its cards and review log go with it)
  const emoji = noteBy(pkg, "Emoji");
  deleteNotes(pkg, [emoji.id]);
  // 4. reviews: a review card answered Good, a new card answered Again
  const reviewed = cardOf(pkg, basic);
  addReview(pkg, { id: t + 10, cardId: reviewed.id, ease: 3, interval: 900, lastInterval: reviewed.interval, factor: 205, taken: 4321, kind: 1 });
  updateCard(pkg, reviewed.id, {
    due: reviewed.due + 413, interval: 900, reps: reviewed.reps + 1,
    data: { memoryState: { stability: 901.2345678, difficulty: 2.0412345 }, lastReviewTime: Math.floor((t + 10) / 1000) },
  }, { now: t + 10 });
  const learning = cardOf(pkg, added[0]!);
  addReview(pkg, { id: t + 20, cardId: learning.id, ease: 1, interval: -600, lastInterval: 0, factor: 0, taken: 2500, kind: 0 });
  updateCard(pkg, learning.id, {
    type: 1, queue: 1, due: NOW + 600, left: 2, reps: 1,
    data: { memoryState: { stability: 0.4026, difficulty: 7.1949 }, desiredRetention: 0.92, decay: 0.5, lastReviewTime: Math.floor((t + 20) / 1000) },
  }, { now: t + 20 });
  // 5. changed presets and a deck-level override
  const preset = pkg.deckConfigs.find((c) => c.name === "Custom FSRS-6 预设")!;
  preset.desiredRetention = 0.88;
  preset.fsrsParams6 = preset.fsrsParams6.map((w, i) => (i === 0 ? 0.31 : w));
  preset.mtime = Math.floor(t / 1000);
  // Schema 11 keeps a per-deck desired retention as a whole percentage: 0.755 is written (as by Anki) as 75.
  deckNamed(pkg, "Wengu Test::Misc").desiredRetention = 0.755;
  // 6. a filtered deck holding two review cards
  const home = deckNamed(pkg, "Wengu Test::Languages::中文");
  const filtered: Deck = {
    ...home, id: t, name: "Filtered 筛选", path: ["Filtered 筛选"], parentId: null, mtime: Math.floor(t / 1000), usn: -1,
    kind: "filtered", configId: null, description: "", desiredRetention: null,
    filtered: {
      reschedule: true, searchTerms: [{ search: `deck:"${home.name}" is:review`, limit: 100, order: 0 }], delays: [],
      previewAgainSecs: 60, previewHardSecs: 600, previewGoodSecs: 0,
    },
    extra: { separate: true, previewDelay: 0 },
  };
  pkg.decks.push(filtered);
  const inFiltered = pkg.cards.filter((c) => c.deckId === home.id && c.queue === 2).slice(0, 2);
  inFiltered.forEach((c, i) => updateCard(pkg, c.id, { deckId: filtered.id, originalDeckId: home.id, originalDue: c.due, due: -100000 + i }, { now: t }));
  return { pkg, deletedGuid: emoji.guid, reviewed, learning, added, filtered: inFiltered };
}

// ---------------------------------------------------------------------------

describe.skipIf(unavailable !== null)("Anki imports what we write", () => {
  const all = cases();
  const results = new Map<string, { ours: OracleDump; anki: OracleDump }>();
  let fixtureImports: Map<string, OracleDump>;
  let edited: Edited;
  let editedWritten: AnkiPackage;
  let editedDump: OracleDump;
  let uneditedDump: OracleDump;
  let compatDump: OracleDump;
  let editedStripped: OracleDump;
  let editedImportedWithout: OracleDump;

  beforeAll(async () => {
    const jobs: OracleJob[] = [];
    const slots: (() => void)[] = [];
    let dumps: OracleDump[] = [];
    const add = (job: OracleJob, take: (d: OracleDump) => void) => {
      const i = jobs.push(job) - 1;
      slots.push(() => take(dumps[i]!));
    };
    for (const c of all) {
      const pair: { ours?: OracleDump; anki?: OracleDump } = {};
      add({ package: await c.ours(), scheduling: c.scheduling }, (d) => (pair.ours = d));
      add({ package: apkg(c.reference), scheduling: c.scheduling }, (d) => (pair.anki = d));
      slots.push(() => results.set(c.key, pair as { ours: OracleDump; anki: OracleDump }));
    }
    fixtureImports = new Map();
    for (const name of ["full-latest.apkg", "full-legacy.apkg", "derived-legacy1.apkg", "shared-latest.apkg"]) {
      add({ package: apkg(name), scheduling: name !== "shared-latest.apkg" }, (d) => fixtureImports.set(name, d));
    }
    edited = await editedModel();
    const editedBytes = await write(edited.pkg);
    editedWritten = await readAnkiPackage(editedBytes);
    add({ package: editedBytes, scheduling: true }, (d) => (editedDump = d));
    add({ package: await write(await read("full-latest.apkg")), scheduling: true }, (d) => (uneditedDump = d));
    // Stripping scheduling ourselves must give what Anki's importer gives when told to ignore scheduling.
    add({ package: await write(edited.pkg, { includeScheduling: false }), scheduling: true }, (d) => (editedStripped = d));
    add({ package: editedBytes, scheduling: false }, (d) => (editedImportedWithout = d));
    // The compatibility collection on its own, as Anki 2.0 would see it.
    const z = unzipSync(editedBytes);
    add({ package: zipSync({ "collection.anki2": z["collection.anki2"]!, media: new TextEncoder().encode("{}") }), scheduling: true }, (d) => (compatDump = d));
    dumps = runOracle(NOW, jobs);
    for (const s of slots) s();
  }, 300_000);

  it("the live oracle reproduces the committed ground truth for Anki's own packages", () => {
    for (const [name, dump] of fixtureImports) {
      const committed = expected(`${name}.import.json`) as unknown as Record<string, unknown>;
      const live = Object.fromEntries(Object.keys(committed).map((k) => [k, (dump as unknown as Record<string, unknown>)[k]]));
      // Normalised: ids Anki assigns to imported decks and notetypes come from the clock at import time, and
      // generate.py imported each package a few (fake) seconds after `now`.
      const strip = (d: Record<string, unknown>) => ({
        ...d,
        decks: (d["decks"] as Record<string, unknown>[]).map((x) => ({ ...x, id: 0 })),
        notetypes: (d["notetypes"] as Record<string, unknown>[]).map((x) => ({ ...x, id: 0 })),
      });
      expect(diff(strip(live), strip(committed)), name).toEqual([]);
    }
  });

  it.each(all.map((c) => c.key))("%s: same collection as from Anki's package", (key) => {
    const { ours, anki } = results.get(key)!;
    expect(ours.error).toBeUndefined();
    expect(anki.error).toBeUndefined();
    expect(diff(ours, anki)).toEqual([]);
    expect(ours.counts["notes"]).toBeGreaterThan(0);
  });

  it("Anki imports its own legacy export exactly like its latest export (nothing is lost in the legacy format)", () => {
    // Covers FSRS memory state, review log, presets with FSRS parameters, deck options, notetypes — in the
    // legacy JSON view and in Anki's protobuf view of decks, presets and notetypes.
    expect(diff(fixtureImports.get("full-legacy.apkg"), fixtureImports.get("full-latest.apkg"))).toEqual([]);
    expect(diff(fixtureImports.get("derived-legacy1.apkg"), fixtureImports.get("full-latest.apkg"))).toEqual([]);
  });

  it("edited model without scheduling: same as Anki's importer ignoring the scheduling", () => {
    expect(editedStripped.error).toBeUndefined();
    expect(diff(editedStripped, editedImportedWithout)).toEqual([]);
    const filtered = editedStripped.decks.find((d) => d.name === "Filtered 筛选")!;
    expect(filtered.dyn).toBe(false); // becomes a normal deck that keeps its cards, as in Anki
    expect(editedStripped.cards.filter((c) => c.deck === "Filtered 筛选")).toHaveLength(2);
    expect(editedStripped.counts["revlog"]).toBe(0);
  });

  it("edited model: the unedited write imports like Anki's own export", () => {
    expect(diff(uneditedDump, fixtureImports.get("full-latest.apkg"))).toEqual([]);
  });

  describe("edited model", () => {
    const ntName = (pkg: AnkiPackage, note: Note) => {
      // Anki renames imported notetypes that clash with the empty collection's stock ones ("Basic" → "Basic+");
      // take the imported name from any unedited note of the same notetype.
      const sibling = pkg.notes.find((n) => n.notetypeId === note.notetypeId && uneditedDump.notes.some((x) => x.guid === n.guid))!;
      return uneditedDump.notes.find((x) => x.guid === sibling.guid)!.notetype;
    };

    it("imports cleanly with the expected counts", () => {
      expect(editedDump.error).toBeUndefined();
      const p = edited.pkg;
      expect(editedDump.counts["notes"]).toBe(p.notes.length);
      expect(editedDump.counts["cards"]).toBe(p.cards.length);
      expect(editedDump.counts["revlog"]).toBe(p.revlog.length);
      expect(editedDump.importLog["new"]).toBe(p.notes.length);
      expect(p.notes.length).toBe(14 - 1 + 4);
      expect(p.cards.length).toBe(24 - 1 + 2 + 2 + 1 + 1);
      expect(editedDump.notes.some((n) => n.guid === edited.deletedGuid)).toBe(false);
    });

    it("has every note's fields, tags and notetype", () => {
      for (const n of edited.pkg.notes) {
        const got = editedDump.notes.find((x) => x.guid === n.guid);
        expect(got, n.guid).toBeDefined();
        const nt = edited.pkg.notetypes.find((x) => x.id === n.notetypeId)!;
        expect(got!.fields).toEqual(Object.fromEntries(nt.fields.map((f, i) => [f.name, n.fields[i]])));
        expect([...got!.tags].sort()).toEqual([...n.tags].sort());
        expect(got!.notetype).toBe(ntName(edited.pkg, n));
        expect(got!.id).toBe(n.id);
      }
      const front = edited.pkg.notes.find((n) => n.fields[0]!.startsWith("Quelle"))!.fields[0]!;
      expect(front.endsWith("é".normalize("NFC"))).toBe(true);
    });

    it("has the sort field and checksum Anki computes", () => {
      // Anki recomputes both on import; ours must agree for every note, edited or not.
      for (const raw of editedDump.raw.notes) {
        const ours = editedWritten.notes.find((n) => n.id === raw[0])!;
        expect({ sfld: ours.sortField, csum: ours.checksum }, ours.fields[0]).toEqual({ sfld: raw[7], csum: raw[8] });
      }
      const numeric = editedDump.raw.notes.find((r) => r[6].startsWith("  0042 "))!;
      expect(numeric[7]).toBe(42);
    });

    it("has every card with its scheduling state and FSRS memory state", () => {
      // Review-queue due dates are day numbers; Anki shifts them to the importing collection's day count.
      const shift = (() => {
        const before = cardOf(edited.pkg, noteBy(edited.pkg, "Which animal?"));
        return before.due - uneditedDump.cards.find((c) => c.id === before.id)!.due;
      })();
      expect(shift).toBe(220);
      const decks = new Map(edited.pkg.decks.map((d) => [d.id, d.name]));
      for (const c of edited.pkg.cards) {
        const note = edited.pkg.notes.find((n) => n.id === c.noteId)!;
        const got = editedDump.cards.find((x) => x.noteGuid === note.guid && x.ord === c.ord);
        expect(got, `${note.guid}#${c.ord}`).toBeDefined();
        const g = got!;
        const raw = editedDump.raw.cards.find((x) => x[0] === c.id)!;
        const filtered = c.originalDeckId !== 0;
        expect({
          id: g.id, deck: g.deck, type: g.type, queue: g.queue, due: g.due, ivl: g.ivl, factor: g.factor, reps: g.reps,
          lapses: g.lapses, left: g.left, flags: g.flags, odeck: raw[15], odue: g.odue, lrt: g.lastReviewTime,
        }).toEqual({
          id: c.id, deck: decks.get(c.deckId), type: c.type, queue: c.queue,
          // Anki shifts every review/day-learning due on import, even the position-like due of a card in a filtered deck.
          due: c.queue === 2 || c.queue === 3 ? c.due - shift : c.due,
          ivl: c.interval, factor: c.easeFactor, reps: c.reps, lapses: c.lapses, left: c.left, flags: c.flags,
          odeck: filtered ? decks.get(c.originalDeckId) : 0, odue: filtered ? c.originalDue - shift : 0,
          lrt: c.data.lastReviewTime,
        });
        if (c.data.memoryState) {
          expect(g.memoryState!.stability).toBeCloseTo(c.data.memoryState.stability, 3);
          expect(g.memoryState!.difficulty).toBeCloseTo(c.data.memoryState.difficulty, 3);
          expect(g.desiredRetention).toBeCloseTo(c.data.desiredRetention!, 5);
          expect(g.decay).toBeCloseTo(c.data.decay!, 5);
        } else {
          expect(g.memoryState).toBeNull();
        }
      }
      const learning = editedDump.cards.find((x) => x.id === edited.learning.id)!;
      expect([learning.type, learning.queue, learning.due, learning.left]).toEqual([1, 1, NOW + 600, 2]);
    });

    it("has the complete review log, including the new entries", () => {
      const rows = edited.pkg.revlog.map((r) => [r.id, r.cardId, r.usn, r.ease, r.interval, r.lastInterval, r.factor, r.taken, r.kind]);
      expect(editedDump.revlog).toEqual(rows);
      expect(editedDump.revlog.filter((r) => r[1] === edited.reviewed.id || r[1] === edited.learning.id).length).toBeGreaterThan(2);
    });

    it("has the changed presets and deck override", () => {
      const preset = editedDump.deckConfigs.find((c) => c.name === "Custom FSRS-6 预设")!;
      expect(preset.desiredRetention).toBeCloseTo(0.88, 6);
      expect(preset.fsrsParams6[0]).toBeCloseTo(0.31, 6);
      expect(editedDump.decks.find((d) => d.name === "Wengu Test::Misc")!.desiredRetention).toBe(75);
      const filtered = editedDump.decks.find((d) => d.name === "Filtered 筛选")!;
      expect(filtered.dyn).toBe(true);
      expect(edited.filtered).toHaveLength(2);
    });

    it("has the media and the same rendering as our renderer's inputs", () => {
      expect(Object.keys(editedDump.media).sort()).toEqual(edited.pkg.media.map((m) => m.name).sort());
      const card = editedDump.cards.find((x) => x.id === edited.reviewed.id)!;
      expect(card.render.question).toContain("法国 🇫🇷");
    });
  });

  it("the compatibility collection.anki2 is a valid collection asking to update Anki", () => {
    expect(compatDump.error).toBeUndefined();
    expect(compatDump.counts["notes"]).toBe(1);
    expect(Object.values(compatDump.notes[0]!.fields)[0]).toBe("Please update to the latest Anki version, then import the .colpkg/.apkg file again.");
  });
});

describe.runIf(unavailable !== null)("Anki import oracle", () => {
  it.skip(`skipped: ${unavailable}`, () => {});
});
