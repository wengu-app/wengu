/**
 * Integration with @wengu/anki's .apkg writer (being written concurrently by another agent; this checks the
 * contract): core export → writeAnkiPackage (using the core's SQLite through the sql.js shim) → read back →
 * import into a fresh collection → export again: the same data.
 *
 * Normalised: `format` (the writer produces its own container format) and `warnings`.
 */
import { describe, expect, it } from "vitest";

import type { AnkiPackage } from "@wengu/anki";
import * as anki from "@wengu/anki";

import { sqlJsShim } from "../src/db/sqljs-shim.js";
import { loadSqlite } from "../src/node.js";
import { APKG_FIXTURES, engineAt, fixtureBytes } from "./helpers.js";

type Writer = (pkg: AnkiPackage, options?: Record<string, unknown>) => Promise<Uint8Array>;
const write = (anki as unknown as { writeAnkiPackage?: Writer }).writeAnkiPackage;

const norm = (p: AnkiPackage) => ({ ...p, format: null, warnings: [], media: [...p.media].sort((a, b) => (a.name < b.name ? -1 : 1)) });

describe.skipIf(!write)("export → .apkg bytes (writer) → import", () => {
  it.each(APKG_FIXTURES)("%s", async (name) => {
    const shim = sqlJsShim(await loadSqlite());
    const { engine } = await engineAt();
    await engine.importAnki(fixtureBytes(name));
    const exported = await engine.exportAnki();
    const bytes = await write!(exported, { sqlJs: shim, recomputeSortFields: false });
    const { engine: other } = await engineAt();
    await other.importAnki(bytes);
    expect(norm(await other.exportAnki())).toEqual(norm(exported));
  });
});
