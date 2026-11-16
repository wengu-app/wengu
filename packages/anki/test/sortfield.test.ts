/**
 * notes.sfld / notes.csum: our derivation against Anki's own values, on the
 * probe strings in fixtures/expected/sort-fields.json (fixtures/sortfield.py)
 * and on every note in the fixture packages.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { noteSortFieldAndChecksum } from "../src/index.js";
import { FIXTURES, loadPackage } from "./helpers.js";

interface Case {
  fields: string[];
  sortf: number;
  sfld: string | number;
  csum: number;
}

const probe = JSON.parse(readFileSync(join(FIXTURES, "expected", "sort-fields.json"), "utf8")) as { cases: Case[] };

describe("sort field and checksum", () => {
  it(`match Anki on ${probe.cases.length} probe notes`, () => {
    const bad: string[] = [];
    for (const c of probe.cases) {
      const got = noteSortFieldAndChecksum({ fields: c.fields }, { sortFieldIndex: c.sortf });
      if (got.sortField !== c.sfld || got.checksum !== c.csum) {
        bad.push(`${JSON.stringify(c.fields)}: got ${JSON.stringify(got)}, Anki ${JSON.stringify({ sortField: c.sfld, checksum: c.csum })}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it.each(["full-latest.apkg", "full-legacy.apkg", "shared-latest.apkg"])("match the stored values in %s", async (name) => {
    const pkg = await loadPackage(name);
    for (const note of pkg.notes) {
      const nt = pkg.notetypes.find((n) => n.id === note.notetypeId)!;
      expect(noteSortFieldAndChecksum(note, nt)).toEqual({ sortField: note.sortField, checksum: note.checksum });
    }
  });
});
