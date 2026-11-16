/**
 * Optional: run the importer over decks that are not committed (shared decks,
 * personal collections). Skipped unless REAL_DECKS_DIR is set.
 *
 *   fixtures/.venv/bin/python fixtures/oracle.py $DIR/*.apkg   # Anki's answers
 *   REAL_DECKS_DIR=$DIR pnpm --filter @wengu/anki test real-decks
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { readAnkiPackage, renderPackageCard } from "../src/index.js";

const dir = process.env["REAL_DECKS_DIR"];
const files = dir ? readdirSync(dir).filter((f) => /\.(apkg|colpkg)$/.test(f)) : [];

interface Oracle {
  counts: { notes: number; cards: number; revlog: number };
  notes: Record<string, { notetype: string; fields: string[]; tags: string[] }>;
  cards: Record<string, { question: string; answer: string }>;
  media: string[];
}

const norm = (html: string) =>
  html.replace(/hint[0-9a-f]{16}/g, "hintID").replace(/LaTeX image generation is disabled in the preferences\./g, "");

describe.skipIf(!dir)("real decks", () => {
  for (const f of files) {
    it(f, async () => {
      const pkg = await readAnkiPackage(new Uint8Array(readFileSync(join(dir!, f))));
      expect(pkg.warnings).toEqual([]);
      const oraclePath = join(dir!, f + ".oracle.json");
      const oracle: Oracle | null = existsSync(oraclePath) ? JSON.parse(readFileSync(oraclePath, "utf8")) : null;
      const renderMismatches: string[] = [];
      for (const card of pkg.cards) {
        const r = renderPackageCard(pkg, card);
        const note = pkg.notes.find((n) => n.id === card.noteId)!;
        const exp = oracle?.cards[`${note.guid}#${card.ord}`];
        // Broken templates: Anki shows an error page; we must report an error too.
        if (exp && /template has a problem|No cloze .* found on card/.test(exp.question + exp.answer)) {
          expect(r.errors.length, `card ${card.id} should report a template error`).toBeGreaterThan(0);
          continue;
        }
        expect(r.errors, `card ${card.id}`).toEqual([]);
        if (!exp) continue;
        if (norm(r.question) !== norm(exp.question) || norm(r.answer) !== norm(exp.answer))
          renderMismatches.push(`${note.guid}#${card.ord}\n  ours Q: ${JSON.stringify(r.question)}\n  anki Q: ${JSON.stringify(exp.question)}\n  ours A: ${JSON.stringify(r.answer)}\n  anki A: ${JSON.stringify(exp.answer)}`);
      }
      if (!oracle) return;
      expect({ notes: pkg.notes.length, cards: pkg.cards.length, revlog: pkg.revlog.length }).toEqual(oracle.counts);
      for (const n of pkg.notes) expect(n.fields, n.guid).toEqual(oracle.notes[n.guid]?.fields);
      expect(pkg.media.map((m) => m.name).sort()).toEqual(oracle.media);
      expect(renderMismatches.join("\n")).toBe("");
    });
  }
});
