/**
 * Content fidelity: everything Anki put in the package comes back out.
 * Ground truth is Anki's own view of the source collection
 * (fixtures/expected/source.json) and of each package after Anki imports it
 * (fixtures/expected/<pkg>.import.json).
 */
import { describe, expect, it } from "vitest";

import type { AnkiPackage, Card } from "../src/index.js";
import { expected, loadPackage, sha1 } from "./helpers.js";

const source = expected("source.json");

/** Packages that carry the full collection with scheduling. */
const FULL = ["full-latest.apkg", "full-legacy.apkg", "derived-legacy1.apkg", "full-latest.colpkg"] as const;
const ALL = [...FULL, "shared-latest.apkg"] as const;

const FORMATS: Record<(typeof ALL)[number], { entry: string; meta: number | null; schema: number; manifest: string }> = {
  "full-latest.apkg": { entry: "collection.anki21b", meta: 3, schema: 18, manifest: "protobuf" },
  "full-latest.colpkg": { entry: "collection.anki21b", meta: 3, schema: 18, manifest: "protobuf" },
  "shared-latest.apkg": { entry: "collection.anki21b", meta: 3, schema: 18, manifest: "protobuf" },
  "full-legacy.apkg": { entry: "collection.anki21", meta: 2, schema: 11, manifest: "json" },
  "derived-legacy1.apkg": { entry: "collection.anki2", meta: null, schema: 11, manifest: "json" },
};

function cardKey(pkg: AnkiPackage, c: Card): string {
  const note = pkg.notes.find((n) => n.id === c.noteId)!;
  return `${note.guid}#${c.ord}`;
}

describe.each(ALL)("%s", (name) => {
  it("detects the package format", async () => {
    const pkg = await loadPackage(name);
    const f = FORMATS[name];
    expect(pkg.format.collectionEntry).toBe(f.entry);
    expect(pkg.format.metaVersion).toBe(f.meta);
    expect(pkg.format.schemaVersion).toBe(f.schema);
    expect(pkg.format.mediaManifest).toBe(f.manifest);
    expect(pkg.format.zstdCollection).toBe(f.schema === 18);
    expect(pkg.warnings).toEqual([]);
  });

  it("has the same notes as Anki (fields, tags, notetype)", async () => {
    const pkg = await loadPackage(name);
    expect(pkg.notes).toHaveLength(source.counts["notes"]!);
    const nts = new Map(pkg.notetypes.map((n) => [n.id, n]));
    for (const exp of source.notes) {
      const note = pkg.notes.find((n) => n.guid === exp.guid);
      expect(note, exp.guid).toBeDefined();
      const nt = nts.get(note!.notetypeId)!;
      expect(nt.name).toBe(exp.notetype);
      const fields = Object.fromEntries(nt.fields.map((f, i) => [f.name, note!.fields[i]]));
      expect(fields).toEqual(exp.fields);
      expect(Object.keys(fields)).toEqual(Object.keys(exp.fields)); // same order
      // Exporting without scheduling strips the "marked"/"leech" tags (observed);
      // for that package compare with what Anki itself imports.
      const expTags = name === "shared-latest.apkg" ? expected(`${name}.import.json`).notes.find((n) => n.guid === exp.guid)!.tags : exp.tags;
      expect(note!.tags).toEqual(expTags);
      expect(note!.id).toBe(exp.id);
    }
  });

  it("has the same notetypes (fields, templates, CSS, LaTeX)", async () => {
    const pkg = await loadPackage(name);
    // Every notetype used by a note must match Anki's definition exactly.
    for (const exp of source.notetypes) {
      const nt = pkg.notetypes.find((n) => n.name === exp.name);
      if (!nt) {
        // apkg exports only include notetypes that notes use
        expect(source.notes.some((n) => n.notetype === exp.name)).toBe(false);
        continue;
      }
      expect(nt.id).toBe(exp.id);
      expect(nt.kind).toBe(exp.type === 1 ? "cloze" : "normal");
      expect(nt.css).toBe(exp.css);
      expect(nt.sortFieldIndex).toBe(exp.sortf);
      expect(nt.latexPre).toBe(exp.latexPre);
      expect(nt.latexPost).toBe(exp.latexPost);
      expect(nt.fields.map((f) => f.name)).toEqual(exp.fields);
      expect(nt.templates.map((t) => ({ name: t.name, qfmt: t.qfmt, afmt: t.afmt }))).toEqual(exp.templates);
    }
  });

  it("has the same decks and hierarchy", async () => {
    const pkg = await loadPackage(name);
    const names = pkg.decks.map((d) => d.name).sort();
    // An apkg contains the decks its cards are in plus their parents.
    const used = new Set(source.cards.map((c) => c.deck));
    for (const exp of source.decks) {
      const deck = pkg.decks.find((d) => d.name === exp.name);
      if (!deck) {
        expect(used.has(exp.name), `missing used deck ${exp.name}`).toBe(false);
        continue;
      }
      expect(deck.kind).toBe(exp.dyn ? "filtered" : "normal");
      expect(deck.description).toBe(exp.desc);
      if (name !== "shared-latest.apkg") {
        expect(deck.desiredRetention).toBe(exp.desiredRetention === null ? null : exp.desiredRetention / 100);
        const preset = source.deckConfigs.find((c) => c.id === exp.conf)!;
        expect(pkg.deckConfigs.find((c) => c.id === deck.configId)?.name).toBe(preset.name);
      }
      if (deck.path.length > 1) {
        const parent = pkg.decks.find((d) => d.id === deck.parentId);
        expect(parent?.name).toBe(deck.path.slice(0, -1).join("::"));
      }
    }
    expect(names).toContain("Wengu Test::Science::Math ∑");
  });

  it("has the same cards and scheduling state", async () => {
    const pkg = await loadPackage(name);
    expect(pkg.cards).toHaveLength(source.counts["cards"]!);
    const decks = new Map(pkg.decks.map((d) => [d.id, d.name]));
    const sched = name !== "shared-latest.apkg";
    const imported = expected(`${name}.import.json`);
    for (const exp of source.cards) {
      const card = pkg.cards.find((c) => cardKey(pkg, c) === `${exp.noteGuid}#${exp.ord}`);
      expect(card, `${exp.noteGuid}#${exp.ord}`).toBeDefined();
      const c = card!;
      expect(decks.get(c.deckId)).toBe(exp.deck);
      expect(c.id).toBe(exp.id);
      if (sched) {
        expect({
          type: c.type, queue: c.queue, due: c.due, ivl: c.interval, factor: c.easeFactor, reps: c.reps,
          lapses: c.lapses, left: c.left, flags: c.flags, odid: c.originalDeckId, odue: c.originalDue, data: c.rawData,
        }).toEqual({
          type: exp.type, queue: exp.queue, due: exp.due, ivl: exp.ivl, factor: exp.factor, reps: exp.reps,
          lapses: exp.lapses, left: exp.left, flags: exp.flags, odid: exp.odid, odue: exp.odue, data: exp.data,
        });
        // Anki's Card object exposes memory state from the data column at f32 precision.
        if (exp.memoryState) {
          expect(c.data.memoryState!.stability).toBeCloseTo(exp.memoryState.stability, 3);
          expect(c.data.memoryState!.difficulty).toBeCloseTo(exp.memoryState.difficulty, 3);
          expect(c.data.desiredRetention).toBeCloseTo(exp.desiredRetention!, 5);
          expect(c.data.decay).toBeCloseTo(exp.decay!, 5);
          expect(c.data.lastReviewTime).toBe(exp.lastReviewTime);
        } else {
          expect(c.data.memoryState).toBeNull();
        }
      } else {
        // Scheduling stripped on export: compare with what Anki imports.
        const imp = imported.cards.find((x) => x.noteGuid === exp.noteGuid && x.ord === exp.ord)!;
        expect({ type: c.type, queue: c.queue, ivl: c.interval, reps: c.reps, lapses: c.lapses }).toEqual({
          type: imp.type, queue: imp.queue, ivl: imp.ivl, reps: imp.reps, lapses: imp.lapses,
        });
        expect(c.data.memoryState).toBeNull();
      }
    }
  });

  it("has the full review log", async () => {
    const pkg = await loadPackage(name);
    if (name === "shared-latest.apkg") {
      expect(pkg.revlog).toEqual([]);
      return;
    }
    const rows = pkg.revlog.map((r) => [r.id, r.cardId, r.usn, r.ease, r.interval, r.lastInterval, r.factor, r.taken, r.kind]);
    expect(rows).toEqual(source.revlog);
    expect(pkg.revlog.some((r) => r.kind === 4)).toBe(true); // the manual "set due date" entry
  });

  it("has the deck presets including FSRS parameters", async () => {
    const pkg = await loadPackage(name);
    if (name === "shared-latest.apkg") {
      // exported without deck configs: only the default preset remains
      expect(pkg.deckConfigs.map((c) => c.id)).toEqual([1]);
      return;
    }
    expect(pkg.deckConfigs).toHaveLength(source.deckConfigs.length);
    for (const exp of source.deckConfigs) {
      const c = pkg.deckConfigs.find((x) => x.id === exp.id)!;
      expect(c.name).toBe(exp.name);
      expect(c.learnSteps).toEqual(exp.learnSteps);
      expect(c.relearnSteps).toEqual(exp.relearnSteps);
      expect(c.newPerDay).toBe(exp.newPerDay);
      expect(c.reviewsPerDay).toBe(exp.reviewsPerDay);
      expect(c.maximumReviewInterval).toBe(exp.maxIvl);
      expect(c.desiredRetention).toBeCloseTo(exp.desiredRetention, 6);
      expect(c.fsrsParams4).toEqual(exp.fsrsParams4);
      expect(c.fsrsParams5).toEqual(exp.fsrsParams5);
      expect(c.fsrsParams6).toEqual(exp.fsrsParams6);
    }
  });

  it("has every media file, byte-exact", async () => {
    const pkg = await loadPackage(name);
    const got = Object.fromEntries(pkg.media.map((m) => [m.name, { size: m.data.length, sha1: sha1(m.data) }]));
    expect(got).toEqual(source.media);
    for (const m of pkg.media) if (m.sha1) expect(m.sha1).toBe(sha1(m.data));
  });

  it("has every tag", async () => {
    const pkg = await loadPackage(name);
    const notes = name === "shared-latest.apkg" ? expected(`${name}.import.json`).notes : source.notes;
    const used = new Set(notes.flatMap((n) => n.tags));
    expect(new Set(pkg.tags.map((t) => t.name))).toEqual(used);
    // Anki's registry lists the same tags (and their parents are implicit).
    expect(source.tags.filter((t) => used.has(t)).sort()).toEqual([...used].sort());
  });
});

describe("cross-format consistency", () => {
  it("latest (schema 18 + protobuf) and legacy (schema 11 + JSON) map to the same model", async () => {
    const latest = await loadPackage("full-latest.apkg");
    const legacy = await loadPackage("full-legacy.apkg");
    expect(legacy.notes).toEqual(latest.notes);
    expect(legacy.cards).toEqual(latest.cards);
    expect(legacy.revlog).toEqual(latest.revlog);
    const strip = <T extends { extra: unknown; mtime: number; usn: number }>(x: T) => Object.assign({}, x, { extra: undefined, mtime: 0, usn: 0 });
    expect(legacy.deckConfigs.map(strip)).toEqual(latest.deckConfigs.map(strip));
    const ntStrip = (n: AnkiPackage["notetypes"][number]) => Object.assign(strip(n), {
      fields: n.fields.map((f) => ({ ...f, extra: undefined })),
      templates: n.templates.map((t) => ({ ...t, extra: undefined, mtime: 0, usn: 0 })),
    });
    expect(legacy.notetypes.map(ntStrip)).toEqual(latest.notetypes.map(ntStrip));
    const deckStrip = (d: AnkiPackage["decks"][number]) => strip(d);
    expect(legacy.decks.map(deckStrip)).toEqual(latest.decks.map(deckStrip));
  });
});
