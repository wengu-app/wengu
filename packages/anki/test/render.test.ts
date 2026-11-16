/**
 * Card rendering compared with Anki's own `card.render_output()`.
 *
 * Two normalisations, both for values that are not part of the card's
 * meaning:
 *  - hint element ids: Anki derives them from an internal hash; we use our own
 *    stable id, so ids are replaced with a placeholder on both sides;
 *  - "LaTeX image generation is disabled in the preferences.": an
 *    environment message the Python library appends when it cannot find a
 *    LaTeX image; it is not part of the template output.
 */
import { describe, expect, it } from "vitest";

import { renderPackageCard } from "../src/index.js";
import { expected, loadPackage } from "./helpers.js";

const source = expected("source.json");

function norm(html: string): string {
  return html
    .replace(/hint[0-9a-f]{16}/g, "hintID")
    .replace(/LaTeX image generation is disabled in the preferences\./g, "");
}

/** Format our AV tags like the Python library's repr; speed is f32 there, so compare it rounded. */
function avToAnkiRepr(tags: ReturnType<typeof renderPackageCard>["questionAvTags"]): string[] {
  return tags.map((t) =>
    t.kind === "sound"
      ? `SoundOrVideoTag(filename='${t.filename}')`
      : `TTSTag(field_text='${t.text}', lang='${t.lang}', voices=[${t.voices.map((v) => `'${v}'`).join(", ")}], speed=${t.speed?.toFixed(4)}, other_args=[])`,
  );
}

function normAnkiAv(tags: string[]): string[] {
  return tags.map((t) => t.replace(/speed=([0-9.]+)/, (_m, v: string) => `speed=${Number(v).toFixed(4)}`));
}

describe.each(["full-latest.apkg", "full-legacy.apkg"])("render %s", (pkgName) => {
  for (const exp of source.cards) {
    const nt = source.notes.find((n) => n.guid === exp.noteGuid)!.notetype;
    it(`${nt} card ${exp.ord + 1} (${exp.noteGuid})`, async () => {
      const pkg = await loadPackage(pkgName);
      const card = pkg.cards.find((c) => c.id === exp.id)!;
      const r = renderPackageCard(pkg, card);
      expect(r.errors).toEqual([]);
      expect(norm(r.question)).toBe(norm(exp.render.question));
      expect(norm(r.answer)).toBe(norm(exp.render.answer));
      expect(avToAnkiRepr(r.questionAvTags)).toEqual(normAnkiAv(exp.render.questionAvTags));
      expect(avToAnkiRepr(r.answerAvTags)).toEqual(normAnkiAv(exp.render.answerAvTags));
    });
  }
});
