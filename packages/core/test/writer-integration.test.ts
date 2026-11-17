/**
 * Core export → .apkg bytes (`exportApkg`, @wengu/anki's writer, run on the core's SQLite) → import into a fresh
 * collection → export again.
 *
 * The writer produces the legacy-2 package format (schema 11), the only one it writes. The writer's tests
 * established against Anki's own importer that this format cannot carry a few things a latest-format (schema 18)
 * collection has. Those, and only those, are applied to the expected value below as named rules; every other
 * field must come back identical, so any new, unexpected loss fails the test. `format` (the container format)
 * and `warnings` (reader diagnostics) are not data and are not compared.
 */
import { describe, expect, it } from "vitest";

import type { AnkiPackage } from "@wengu/anki";

import { APKG_FIXTURES, engineAt, fixtureBytes } from "./helpers.js";

type Rule = "tag collapsed flag" | "per-template mtime/usn" | "media sha1" | "deck retention as whole percent" | "schema 11 keys in extra";

/** What a schema 11 package does to the data, rule by rule. Returns the expected package and the rules that changed something. */
function throughSchema11(p: AnkiPackage): { expected: AnkiPackage; fired: Set<Rule> } {
  const e = structuredClone(p);
  const fired = new Set<Rule>();
  const set = <T extends object, K extends keyof T>(o: T, k: K, v: T[K], rule: Rule) => {
    if (o[k] !== v) {
      o[k] = v;
      fired.add(rule);
    }
  };
  // The tag registry of schema 11 is name → usn; there is no collapsed state.
  for (const t of e.tags) set(t, "collapsed", false, "tag collapsed flag");
  // Schema 11 templates have no mtime/usn of their own; readers use the note type's.
  for (const nt of e.notetypes) for (const t of nt.templates) {
    set(t, "mtime", nt.mtime, "per-template mtime/usn");
    set(t, "usn", nt.usn, "per-template mtime/usn");
  }
  // The legacy media manifest is a JSON name map without checksums.
  for (const m of e.media) set(m, "sha1", null, "media sha1");
  // Schema 11 stores a deck's desired-retention override as a whole percentage.
  for (const d of e.decks) {
    if (d.desiredRetention !== null) set(d, "desiredRetention", Math.round(Math.fround(d.desiredRetention) * 100) / 100, "deck retention as whole percent");
  }
  // Keys schema 11 always writes that the model keeps in `extra` when reading them back.
  for (const nt of e.notetypes) if (!("did" in nt.extra)) {
    nt.extra["did"] = null;
    fired.add("schema 11 keys in extra");
  }
  for (const c of e.deckConfigs) if (!("dyn" in c.extra)) {
    c.extra["dyn"] = false;
    fired.add("schema 11 keys in extra");
  }
  return { expected: e, fired };
}

const norm = (p: AnkiPackage) => ({ ...p, format: null, warnings: [], media: [...p.media].sort((a, b) => (a.name < b.name ? -1 : 1)) });

/** Which rules each fixture is expected to trigger (so a rule that silently stops applying is noticed too). */
const EXPECTED_RULES: Record<string, Rule[]> = {
  "full-latest.apkg": ["per-template mtime/usn", "media sha1", "schema 11 keys in extra"],
  "shared-latest.apkg": ["per-template mtime/usn", "media sha1", "schema 11 keys in extra"],
  "full-latest.colpkg": ["tag collapsed flag", "per-template mtime/usn", "media sha1", "schema 11 keys in extra"],
  "full-legacy.apkg": [],
  "derived-legacy1.apkg": [],
};

async function roundTrip(engineSetup: (e: Awaited<ReturnType<typeof engineAt>>["engine"]) => Promise<void>) {
  const { engine } = await engineAt();
  await engineSetup(engine);
  const before = await engine.exportAnki();
  const bytes = await engine.exportApkg();
  const { engine: other } = await engineAt();
  await other.importAnki(bytes);
  return { before, after: await other.exportAnki(), warnings: engine.lastExportWarnings };
}

describe("export → .apkg bytes → import", () => {
  it.each(APKG_FIXTURES)("%s: equal except for the named schema 11 limits", async (name) => {
    const { before, after, warnings } = await roundTrip((e) => e.importAnki(fixtureBytes(name)).then(() => undefined));
    expect(warnings).toEqual([]);
    const { expected, fired } = throughSchema11(before);
    expect([...fired].sort()).toEqual([...EXPECTED_RULES[name]!].sort());
    expect(norm(after)).toEqual(norm(expected));
  });

  it("a per-deck retention override that is not a whole percentage comes back rounded", async () => {
    const { before, after } = await roundTrip(async (e) => {
      await e.importAnki(fixtureBytes("full-latest.apkg"));
      const misc = e.decks.get(e.deckIdByName("Wengu Test::Misc")!)!;
      e.saveDeck({ ...misc, desiredRetention: 0.855 });
    });
    const misc = (p: AnkiPackage) => p.decks.find((d) => d.name === "Wengu Test::Misc")!.desiredRetention;
    expect(misc(before)).toBe(0.855);
    expect(misc(after)).toBe(0.86);
    const { expected, fired } = throughSchema11(before);
    expect(fired.has("deck retention as whole percent")).toBe(true);
    expect(norm(after)).toEqual(norm(expected));
  });

  it("deck export without scheduling or media", async () => {
    const { engine } = await engineAt();
    await engine.importAnki(fixtureBytes("full-latest.apkg"));
    const misc = engine.deckIdByName("Wengu Test::Misc")!;
    const view = await engine.exportAnki({ deckId: misc, includeScheduling: false, includeMedia: false });
    const { engine: other } = await engineAt();
    await other.importAnki(await engine.exportApkg({ deckId: misc, includeScheduling: false, includeMedia: false }));
    const got = await other.exportAnki();
    expect(got.media).toEqual([]);
    expect(got.revlog).toEqual([]);
    expect(got.cards.every((c) => c.type === 0 && c.queue === 0)).toBe(true);
    expect(got.notes.map((n) => n.guid).sort()).toEqual(view.notes.map((n) => n.guid).sort());
    expect(got.decks.map((d) => d.name).sort()).toEqual(view.decks.map((d) => d.name).sort());
  });

  it("exportApkgFile gives the same bytes as a Blob", async () => {
    const { engine, clock } = await engineAt();
    await engine.importAnki(fixtureBytes("full-latest.apkg"));
    const bytes = await engine.exportApkg();
    void clock;
    const blob = await engine.exportApkgFile();
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
  });
});
