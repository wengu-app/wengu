/**
 * The writer without the Anki oracle: round trips through our own reader,
 * byte-level comparison with packages Anki exported (fixtures/writer_refs.py),
 * 64-bit ids, validation and the editing helpers.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { unzipSync } from "fflate";
import initSqlJs from "sql.js";
import { describe, expect, it } from "vitest";

import type { AnkiPackage, WriteOptions } from "../src/index.js";
import {
  AnkiPackageValidationError,
  addNote,
  addReview,
  cardOrdinalsForNote,
  deleteNotes,
  newId,
  packageForExport,
  readAnkiPackage,
  updateCard,
  updateNote,
  validateAnkiPackage,
  writeAnkiPackage,
  writeAnkiPackageChunks,
} from "../src/index.js";
import { parseJsonExact } from "../src/json.js";
import { FIXTURES, manifest, sha1 } from "./helpers.js";

const NOW_MS = manifest().now * 1000;
const fixture = (name: string) => new Uint8Array(readFileSync(join(FIXTURES, "apkg", name)));
/** A fresh (mutable) copy of a fixture's model. */
const fresh = (name: string) => readAnkiPackage(fixture(name));
const write = (pkg: AnkiPackage, o: WriteOptions = {}) => writeAnkiPackage(pkg, { now: NOW_MS, ...o });
const roundTrip = async (pkg: AnkiPackage, o: WriteOptions = {}) => readAnkiPackage(await write(pkg, o));

/** Model without the parts that describe the container rather than the content. */
function content(pkg: AnkiPackage) {
  const { format: _format, media, ...rest } = pkg;
  return { ...rest, media: media.map((m) => ({ name: m.name, sha1: sha1(m.data) })) };
}

describe("read → write → read", () => {
  it("full-legacy.apkg: identical model, including the format", async () => {
    const pkg = await fresh("full-legacy.apkg");
    const again = await roundTrip(pkg);
    expect(again.format).toEqual(pkg.format);
    expect(again).toEqual(pkg);
  });

  it("derived-legacy1.apkg: identical content (written as legacy 2: collection.anki21 + meta)", async () => {
    const pkg = await fresh("derived-legacy1.apkg");
    const again = await roundTrip(pkg);
    expect(content(again)).toEqual(content(pkg));
    expect(again.format).toEqual({ metaVersion: 2, collectionEntry: "collection.anki21", schemaVersion: 11, zstdCollection: false, mediaManifest: "json" });
  });

  it("full-latest.apkg: the same model the reader gets from Anki's own legacy export of that collection", async () => {
    // Anki exported full-latest.apkg and full-legacy.apkg from one collection. Writing the latest one as
    // legacy must give what Anki gave, apart from the collection row Anki stamps at export time.
    const ours = await roundTrip(await fresh("full-latest.apkg"));
    const anki = await fresh("full-legacy.apkg");
    const stamp = (p: AnkiPackage) => ({ ...content(p), collection: { ...p.collection, mod: 0, scm: 0, config: { ...p.collection.config, curModel: 0 } } });
    expect(stamp(ours)).toEqual(stamp(anki));
    expect(ours.format).toEqual(anki.format);
  });

  it.each(["full-latest.apkg", "shared-latest.apkg", "full-latest.colpkg"])(
    "%s: everything but what schema 11 represents differently",
    async (name) => {
      const pkg = await fresh(name);
      const again = await roundTrip(pkg);
      // Schema 11 has no per-template mtime/usn (the reader uses the notetype's), always has the legacy keys
      // "did" (notetypes) and "dyn" (presets), has no tag "collapsed" flag, and a JSON media map without SHA-1s.
      const norm = (p: AnkiPackage) => ({
        ...content(p),
        notetypes: p.notetypes.map((n) => ({
          ...n,
          extra: { did: null, ...n.extra },
          templates: n.templates.map((t) => ({ ...t, mtime: 0, usn: 0 })),
        })),
        deckConfigs: p.deckConfigs.map((c) => ({ ...c, extra: { dyn: false, ...c.extra } })),
        tags: p.tags.map((t) => ({ ...t, collapsed: false })),
      });
      expect(norm(again)).toEqual(norm(pkg));
    },
  );

  it("keeps Chinese, Japanese, emoji and RTL text byte-exact", async () => {
    const pkg = await fresh("full-latest.apkg");
    const again = await roundTrip(pkg);
    const texts = (p: AnkiPackage) => p.notes.flatMap((n) => n.fields).join("\u0000");
    expect(texts(again)).toBe(texts(pkg));
    for (const s of ["你好", "「ありがとう」", "👨‍👩‍👧", "שלום", "🇨🇳"]) expect(texts(again)).toContain(s);
    expect(again.decks.map((d) => d.name)).toContain("Wengu Test::Science::Math ∑");
    expect(again.media.map((m) => m.name)).toContain("hello-你好.wav");
  });
});

describe("same bytes as Anki's own export", () => {
  // Raw comparison of the written collection.anki21 with packages Anki exported from the same collection
  // (fixtures/writer_refs.py). Normalised: the col row's mod/scm/conf (export-time stamps and the source
  // collection's settings, which Anki replaces with defaults), the tag registry (Anki writes {}), and
  // notetypes no note uses (we keep them; Anki's full export leaves them out, its importer ignores them).
  let SQL: Awaited<ReturnType<typeof initSqlJs>>;
  async function tables(bytes: Uint8Array) {
    SQL ??= await initSqlJs();
    const z = unzipSync(bytes);
    const db = new SQL.Database(z["collection.anki21"]!);
    try {
      const q = (s: string) => db.exec(s)[0]?.values ?? [];
      const col = q("select crt, ver, dty, usn, ls, models, decks, dconf from col")[0]!;
      const notes = q("select * from notes order by id");
      const usedNt = new Set(notes.map((n) => String(n[2])));
      const models = parseJsonExact(String(col[5])) as Record<string, unknown>;
      return {
        names: Object.keys(z),
        col: {
          crt: col[0], ver: col[1], dty: col[2], usn: col[3], ls: col[4],
          models: Object.fromEntries(Object.entries(models).filter(([id]) => usedNt.has(id))),
          decks: parseJsonExact(String(col[6])),
          dconf: parseJsonExact(String(col[7])),
        },
        notes,
        cards: q("select * from cards order by id"),
        revlog: q("select * from revlog order by id"),
        sqlTypes: q("select typeof(sfld), typeof(id), typeof(csum), count(*) from notes group by 1, 2, 3"),
        media: Object.fromEntries(
          Object.entries(JSON.parse(new TextDecoder().decode(z["media"]!)) as Record<string, string>).map(([k, name]) => [name, sha1(z[k]!)]),
        ),
      };
    } finally {
      db.close();
    }
  }

  const languages = (p: AnkiPackage) => [p.decks.find((d) => d.name === "Wengu Test::Languages")!.id];
  it.each<[string, (p: AnkiPackage) => WriteOptions]>([
    ["full-legacy.apkg", () => ({})],
    ["ref-legacy-nosched.apkg", () => ({ includeScheduling: false })],
    ["ref-legacy-nosched-presets.apkg", () => ({ includeScheduling: false, includeDeckConfigs: true })],
    ["ref-legacy-sched-nopresets.apkg", () => ({ includeDeckConfigs: false })],
    ["ref-legacy-subdeck.apkg", (p) => ({ deckIds: languages(p) })],
    ["ref-legacy-subdeck-nosched.apkg", (p) => ({ includeScheduling: false, deckIds: languages(p) })],
  ])("%s", async (ref, opts) => {
    const pkg = await fresh("full-latest.colpkg");
    const ours = await tables(await write(pkg, opts(pkg)));
    const anki = await tables(fixture(ref));
    expect(ours).toEqual(anki);
  });

  it("writes the 64-bit field and template ids exactly, as bare JSON integers", async () => {
    const pkg = await fresh("full-latest.apkg");
    const z = unzipSync(await write(pkg));
    SQL ??= await initSqlJs();
    const db = new SQL.Database(z["collection.anki21"]!);
    const models = String(db.exec("select models from col")[0]!.values[0]![0]);
    db.close();
    const ids = pkg.notetypes.flatMap((n) => [...n.fields, ...n.templates].map((x) => x.id!));
    expect(ids.length).toBeGreaterThan(20);
    expect(ids.some((id) => !Number.isSafeInteger(Number(id)))).toBe(true);
    for (const id of ids) expect(models).toMatch(new RegExp(`"id":${id}[,}]`));
  });
});

describe("package layout", () => {
  it("has Anki's entries in Anki's order, media stored and the collection deflated", async () => {
    const pkg = await fresh("full-latest.apkg");
    const bytes = await write(pkg);
    const z = unzipSync(bytes);
    expect([...z["meta"]!]).toEqual([0x08, 0x02]);
    // walk the local headers: entry order and compression method
    const methods: [string, number][] = [];
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let off = 0; dv.getUint32(off, true) === 0x04034b50;) {
      const nameLen = dv.getUint16(off + 26, true);
      const name = new TextDecoder().decode(bytes.subarray(off + 30, off + 30 + nameLen));
      methods.push([name, dv.getUint16(off + 8, true)]);
      expect(dv.getUint16(off + 6, true) & 0x08).toBe(0); // sizes in the local header, no data descriptor
      off += 30 + nameLen + dv.getUint32(off + 18, true);
    }
    expect(methods).toEqual([["meta", 0], ["collection.anki21", 8], ["collection.anki2", 0], ["0", 0], ["1", 0], ["2", 0], ["media", 0]]);
  });

  it("streams the same bytes in chunks, passing media through without copying", async () => {
    const pkg = await fresh("full-latest.apkg");
    const whole = await write(pkg);
    const chunks: Uint8Array[] = [];
    await writeAnkiPackageChunks(pkg, { now: NOW_MS }, (c) => chunks.push(c));
    expect(Buffer.concat(chunks).equals(Buffer.from(whole))).toBe(true);
    for (const m of pkg.media) expect(chunks.some((c) => c === m.data)).toBe(true);
  });

  it("can leave media out, and a deck export carries only the media its notes use", async () => {
    const pkg = await fresh("full-latest.apkg");
    expect((await roundTrip(pkg, { includeMedia: false })).media).toEqual([]);
    const ja = pkg.decks.find((d) => d.name === "Wengu Test::Languages::日本語")!.id;
    expect((await roundTrip(pkg, { deckIds: [ja] })).media.map((m) => m.name).sort()).toEqual(["diagram.png", "hello-你好.wav"]);
    const misc = pkg.decks.find((d) => d.name === "Wengu Test::Misc")!.id;
    expect((await roundTrip(pkg, { deckIds: [misc] })).media.map((m) => m.name)).toEqual(["猫 cat.png"]);
  });
});

describe("without scheduling", () => {
  it("matches what Anki strips", async () => {
    const pkg = await fresh("full-latest.apkg");
    const v = packageForExport(pkg, { includeScheduling: false });
    expect(v.revlog).toEqual([]);
    expect(v.cards.every((c) => c.type === 0 && c.queue === 0 && c.interval === 0 && c.reps === 0 && c.data.memoryState === null)).toBe(true);
    expect(v.notes.some((n) => n.tags.includes("marked"))).toBe(false);
    expect(v.deckConfigs.map((c) => c.id)).toEqual([1]);
    expect(pkg.revlog.length).toBeGreaterThan(0); // input untouched
    expect(pkg.notes.some((n) => n.tags.includes("marked"))).toBe(true);
  });

  it("puts reviewed cards back at their original new position, or after the last one if unknown", async () => {
    // Observed with Anki 26.09: a reviewed card without data.pos gets the next free position.
    const pkg = await fresh("full-latest.apkg");
    const reviewed = pkg.cards.filter((c) => c.type === 2);
    reviewed[0]!.data.originalPosition = null;
    const v = packageForExport(pkg, { includeScheduling: false });
    const due = (id: number) => v.cards.find((c) => c.id === id)!.due;
    expect(due(reviewed[1]!.id)).toBe(reviewed[1]!.data.originalPosition);
    expect(due(reviewed[0]!.id)).toBe(15);
    expect(v.cards.find((c) => c.id === reviewed[1]!.id)!.rawData).not.toMatch(/"pos"|"s"|"d"/);
  });
});

describe("validation", () => {
  const errorsOf = async (edit: (p: AnkiPackage) => void) => {
    const p = await fresh("full-latest.apkg");
    edit(p);
    return validateAnkiPackage(p).errors;
  };

  it("accepts every fixture", async () => {
    for (const name of ["full-latest.apkg", "full-legacy.apkg", "derived-legacy1.apkg", "shared-latest.apkg", "full-latest.colpkg"]) {
      expect(validateAnkiPackage(await fresh(name))).toEqual({ errors: [], warnings: [] });
    }
  });

  it.each<[string, (p: AnkiPackage) => void, RegExp]>([
    ["missing notetype", (p) => (p.notes[0]!.notetypeId = 42), /note \d+: notetype 42 does not exist/],
    ["wrong field count", (p) => p.notes[0]!.fields.push("x"), /has 3 fields, notetype "Basic" has 2/],
    ["field separator in a field", (p) => (p.notes[0]!.fields[1] = "a\x1fb"), /contains the field separator/],
    ["tag with a space", (p) => (p.notes[0]!.tags = ["two words"]), /invalid tag "two words"/],
    ["duplicate guid", (p) => (p.notes[1]!.guid = p.notes[0]!.guid), /duplicate note guid/],
    ["card without note", (p) => (p.cards[0]!.noteId = 7), /card \d+: note 7 does not exist/],
    ["card in missing deck", (p) => (p.cards[0]!.deckId = 7), /card \d+: deck 7 does not exist/],
    ["unsafe id", (p) => (p.cards[0]!.id = 2 ** 60), /id must be a positive integer/],
    ["fractional due", (p) => (p.cards[0]!.due = 1.5), /due must be an integer/],
    ["queue/type mismatch", (p) => (p.cards[0]!.queue = 2) && (p.cards[0]!.type = 0), /queue 2 does not match type 0/],
    ["bad memory state", (p) => (p.cards[0]!.data.memoryState = { stability: -1, difficulty: 5 }), /implausible FSRS memory state/],
    ["ord without template", (p) => (p.cards[0]!.ord = 5), /ord 5 has no template/],
    ["missing preset", (p) => (p.decks[1]!.configId = 99), /deck preset 99 does not exist/],
    ["field id not 64-bit", (p) => (p.notetypes[0]!.fields[0]!.id = "99999999999999999999"), /not a 64-bit integer/],
    ["duplicate media", (p) => p.media.push({ ...p.media[0]! }), /duplicate media file name/],
    ["media name with a slash", (p) => (p.media[0]!.name = "a/b.png"), /invalid name/],
    ["revlog ease", (p) => (p.revlog[0]!.ease = 9), /ease 9 must be 0–4/],
  ])("rejects %s", async (_what, edit, re) => {
    const errors = await errorsOf(edit);
    expect(errors.some((e) => re.test(e)), errors.join("\n")).toBe(true);
  });

  it("refuses to write an invalid model, with a readable message", async () => {
    const p = await fresh("full-latest.apkg");
    p.notes[0]!.notetypeId = 42;
    await expect(write(p)).rejects.toThrow(AnkiPackageValidationError);
    await expect(write(p)).rejects.toThrow(/invalid Anki package \(1 error\):\n {2}- note \d+: notetype 42 does not exist/);
  });

  it("warns about review log entries of deleted cards and drops them", async () => {
    const p = await fresh("full-latest.apkg");
    p.cards = p.cards.filter((c) => c.id !== p.revlog[0]!.cardId);
    p.notes = p.notes.filter((n) => p.cards.some((c) => c.noteId === n.id));
    const warnings: string[] = [];
    const again = await roundTrip(p, { onWarning: (w) => warnings.push(w) });
    expect(warnings.join("\n")).toMatch(/review log entr.* not in the package/);
    expect(again.revlog.every((r) => again.cards.some((c) => c.id === r.cardId))).toBe(true);
  });
});

describe("editing helpers", () => {
  it("edited model survives read → write → read unchanged", async () => {
    const p = await fresh("full-legacy.apkg");
    const basic = p.notes.find((n) => n.fields[0]!.startsWith("What is"))!;
    updateNote(p, basic.id, { fields: { Back: "Paris 🇫🇷 &amp; <b>more</b>" }, tags: ["geo", "edited"] }, { now: NOW_MS });
    const { note } = addNote(p, { notetypeId: basic.notetypeId, deckId: p.decks[1]!.id, fields: ["新しい", "new"], tags: ["新"] }, { now: NOW_MS });
    const card = p.cards.find((c) => c.noteId === note.id)!;
    addReview(p, { cardId: card.id, ease: 3, interval: 1, lastInterval: 0, factor: 2500, taken: 1000, kind: 0 }, { now: NOW_MS });
    updateCard(p, card.id, { type: 2, queue: 2, due: 300, interval: 1, data: { memoryState: { stability: 1.5, difficulty: 5.25 } } }, { now: NOW_MS });
    deleteNotes(p, [p.notes.find((n) => n.fields[0]!.startsWith("Emoji"))!.id]);
    expect(validateAnkiPackage(p).errors).toEqual([]);
    const again = await roundTrip(p);
    expect(content(again)).toEqual(content(p));
  });

  it("generates the cards Anki would", async () => {
    const p = await fresh("full-latest.apkg");
    const nt = (name: string) => p.notetypes.find((n) => n.name === name)!;
    // The fixtures' own notes: generated ordinals equal the cards Anki made.
    for (const n of p.notes) {
      const ords = p.cards.filter((c) => c.noteId === n.id).map((c) => c.ord).sort((a, b) => a - b);
      expect(cardOrdinalsForNote(p.notetypes.find((x) => x.id === n.notetypeId)!, n.fields), n.fields[0]).toEqual(ords);
    }
    expect(cardOrdinalsForNote(nt("Basic (optional reversed card)"), ["a", "b", ""])).toEqual([0]);
    expect(cardOrdinalsForNote(nt("Basic (optional reversed card)"), ["a", "b", "y"])).toEqual([0, 1]);
    expect(cardOrdinalsForNote(nt("Cloze"), ["{{c2::a}} {{c5::b}}", ""])).toEqual([1, 4]);
    expect(() => addNote(p, { notetypeId: nt("Basic").id, deckId: 1, fields: ["", "back only"] })).toThrow(/no cards/);
    expect(() => addNote(p, { notetypeId: nt("Cloze").id, deckId: 1, fields: ["no cloze", ""] })).toThrow(/no cloze/);
  });

  it("keeps sort field, checksum, timestamps and ids consistent", async () => {
    const p = await fresh("full-latest.apkg");
    const basic = p.notetypes.find((n) => n.name === "Basic")!;
    const { note, cards } = addNote(p, { notetypeId: basic.id, deckId: 1, fields: { Front: " 007 ", Back: "é" } }, { now: NOW_MS });
    expect(note.sortField).toBe(7);
    expect(note.fields[1]).toBe("é");
    expect(note.mtime).toBe(NOW_MS / 1000);
    expect(note.usn).toBe(-1);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.due).toBe(Math.max(...p.cards.filter((c) => c !== cards[0] && c.type === 0).map((c) => c.due), ...p.cards.map((c) => c.data.originalPosition ?? 0)) + 1);
    expect(new Set(p.cards.map((c) => c.id)).size).toBe(p.cards.length);
    updateNote(p, note.id, { fields: { Front: "<b>Changed</b>" } }, { now: NOW_MS + 5000 });
    expect([note.sortField, note.mtime]).toEqual(["Changed", NOW_MS / 1000 + 5]);
    expect(newId([5, 6, 7], 5)).toBe(8);
    const r1 = addReview(p, { id: NOW_MS, cardId: cards[0]!.id, ease: 1, interval: -60, lastInterval: 0, factor: 0, taken: 1, kind: 0 });
    const r2 = addReview(p, { id: NOW_MS, cardId: cards[0]!.id, ease: 3, interval: -600, lastInterval: -60, factor: 0, taken: 1, kind: 0 });
    expect(r2.id).toBe(r1.id + 1);
    expect(p.revlog.map((r) => r.id)).toEqual([...p.revlog.map((r) => r.id)].sort((a, b) => a - b));
    const removed = deleteNotes(p, [note.id]);
    expect(removed).toEqual({ notes: 1, cards: 1, revlog: 2 });
  });

  it("card data: data is authoritative, rawData kept verbatim while it agrees", async () => {
    const p = await fresh("full-legacy.apkg");
    const c = p.cards.find((x) => x.data.memoryState)!;
    const raw = c.rawData;
    expect((await roundTrip(p)).cards.find((x) => x.id === c.id)!.rawData).toBe(raw);
    c.data.memoryState = { stability: 12.5, difficulty: 3.25 }; // edited without touching rawData
    const again = (await roundTrip(p)).cards.find((x) => x.id === c.id)!;
    expect(again.data.memoryState).toEqual({ stability: 12.5, difficulty: 3.25 });
    expect(again.data.originalPosition).toBe(c.data.originalPosition);
  });
});
