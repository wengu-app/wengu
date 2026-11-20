/** Storage, study flow, limits, undo, browse/edit, stats. */
import { describe, expect, it } from "vitest";

import { MIGRATIONS, SCHEMA_VERSION, currentSchemaVersion, migrate } from "../src/db/schema.js";
import type { Engine } from "../src/engine/engine.js";
import { SchedulerDays } from "../src/engine/time.js";
import { ManualClock, openNodeEngine } from "../src/node.js";
import { FIXTURE_NOW_SECS, engineAt, fixtureBytes } from "./helpers.js";

const DAY = 86_400_000;
/** 2026-01-05 10:00 UTC */
const T0 = Date.UTC(2026, 0, 5, 10, 0, 0);

async function freshCollection(notes: number, opts: { newPerDay?: number } = {}) {
  const clock = new ManualClock(T0, 0);
  const engine = await openNodeEngine({ clock });
  const nt = engine.createStockNoteType("basic");
  const deck = engine.createDeck("Test");
  if (opts.newPerDay !== undefined) {
    const p = engine.presets.get(engine.decks.get(deck)!.configId!)!;
    engine.savePreset({ ...p, newPerDay: opts.newPerDay });
  }
  const ids: number[] = [];
  for (let i = 0; i < notes; i++) {
    ids.push(engine.addKnowledgePoint({ noteTypeId: nt, deckId: deck, fields: [`front ${i}`, `back ${i}`], tags: i % 2 ? ["odd"] : ["even", "num::even"] }).id);
    clock.advance(1);
  }
  return { engine, clock, nt, deck, ids };
}

function answerAll(engine: Engine, deckId: number, rating: 1 | 2 | 3 | 4, max = 1000): number {
  let n = 0;
  let s = engine.study(deckId);
  while (s.card && n < max) {
    s = engine.answer({ itemId: s.card.item.id, rating, takenMs: 3000, deckId });
    n++;
  }
  return n;
}

describe("migrations", () => {
  it("creates the schema at the latest version and records it", async () => {
    const { engine } = await engineAt();
    expect(currentSchemaVersion(engine.db)).toBe(MIGRATIONS[MIGRATIONS.length - 1]!.version);
    expect(engine.db.all("SELECT version, name FROM schema_migrations ORDER BY version")).toEqual(MIGRATIONS.map((m) => ({ version: m.version, name: m.name })));
  });

  it("applies only pending migrations, in order, each once", async () => {
    const { engine } = await engineAt();
    const extra = [
      ...MIGRATIONS,
      { version: SCHEMA_VERSION + 1, name: "add a", up: (db: Engine["db"]) => db.exec("CREATE TABLE a (x)") },
      { version: SCHEMA_VERSION + 2, name: "add b", up: (db: Engine["db"]) => db.exec("CREATE TABLE b (x)") },
    ];
    expect(migrate(engine.db, extra)).toEqual([SCHEMA_VERSION + 1, SCHEMA_VERSION + 2]);
    expect(migrate(engine.db, extra)).toEqual([]);
    expect(currentSchemaVersion(engine.db)).toBe(SCHEMA_VERSION + 2);
  });

  it("a failing migration rolls back completely", async () => {
    const { engine } = await engineAt();
    const bad = [...MIGRATIONS, { version: SCHEMA_VERSION + 1, name: "bad", up: (db: Engine["db"]) => db.exec("CREATE TABLE c (x); SELECT * FROM nope") }];
    expect(() => migrate(engine.db, bad)).toThrow();
    expect(currentSchemaVersion(engine.db)).toBe(SCHEMA_VERSION);
    expect(engine.db.value("SELECT count(*) FROM sqlite_master WHERE name = 'c'")).toBe(0);
  });

  it("upgrades a version-1 database (index changes of migration 2) and keeps its data", async () => {
    const { engine } = await engineAt();
    await engine.importAnki(fixtureBytes("full-latest.apkg"));
    engine.db.exec(`DROP INDEX review_items_queue_due; CREATE INDEX review_items_queue_due ON review_items (queue, due);
      DROP INDEX review_items_deck_queue_due; CREATE INDEX review_items_deck_queue_due ON review_items (deck_id, queue, due);
      DELETE FROM schema_migrations WHERE version > 1;`);
    const before = await engine.exportAnki();
    const upgraded = await openNodeEngine({ bytes: engine.db.exportBytes(), media: engine.media });
    expect(currentSchemaVersion(upgraded.db)).toBe(SCHEMA_VERSION);
    expect(String(upgraded.db.value("SELECT sql FROM sqlite_master WHERE name = 'review_items_queue_due'"))).toContain("kp_id");
    expect(await upgraded.exportAnki()).toEqual(before);
  });

  it("refuses a database written by a newer version", async () => {
    const { engine } = await engineAt();
    engine.db.run("INSERT INTO schema_migrations VALUES (99, 'future', 0)");
    const bytes = engine.db.exportBytes();
    await expect(openNodeEngine({ bytes })).rejects.toThrow(/newer/);
  });
});

describe("scheduler days", () => {
  it("counts days from the creation day with the rollover hour in local time", () => {
    // UTC+8, rollover 4:00 local. Created 2026-01-01 04:00 local = 2025-12-31 20:00 UTC.
    const clock = new ManualClock(0, 480);
    const days = new SchedulerDays(Date.UTC(2025, 11, 31, 20) / 1000, 4, clock);
    expect(days.dayOf(Date.UTC(2025, 11, 31, 20))).toBe(0);
    expect(days.dayOf(Date.UTC(2026, 0, 1, 19, 59))).toBe(0); // 03:59 local on Jan 2
    expect(days.dayOf(Date.UTC(2026, 0, 1, 20))).toBe(1); // 04:00 local on Jan 2
    expect(days.dayStart(1)).toBe(Date.UTC(2026, 0, 1, 20));
    clock.ms = Date.UTC(2026, 0, 3, 1);
    expect(days.timing()).toMatchObject({ today: 2, dayStartMs: Date.UTC(2026, 0, 2, 20), nextDayAtMs: Date.UTC(2026, 0, 3, 20) });
  });
});

describe("study flow", () => {
  it("answers, writes Anki-compatible review log rows, and undoes exactly", async () => {
    const { engine, clock } = await engineAt(FIXTURE_NOW_SECS + 3600);
    await engine.importAnki(fixtureBytes("full-latest.apkg"));
    const before = engine.study(null);
    expect(before.card).not.toBeNull();
    const card = before.card!;
    const itemBefore = engine.getItemRow(card.item.id)!;
    const revlogBefore = Number(engine.db.value("SELECT count(*) FROM revlog"));
    const decksBefore = engine.db.all("SELECT * FROM decks ORDER BY id");
    const expected = card.schedule.outcomes.good;

    clock.advance(5000);
    const after = engine.answer({ itemId: card.item.id, rating: 3, takenMs: 4200 });
    expect(after.undoLabel).toBe("Answer good");
    const row = engine.getItemRow(card.item.id)!;
    expect(row.reps).toBe(itemBefore.reps + 1);
    const log = engine.db.get<{ id: number; card_id: number; ease: number; ivl: number; last_ivl: number; taken: number; kind: number; usn: number }>(
      "SELECT * FROM revlog ORDER BY id DESC LIMIT 1",
    )!;
    expect(log).toMatchObject({ card_id: card.item.id, ease: 3, taken: 4200, usn: -1 });
    expect(log.id).toBe(clock.ms);
    expect(log.ivl).toBe(expected.interval.unit === "days" ? expected.interval.value : -expected.interval.value);
    const data = JSON.parse(row.data) as Record<string, number>;
    expect(data["lrt"]).toBe(Math.floor(clock.ms / 1000));
    expect(data["s"]).toBeCloseTo(expected.memory.stability, 3);

    const undone = engine.undo();
    expect(undone).toMatchObject({ label: "Answer good", code: "answer-good", itemIds: [card.item.id] });
    expect(undone!.state.card!.item.id).toBe(card.item.id); // the undone card is shown next
    expect(engine.getItemRow(card.item.id)).toEqual(itemBefore);
    expect(Number(engine.db.value("SELECT count(*) FROM revlog"))).toBe(revlogBefore);
    expect(engine.db.all("SELECT * FROM decks ORDER BY id")).toEqual(decksBefore);
    expect(engine.undoLabel()).toBeNull();
    expect(engine.undo()).toBeNull();
  });

  it("after undoing an answer, that item is next until it is answered again (deck study)", async () => {
    const { engine, clock, deck } = await freshCollection(10);
    let s = engine.study(deck);
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push(s.card!.item.id);
      s = engine.answer({ itemId: s.card!.item.id, rating: 4, takenMs: 1, deckId: deck });
      clock.advance(1000);
    }
    expect(s.undoCode).toBe("answer-easy");
    expect(s.undoLabel).toBe("Answer easy");
    const u1 = engine.undo({ deckId: deck })!;
    expect(u1.code).toBe("answer-easy");
    expect(u1.state.card!.item.id).toBe(ids[2]);
    expect(engine.study(deck).card!.item.id).toBe(ids[2]); // stable across calls
    const u2 = engine.undo({ deckId: deck })!;
    expect(u2.state.card!.item.id).toBe(ids[1]);
    const after = engine.answer({ itemId: ids[1]!, rating: 4, takenMs: 1, deckId: deck });
    expect(after.card!.item.id).not.toBe(ids[1]);
    expect(engine.undoInfo()).toEqual({ label: "Answer easy", code: "answer-easy" });
    engine.setSuspended([after.card!.item.id], true);
    expect(engine.undoInfo()).toEqual({ label: "Suspend", code: "suspend" });
    expect(engine.undo()!.code).toBe("suspend");
  });

  it("upNext predicts the card answer() returns, except in the documented cases", async () => {
    const { engine } = await engineAt(FIXTURE_NOW_SECS + 3600);
    await engine.importAnki(fixtureBytes("full-latest.apkg"));
    const { engine: big, clock } = await freshCollection(60, { newPerDay: 25 });
    void engine;
    let s = big.study(null);
    let hits = 0;
    let misses = 0;
    const missDetail: string[] = [];
    for (let i = 0; i < 80 && s.card; i++) {
      const predicted = s.upNext?.item.id ?? null;
      const rating = ([3, 4, 3, 1] as const)[i % 4]!;
      const current = s.card.item.id;
      clock.advance(5000);
      s = big.answer({ itemId: current, rating, takenMs: 1 });
      const actual = s.card?.item.id ?? null;
      if (predicted === actual) hits++;
      else {
        misses++;
        // documented: the answered item came back first (learning step within the learn-ahead window), or a
        // learning step of another item fell due in the meantime
        const ok = actual === current || (s.card !== null && s.card.item.state !== "new" && s.card.item.due.kind === "time");
        if (!ok) missDetail.push(`#${i} predicted ${predicted}, got ${actual}`);
      }
    }
    expect(missDetail).toEqual([]);
    expect(hits).toBeGreaterThan(misses);
  });

  it("persists answers and the undo stack across reopening", async () => {
    const { engine, clock, deck } = await freshCollection(5);
    const s = engine.study(deck);
    engine.answer({ itemId: s.card!.item.id, rating: 3, takenMs: 1000, deckId: deck });
    const reopened = await openNodeEngine({ clock, bytes: engine.db.exportBytes(), media: engine.media });
    expect(reopened.getItemRow(s.card!.item.id)).toEqual(engine.getItemRow(s.card!.item.id));
    expect(reopened.undoLabel()).toBe("Answer good");
    reopened.undo();
    expect(reopened.getItemRow(s.card!.item.id)!.type).toBe(0);
    expect(reopened.db.value("SELECT count(*) FROM revlog")).toBe(0);
  });

  it("learning steps: Again → 1 min, Good → 10 min, Good → graduates; learning comes back before new items", async () => {
    const { engine, clock, deck } = await freshCollection(3);
    let s = engine.study(deck);
    const first = s.card!.item.id;
    expect(s.card!.schedule.outcomes.again.interval).toEqual({ unit: "seconds", value: 60 });
    expect(s.card!.schedule.outcomes.hard.interval).toEqual({ unit: "seconds", value: 330 });
    expect(s.card!.schedule.outcomes.good.interval).toEqual({ unit: "seconds", value: 600 });
    expect(s.card!.schedule.outcomes.easy.state).toBe("review");
    s = engine.answer({ itemId: first, rating: 1, takenMs: 1000, deckId: deck });
    expect(engine.getItemRow(first)).toMatchObject({ type: 1, queue: 1, left: 2 });
    expect(s.card!.item.id).not.toBe(first); // a new item comes first while the step is not due
    clock.advance(2 * 60_000);
    s = engine.study(deck);
    expect(s.card!.item.id).toBe(first); // due learning step first
    expect(s.counts.learning).toBe(1);
    s = engine.answer({ itemId: first, rating: 3, takenMs: 1000, deckId: deck });
    expect(engine.getItemRow(first)).toMatchObject({ type: 1, queue: 1, left: 1 });
    clock.advance(11 * 60_000);
    s = engine.study(deck);
    expect(s.card!.item.id).toBe(first);
    const goodDays = s.card!.schedule.outcomes.good;
    expect(goodDays.state).toBe("review");
    engine.answer({ itemId: first, rating: 3, takenMs: 1000, deckId: deck });
    expect(engine.getItemRow(first)).toMatchObject({ type: 2, queue: 2, ivl: goodDays.interval.value, factor: 2500 });
    const kinds = engine.db.values("SELECT kind, ease, ivl, last_ivl FROM revlog WHERE card_id = ? ORDER BY id", [first]);
    expect(kinds.map((r) => [r[0], r[1]])).toEqual([[0, 1], [0, 3], [0, 3]]);
    expect(kinds[1]![3]).toBe(-60); // last interval: the previous step
  });

  it("daily new limit, day rollover and per-deck counters", async () => {
    const { engine, clock, deck } = await freshCollection(30, { newPerDay: 20 });
    expect(engine.study(deck).counts).toEqual({ new: 20, learning: 0, review: 0 });
    expect(answerAll(engine, deck, 4)).toBe(20);
    const s = engine.study(deck);
    expect(s.card).toBeNull();
    expect(s.counts).toEqual({ new: 0, learning: 0, review: 0 });
    expect(engine.decks.get(deck)!.stats).toMatchObject({ newStudied: 20, reviewStudied: 0 });
    expect(engine.deckTree()[0]!.counts.new).toBe(0);
    clock.advance(DAY);
    expect(engine.study(deck).counts.new).toBe(10);
    expect(engine.deckTree()[0]!.counts.new).toBe(10);
  });

  it("subdeck limits cap the subdeck; the parent limit caps the total", async () => {
    const clock = new ManualClock(T0, 0);
    const engine = await openNodeEngine({ clock });
    const nt = engine.createStockNoteType("basic");
    const parent = engine.createDeck("P");
    const a = engine.createDeck("P::A");
    const b = engine.createDeck("P::B");
    const small = { ...engine.presets.get(1)!, id: 2, name: "small", newPerDay: 3 };
    engine.savePreset(small);
    engine.saveDeck({ ...engine.decks.get(a)!, configId: 2 });
    for (let i = 0; i < 10; i++) engine.addKnowledgePoint({ noteTypeId: nt, deckId: a, fields: [`a${i}`, "x"] });
    for (let i = 0; i < 30; i++) engine.addKnowledgePoint({ noteTypeId: nt, deckId: b, fields: [`b${i}`, "x"] });
    const tree = engine.deckTree();
    const p = tree.find((d) => d.id === parent)!;
    expect(p.children.map((c) => c.counts.new)).toEqual([3, 20]);
    expect(p.counts.new).toBe(20);
    expect(p.totalItems).toBe(40);
    // studying the parent never takes more than 3 from A
    answerAll(engine, parent, 4);
    expect(engine.decks.get(a)!.stats.newStudied).toBe(3);
    expect(engine.decks.get(parent)!.stats.newStudied).toBe(20);
  });

  it("suspend, bury (until the next day) and unsuspend", async () => {
    const { engine, clock, deck } = await freshCollection(3);
    const items = engine.db.values("SELECT id FROM review_items ORDER BY id").map((r) => Number(r[0]));
    engine.setSuspended([items[0]!], true);
    engine.bury([items[1]!]);
    expect(engine.study(deck).counts.new).toBe(1);
    expect(engine.search({ state: "suspended" }).total).toBe(1);
    expect(engine.search({ state: "buried" }).total).toBe(1);
    clock.advance(DAY);
    expect(engine.study(deck).counts.new).toBe(2);
    engine.setSuspended([items[0]!], false);
    expect(engine.getItemRow(items[0]!)!.queue).toBe(0);
    engine.undo();
    expect(engine.getItemRow(items[0]!)!.queue).toBe(-1);
  });

  it("burying siblings when the preset asks for it", async () => {
    const clock = new ManualClock(T0, 0);
    const engine = await openNodeEngine({ clock });
    const nt = engine.createStockNoteType("basic-reversed");
    const deck = engine.createDeck("D");
    engine.savePreset({ ...engine.presets.get(1)!, buryNew: true });
    const { itemIds } = engine.addKnowledgePoint({ noteTypeId: nt, deckId: deck, fields: ["f", "b"] });
    expect(itemIds).toHaveLength(2);
    const s = engine.study(deck);
    engine.answer({ itemId: s.card!.item.id, rating: 3, takenMs: 1000, deckId: deck });
    const sibling = itemIds.find((i) => i !== s.card!.item.id)!;
    expect(engine.getItemRow(sibling)!.queue).toBe(-2);
    engine.undo();
    expect(engine.getItemRow(sibling)!.queue).toBe(0);
  });

  it("leech: the 8th lapse tags the knowledge point", async () => {
    const { engine, clock, deck } = await freshCollection(1);
    const id = engine.study(deck).card!.item.id;
    engine.answer({ itemId: id, rating: 4, takenMs: 1, deckId: deck });
    for (let lapse = 1; lapse <= 8; lapse++) {
      clock.advance(400 * DAY);
      engine.answer({ itemId: id, rating: 1, takenMs: 1, deckId: deck }); // lapse → relearning
      engine.answer({ itemId: id, rating: 4, takenMs: 1, deckId: deck }); // graduate again
    }
    const row = engine.getItemRow(id)!;
    expect(row.lapses).toBe(8);
    expect(engine.getKnowledgePoint(row.kp_id)!.tags).toContain("leech");
  });

  it("explain() describes the memory state and every rating's outcome", async () => {
    const { engine } = await engineAt(FIXTURE_NOW_SECS);
    await engine.importAnki(fixtureBytes("full-latest.apkg"));
    const ex = engine.explain(1740819614000);
    expect(ex.memory).toEqual({ stability: 494.9626, difficulty: 2.083 });
    expect(ex.retrievability).toBeGreaterThan(0.9);
    expect(ex.retrievability).toBeLessThan(1);
    expect(ex.desiredRetention).toBe(0.9);
    expect(ex.outcomes.good.label).toMatch(/^\d+(\.\d)?(d|mo|y)$/);
    expect(ex.outcomes.again.state).toBe("relearning");
    expect(ex.outcomes.again.label).toBe("10m");
  });
});

describe("deck management", () => {
  it("deletes a deck with its sub-decks and items, keeps history, and undoes completely", async () => {
    const { engine } = await engineAt(FIXTURE_NOW_SECS);
    await engine.importAnki(fixtureBytes("full-latest.apkg"));
    engine.study(null); // the first queue build of the day unburies (undo() returns a study state, which would)
    const before = await engine.exportAnki();
    const langs = engine.deckIdByName("Wengu Test::Languages")!;
    const inTree = engine.subtree(langs);
    const items = before.cards.filter((c) => inTree.includes(c.deckId));
    const r = engine.deleteDeck(langs);
    expect(r).toEqual({ decks: 3, reviewItems: items.length, knowledgePoints: new Set(items.map((c) => c.noteId)).size });
    expect(engine.deckIdByName("Wengu Test::Languages::中文")).toBeUndefined();
    expect(engine.info().counts.reviewLog).toBe(before.revlog.length);
    expect(engine.undoInfo()?.code).toBe("delete-deck");
    expect(engine.undo()!.code).toBe("delete-deck");
    expect(await engine.exportAnki()).toEqual(before);
    expect(() => engine.deleteDeck(1)).toThrow(/Default deck/);
  });

  it("reads, updates, creates and assigns presets; limits apply at once", async () => {
    const { engine, deck } = await freshCollection(30);
    const deckPreset = engine.deckTree()[0]!.presetId!;
    const p = engine.getPreset(deckPreset)!;
    expect(p).toMatchObject({ newPerDay: 20, reviewsPerDay: 200, learnStepsMinutes: [1, 10], desiredRetention: 0.9, deckCount: 1 });
    expect(engine.study(deck).counts.new).toBe(20);
    const u = engine.updatePreset(deckPreset, { newPerDay: 5, learnStepsMinutes: [2, 20, 60], desiredRetention: 0.85, maximumIntervalDays: 3650 });
    expect(u).toMatchObject({ newPerDay: 5, learnStepsMinutes: [2, 20, 60], desiredRetention: 0.85, maximumIntervalDays: 3650 });
    const s = engine.study(deck);
    expect(s.counts.new).toBe(5);
    expect(s.card!.schedule.outcomes.again.interval).toEqual({ unit: "seconds", value: 120 });
    expect(s.card!.schedule.desiredRetention).toBe(0.85);
    expect(() => engine.updatePreset(deckPreset, { desiredRetention: 1.2 })).toThrow(/retention/);
    expect(() => engine.updatePreset(deckPreset, { newPerDay: -1 })).toThrow(/new items/);
    expect(() => engine.updatePreset(deckPreset, { learnStepsMinutes: [0] })).toThrow(/steps/);
    const other = engine.createPreset("Intensive", deckPreset);
    engine.updatePreset(other, { newPerDay: 50 });
    engine.setDeckPreset(deck, other);
    expect(engine.study(deck).counts.new).toBe(30);
    expect(engine.listPresets().map((x) => [x.name, x.deckCount])).toContainEqual(["Intensive", 1]);
    // survives export/import
    const pkg = await engine.exportAnki();
    expect(pkg.deckConfigs.find((c) => c.id === other)).toMatchObject({ name: "Intensive", newPerDay: 50, learnSteps: [2, 20, 60] });
  });
});

describe("browse and edit", () => {
  it("searches text (any length, CJK), tags with children, decks, states; pages and sorts", async () => {
    const { engine, deck } = await freshCollection(120);
    const nt = engine.listNoteTypes()[0]!.id;
    engine.addKnowledgePoint({ noteTypeId: nt, deckId: deck, fields: ["<b>温故</b>而知新", "可以为师矣"], tags: ["论语"] });
    expect(engine.search({ text: "温故" }).total).toBe(1);
    expect(engine.search({ text: "故而知" }).total).toBe(1);
    expect(engine.search({ text: "为师" }).total).toBe(1);
    expect(engine.search({ text: "<b>" }).total).toBe(0); // HTML is not searched
    // words are ANDed; "1" matches fields of note i when "1" occurs in i (front i / back i)
    expect(engine.search({ text: "front 1" }).total).toBe([...Array(120).keys()].filter((i) => String(i).includes("1")).length);
    expect(engine.search({ text: "FRONT 11" }).total).toBe(11); // 11, 110..119
    expect(engine.search({ tags: ["num"] }).total).toBe(60);
    expect(engine.search({ tags: ["even"] }).total).toBe(60);
    expect(engine.search({ tags: ["odd", "even"] }).total).toBe(0);
    expect(engine.search({ deckId: deck, state: "new" }).total).toBe(121);
    const page = engine.search({ sort: { by: "sortField", direction: "asc" }, limit: 10, offset: 5 });
    expect(page.rows).toHaveLength(10);
    expect(page.total).toBe(121);
    const names = page.rows.map((r) => r.sortField);
    expect([...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))).toEqual(names);
    expect(page.rows[0]).toMatchObject({ noteTypeName: "Basic", itemCount: 1, states: ["new"], deckIds: [deck] });
  });

  it("edits fields and tags, adds items for new clozes, and undoes", async () => {
    const clock = new ManualClock(T0, 0);
    const engine = await openNodeEngine({ clock });
    const cloze = engine.createStockNoteType("cloze");
    const deck = engine.createDeck("C");
    const { id, itemIds } = engine.addKnowledgePoint({ noteTypeId: cloze, deckId: deck, fields: ["{{c1::a}} {{c2::b}}", ""], tags: ["x"] });
    expect(itemIds).toHaveLength(2);
    clock.advance(1000);
    const r = engine.updateKnowledgePoint({ id, fields: ["{{c1::a}} {{c2::b}} {{c3::c}}", "extra"], tags: ["x", "y::z"] });
    expect(r.addedItemIds).toHaveLength(1);
    expect(engine.getItemRow(r.addedItemIds[0]!)!.ord).toBe(2);
    const kp = engine.getKnowledgePoint(id)!;
    expect(kp.fields[1]).toBe("extra");
    expect(kp.tags).toEqual(["x", "y::z"]);
    expect(kp.items).toHaveLength(3);
    expect(engine.search({ text: "extra" }).total).toBe(1);
    expect(engine.search({ tags: ["y"] }).total).toBe(1);
    expect(engine.renderItem(r.addedItemIds[0]!).question).toContain('data-ordinal="3"');
    engine.undo();
    expect(engine.getKnowledgePoint(id)!.items).toHaveLength(2);
    expect(engine.search({ text: "extra" }).total).toBe(0);
    expect(engine.search({ tags: ["y"] }).total).toBe(0);
  });

  it("deletes knowledge points (keeping review history) and undoes the deletion", async () => {
    const { engine, deck, ids } = await freshCollection(3);
    const s = engine.study(deck);
    engine.answer({ itemId: s.card!.item.id, rating: 3, takenMs: 1, deckId: deck });
    const kpId = s.card!.knowledgePoint.id;
    const snapshot = engine.getKnowledgePoint(kpId);
    expect(engine.deleteKnowledgePoints([kpId, 999])).toBe(1);
    expect(engine.getKnowledgePoint(kpId)).toBeNull();
    expect(engine.db.value("SELECT count(*) FROM revlog")).toBe(1);
    expect(engine.search({}).total).toBe(ids.length - 1);
    engine.undo();
    expect(engine.getKnowledgePoint(kpId)).toEqual(snapshot);
    expect(engine.search({ text: "front" }).total).toBe(3);
  });

  it("add refuses notes that would produce no review item", async () => {
    const { engine, deck, nt } = await freshCollection(0);
    expect(() => engine.addKnowledgePoint({ noteTypeId: nt, deckId: deck, fields: ["", "back only"] })).toThrow(/no review items/);
  });

  it("adds a batch in one undo step, and adds nothing when one input is invalid", async () => {
    const { engine, deck, nt } = await freshCollection(0);
    const { added, undoStepId } = engine.addKnowledgePoints([
      { noteTypeId: nt, deckId: deck, fields: ["a", "1"], tags: ["batch"] },
      { noteTypeId: nt, deckId: deck, fields: ["b", "2"], tags: ["batch"] },
    ]);
    expect(added).toHaveLength(2);
    expect(added.every((r) => r.itemIds.length === 1)).toBe(true);
    expect(engine.search({ tags: ["batch"] }).total).toBe(2);
    expect(engine.undoInfo()).toEqual({ label: "Add", code: "add" });
    engine.addKnowledgePoint({ noteTypeId: nt, deckId: deck, fields: ["later", "3"] });
    expect(engine.undo({ expectedStepId: undoStepId! })).toBeNull();
    expect(engine.search({}).total).toBe(3);
    engine.undo();
    engine.undo({ expectedStepId: undoStepId! });
    expect(engine.search({}).total).toBe(0);
    expect(engine.undoLabel()).toBeNull();

    expect(() =>
      engine.addKnowledgePoints([
        { noteTypeId: nt, deckId: deck, fields: ["c", "3"] },
        { noteTypeId: nt, deckId: deck, fields: ["", "no front"] },
      ]),
    ).toThrow(/knowledge point 2: .*no review items/);
    expect(engine.search({}).total).toBe(0);
    expect(engine.addKnowledgePoints([])).toEqual({ added: [], undoStepId: null });
  });
});

describe("statistics, media, export of one deck", () => {
  it("counts today's reviews, retention and upcoming due items", async () => {
    const { engine, clock, deck } = await freshCollection(10);
    answerAll(engine, deck, 4);
    let st = engine.stats();
    expect(st.today).toMatchObject({ reviews: 10, newItems: 10, byRating: [0, 0, 0, 10], timeMs: 30_000 });
    expect(st.totals).toMatchObject({ new: 0, review: 10, knowledgePoints: 10 });
    expect(st.upcoming.reduce((a, b) => a + b, 0)).toBe(10);
    clock.advance(60 * DAY);
    const s = engine.study(deck);
    engine.answer({ itemId: s.card!.item.id, rating: 3, takenMs: 1, deckId: deck });
    engine.answer({ itemId: engine.study(deck).card!.item.id, rating: 1, takenMs: 1, deckId: deck });
    st = engine.stats({ deckId: deck });
    expect(st.retention.last7Days).toEqual({ passed: 1, failed: 1, rate: 0.5 });
    expect(st.overdue).toBeGreaterThan(0);
  });

  it("serves media referenced by a card and exports one deck with only its media", async () => {
    const { engine } = await engineAt(FIXTURE_NOW_SECS);
    await engine.importAnki(fixtureBytes("full-latest.apkg"));
    const pres = engine.renderItem(1740819615000);
    expect(pres.media).toContain("猫 cat.png");
    const files = await engine.getMedia(["猫 cat.png", "%E7%8C%AB%20cat.png", "missing.png"]);
    expect(files["猫 cat.png"]!.type).toBe("image/png");
    expect(files["猫 cat.png"]!.size).toBeGreaterThan(0);
    expect(files["%E7%8C%AB%20cat.png"]!.size).toBe(files["猫 cat.png"]!.size);
    expect(files["missing.png"]).toBeNull();

    const misc = engine.deckIdByName("Wengu Test::Misc")!;
    const pkg = await engine.exportAnki({ deckId: misc });
    // Anki's deck export (as @wengu/anki's packageForExport reproduces it) includes the parent decks and Default.
    expect(pkg.decks.map((d) => d.name)).toEqual(["Default", "Wengu Test", "Wengu Test::Misc"]);
    expect(pkg.cards.every((c) => c.deckId === misc)).toBe(true);
    expect(pkg.media.map((m) => m.name)).toEqual(["猫 cat.png"]);
    expect(pkg.revlog.every((r) => pkg.cards.some((c) => c.id === r.cardId))).toBe(true);
    expect(pkg.revlog.length).toBeGreaterThan(0);

    // importing that deck into a new collection keeps ids and history
    const { engine: other } = await engineAt(FIXTURE_NOW_SECS);
    await other.importAnki(pkg);
    expect(normaliseForCompare(await other.exportAnki({ deckId: misc }))).toEqual(normaliseForCompare(pkg));
  });

  it("stores new media with putMedia, reuses identical content, and disambiguates collisions", async () => {
    const { engine } = await engineAt(FIXTURE_NOW_SECS);
    const a = new Uint8Array([1, 2, 3, 4]);
    const b = new Uint8Array([5, 6, 7, 8]);
    const n1 = await engine.putMedia("diagram.png", a);
    expect(n1).toBe("diagram.png");
    // same name + same content: idempotent
    expect(await engine.putMedia("diagram.png", a)).toBe("diagram.png");
    // same name + different content: disambiguated by content hash
    const n2 = await engine.putMedia("diagram.png", b);
    expect(n2).toMatch(/^diagram-[0-9a-f]{8}\.png$/);
    expect(await engine.putMedia("diagram.png", b)).toBe(n2);
    const got = await engine.getMedia([n1, n2]);
    expect(got[n1]!.size).toBe(4);
    expect(got[n2]!.size).toBe(4);
    expect(engine.listMedia().map((m) => m.name)).toEqual([n1, n2]);
  });
});

function normaliseForCompare(p: Awaited<ReturnType<Engine["exportAnki"]>>) {
  return { ...p, warnings: [], media: p.media.map((m) => m.name).sort() };
}
