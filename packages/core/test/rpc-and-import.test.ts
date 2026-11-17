import { MessageChannel } from "node:worker_threads";

import { describe, expect, it, vi } from "vitest";

import type { AnkiPackage } from "@wengu/anki";

import { connectWengu } from "../src/index.js";
import type { ImportProgress } from "../src/index.js";
import type { Port } from "../src/rpc/protocol.js";
import { serve } from "../src/rpc/server.js";
import { SCHEMA_VERSION } from "../src/db/schema.js";
import { FIXTURE_NOW_SECS, engineAt, fixtureBytes, readFixture } from "./helpers.js";

describe("client ↔ worker protocol (over a MessageChannel)", () => {
  it("cancels queued searches and removes abort listeners after success or failure", async () => {
    const { port1, port2 } = new MessageChannel();
    const { engine } = await engineAt(FIXTURE_NOW_SECS);
    const search = vi.spyOn(engine, "search");
    serve(port2 as unknown as Port, { open: async () => engine });
    const client = await connectWengu(port1 as unknown as Port);
    try {
      const done = new AbortController();
      const removeDone = vi.spyOn(done.signal, "removeEventListener");
      await client.search({}, { signal: done.signal });
      expect(removeDone).toHaveBeenCalledWith("abort", expect.any(Function));
      done.abort(); // A completed query must not send a late cancellation to the worker.

      const cancelled = new AbortController();
      const removeCancelled = vi.spyOn(cancelled.signal, "removeEventListener");
      const result = client.search({ text: "cancelled" }, { signal: cancelled.signal });
      const rejection = expect(result).rejects.toMatchObject({ name: "AbortError" });
      cancelled.abort();
      await rejection;
      expect(removeCancelled).toHaveBeenCalledWith("abort", expect.any(Function));
      expect(search).toHaveBeenCalledTimes(1); // The cancelled query never reached SQLite.
      await expect(client.search({}, { signal: cancelled.signal })).rejects.toMatchObject({ name: "AbortError" });
      expect((await client.search({})).total).toBe(0); // Subsequent requests still work.
    } finally {
      await client.close();
      port1.close();
      port2.close();
      engine.db.close();
      search.mockRestore();
    }
  });

  it("opens, calls, reports import progress, transfers results and propagates errors", async () => {
    const { port1, port2 } = new MessageChannel();
    const { engine } = await engineAt(FIXTURE_NOW_SECS);
    serve(port2 as unknown as Port, { open: async () => engine });
    const client = await connectWengu(port1 as unknown as Port);
    expect(client.opened.schemaVersion).toBe(SCHEMA_VERSION);

    const progress: ImportProgress[] = [];
    const r = await client.importAnki(fixtureBytes("full-latest.apkg"), { onProgress: (p) => progress.push(p) });
    expect(r.knowledgePoints.added).toBe(14);
    expect(progress.some((p) => p.phase === "knowledge-points")).toBe(true);
    expect(progress[progress.length - 1]).toEqual({ phase: "finishing", done: 1, total: 1 });

    const tree = await client.deckTree();
    expect(tree.map((d) => d.name)).toEqual(["Default", "Wengu Test"]);
    const s = await client.study(null);
    expect(s.card?.presentation.kind).toBe("anki-template");
    const next = await client.answer({ itemId: s.card!.item.id, rating: 3, takenMs: 1500 });
    expect(next.undoLabel).toBe("Answer good");
    expect(await client.undo()).toMatchObject({ label: "Answer good" });

    const media = await client.getMedia(["猫 cat.png"]);
    expect(media["猫 cat.png"]!.size).toBeGreaterThan(0);
    const pkg = await client.exportAnki();
    expect(pkg.notes).toHaveLength(14);
    expect(pkg.media.length).toBe(3);

    await expect(client.answer({ itemId: 42, rating: 3, takenMs: 1 })).rejects.toThrow(/no review item 42/);
    await client.close();
    port1.close();
  });
});

describe("export without scheduling", () => {
  it("matches what Anki itself exported as a shared deck (shared-latest.apkg)", async () => {
    const anki = await readFixture("shared-latest.apkg");
    const { engine } = await engineAt(FIXTURE_NOW_SECS);
    await engine.importAnki(fixtureBytes("full-latest.apkg"));
    const ours = await engine.exportAnki({ includeScheduling: false });
    // Differences that are expected, nothing else: Anki stamps the export time into mod/scm and the current
    // note type (curModel) of the exported collection.
    const norm = (p: AnkiPackage) => ({
      ...p,
      warnings: [],
      collection: { ...p.collection, mod: 0, scm: 0, config: { ...p.collection.config, curModel: 0 } },
      media: [...p.media].sort((a, b) => (a.name < b.name ? -1 : 1)).map((m) => [m.name, m.data.length, m.sha1]),
    });
    expect(norm(ours)).toEqual(norm(anki));
  });
});

describe("importing into a non-empty collection", () => {
  it("updates newer notes, keeps local progress, skips duplicate history and renames clashing media", async () => {
    const original = await readFixture("full-latest.apkg");
    const { engine, clock } = await engineAt(FIXTURE_NOW_SECS + 3600);
    await engine.importAnki(original);
    // local progress
    const s = engine.study(null);
    clock.advance(1000);
    engine.answer({ itemId: s.card!.item.id, rating: 3, takenMs: 1000 });
    const progressed = engine.getItemRow(s.card!.item.id)!;

    // the same deck, edited elsewhere: one note newer, one media file changed, one new note
    const changed: AnkiPackage = structuredClone(original);
    const n0 = changed.notes[0]!;
    n0.fields = ["edited <b>elsewhere</b>", ...n0.fields.slice(1)];
    n0.mtime += 100;
    const n1 = changed.notes.find((n) => n.fields[0]!.includes("猫 cat.png"))!;
    const cat = changed.media.find((m) => m.name === "猫 cat.png")!;
    cat.data = new Uint8Array([1, 2, 3]);
    cat.sha1 = null;
    n1.mtime += 100;
    const extra = { ...structuredClone(original.notes[2]!), id: 1800000000000, guid: "brand-new" };
    changed.notes.push(extra);
    const extraCard = { ...structuredClone(original.cards.find((c) => c.noteId === original.notes[2]!.id)!), id: 1800000000001, noteId: extra.id };
    changed.cards.push(extraCard);

    const r = await engine.importAnki(changed);
    expect(r.knowledgePoints).toEqual({ added: 1, updated: 2, unchanged: original.notes.length - 2 });
    expect(r.reviewItems).toEqual({ added: 1, kept: original.cards.length });
    expect(r.reviewLog).toEqual({ added: 0, duplicates: original.revlog.length });
    expect(r.media).toEqual({ added: 1, unchanged: 2, renamed: 1 });
    expect(engine.getItemRow(s.card!.item.id)).toEqual(progressed);
    expect(engine.getKnowledgePoint(n0.id)!.fields[0]).toBe("edited <b>elsewhere</b>");
    const renamedField = engine.getKnowledgePoint(n1.id)!.fields[0]!;
    expect(renamedField).toMatch(/猫 cat-[0-9a-f]{8}\.png/);
    const newName = /src="([^"]+)"/.exec(renamedField)![1]!;
    expect((await engine.getMedia([newName]))[newName]!.size).toBe(3);
    expect((await engine.getMedia(["猫 cat.png"]))["猫 cat.png"]!.size).toBe(original.media.find((m) => m.name === "猫 cat.png")!.data.length);
    expect(engine.search({ text: "elsewhere" }).total).toBe(1);
  });

  it("shifts day-based due dates when the package's collection was created on another day", async () => {
    const original = await readFixture("full-latest.apkg");
    const { engine } = await engineAt(FIXTURE_NOW_SECS);
    // a collection created 10 days after the package's
    engine.setMeta("crt", original.collection.crt + 10 * 86400);
    engine.reload();
    engine.createStockNoteType("basic");
    const deck = engine.createDeck("Mine");
    engine.addKnowledgePoint({ noteTypeId: engine.listNoteTypes()[0]!.id, deckId: deck, fields: ["x", "y"] });
    await engine.importAnki(original);
    const card = original.cards.find((c) => c.queue === 2)!;
    expect(engine.getItemRow(card.id)!.due).toBe(card.due - 10);
  });
});
