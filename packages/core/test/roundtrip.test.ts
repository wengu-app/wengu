/**
 * Round trip: .apkg → import → export → AnkiPackage equal to what @wengu/anki reads from the original file.
 *
 * Normalisations (documented, nothing else is relaxed):
 *  - `warnings` are reader diagnostics, not stored data: not compared.
 *  - `media` is compared as a set (sorted by name): a package's media list order is the zip entry order,
 *    which carries no meaning; the core keeps it anyway (media.position), so this is belt and braces.
 */
import { describe, expect, it } from "vitest";

import type { AnkiPackage } from "@wengu/anki";

import { APKG_FIXTURES, engineAt, fixtureBytes, readFixture } from "./helpers.js";

function normalise(p: AnkiPackage) {
  const { warnings: _w, media, ...rest } = p;
  return {
    ...rest,
    media: [...media].sort((a, b) => (a.name < b.name ? -1 : 1)).map((m) => ({ name: m.name, sha1: m.sha1, data: Buffer.from(m.data).toString("base64") })),
  };
}

describe.each(APKG_FIXTURES)("%s", (name) => {
  it("import (bytes, read in the core's SQLite) → export equals the original", async () => {
    const original = await readFixture(name);
    const { engine } = await engineAt();
    const r = await engine.importAnki(fixtureBytes(name));
    expect(r.knowledgePoints.added).toBe(original.notes.length);
    expect(r.reviewItems.added).toBe(original.cards.length);
    expect(r.reviewLog.added).toBe(original.revlog.length);
    const exported = await engine.exportAnki();
    expect(normalise(exported)).toEqual(normalise(original));
  });

  it("import (parsed AnkiPackage) → export equals the original, also after reopening the database", async () => {
    const original = await readFixture(name);
    const { engine, clock } = await engineAt();
    await engine.importAnki(original);
    const bytes = engine.db.exportBytes();
    const { engine: reopened } = await engineAt(clock.ms / 1000, { bytes, media: engine.media });
    expect(normalise(await reopened.exportAnki())).toEqual(normalise(original));
  });

  it("re-importing the same package changes nothing", async () => {
    const original = await readFixture(name);
    const { engine } = await engineAt();
    await engine.importAnki(original);
    const again = await engine.importAnki(original);
    expect(again.knowledgePoints).toEqual({ added: 0, updated: 0, unchanged: original.notes.length });
    expect(again.reviewItems.added).toBe(0);
    expect(again.reviewLog).toEqual({ added: 0, duplicates: original.revlog.length });
    expect(again.media.added).toBe(0);
    expect(normalise(await engine.exportAnki())).toEqual(normalise(original));
  });
});
