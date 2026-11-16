import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { CardParity } from "./parity.js";
import { compareCard, formatReport, relErr } from "./parity.js";
import { FIXTURES, expected, loadPackage } from "./helpers.js";

const source = expected("source.json");

async function compute(pkgName: string): Promise<CardParity[]> {
  const pkg = await loadPackage(pkgName);
  const rows: CardParity[] = [];
  for (const exp of source.cards) {
    if (!exp.next || !exp.memoryState) continue;
    const card = pkg.cards.find((c) => c.id === exp.id)!;
    const note = source.notes.find((n) => n.guid === exp.noteGuid)!;
    rows.push(compareCard(pkg, card, exp, source.today, `${note.notetype.slice(0, 14)} #${exp.ord + 1} ${exp.deck.split("::").pop()}`));
  }
  return rows;
}

describe.each(["full-latest.apkg", "full-legacy.apkg"])("FSRS parity from %s", (pkgName) => {
  it("covers cards with real review history under every preset", async () => {
    const rows = await compute(pkgName);
    expect(rows.length).toBeGreaterThanOrEqual(10);
    expect(new Set(rows.map((r) => `${r.paramsVersion}${r.defaultParams}`)).size).toBe(3); // default v6, custom v6, v5
    if (pkgName === "full-latest.apkg") {
      const report = formatReport(rows);
      console.log(report);
      if (process.env["WRITE_PARITY_REPORT"]) writeFileSync(join(FIXTURES, "..", "parity-report.txt"), report + "\n");
    }
  });

  it("elapsed days agree with Anki for due/overdue review cards", async () => {
    // For cards reviewed before their due date, Anki's current-state
    // elapsed_days reports the scheduled interval instead (observed); the
    // memory-state test below shows Anki itself uses the real elapsed days.
    for (const r of await compute(pkgName)) {
      if (r.elapsedDaysAnki === null) continue; // (re)learning cards don't report it
      const card = (await loadPackage(pkgName)).cards.find((c) => c.id === r.cardId)!;
      const due = card.due <= source.today;
      if (due) expect(r.elapsedDaysOurs, r.label).toBe(r.elapsedDaysAnki);
      else expect(r.elapsedDaysAnki, r.label).toBe(card.interval);
    }
  });

  it("memory state from revlog replay matches Anki's own replay", async () => {
    for (const r of await compute(pkgName)) {
      expect(relErr(r.tsReplay.stability, r.ankiReplay.stability), r.label).toBeLessThan(1e-4);
      expect(relErr(r.tsReplay.difficulty, r.ankiReplay.difficulty), r.label).toBeLessThan(1e-4);
    }
  });

  it("rounded incremental replay reproduces the stored memory state", async () => {
    for (const r of await compute(pkgName)) {
      expect(r.tsReplayRounded.stability, r.label).toBeCloseTo(r.stored.stability, 3);
      expect(r.tsReplayRounded.difficulty, r.label).toBeCloseTo(r.stored.difficulty, 2);
    }
  });

  it("next memory states per rating match Anki's", async () => {
    for (const r of await compute(pkgName)) {
      for (const x of r.ratings) {
        if (!x.anki) continue;
        expect(relErr(x.ts.stability, x.anki.stability), `${r.label} ${x.rating}`).toBeLessThan(1e-4);
        expect(relErr(x.ts.difficulty, x.anki.difficulty), `${r.label} ${x.rating}`).toBeLessThan(1e-4);
      }
    }
  });

  it("next review intervals fall inside the FSRS fuzz range around ts-fsrs's unfuzzed interval", async () => {
    // Known discrepancy (not tuned away): for a card that was already
    // reviewed today (elapsed 0 days), Anki's Hard/Good intervals can land
    // above the fuzz range of the plain FSRS interval. Anki applies an extra
    // policy there that ts-fsrs does not reproduce. Everything else must be
    // inside the range.
    const outside: string[] = [];
    for (const r of await compute(pkgName)) {
      for (const x of r.ratings) {
        if (x.ankiDays === null) continue;
        const [lo, hi] = x.fuzzRange!;
        if (x.ankiDays >= lo && x.ankiDays <= hi) continue;
        outside.push(`${r.label} ${x.rating}: Anki ${x.ankiDays}, ts-fsrs ${x.tsUnfuzzedDays} [${lo},${hi}], elapsed ${r.elapsedDaysOurs}`);
        expect(r.elapsedDaysOurs, `unexplained: ${outside.at(-1)}`).toBe(0);
        expect(x.ankiDays, `unexplained: ${outside.at(-1)}`).toBeGreaterThan(hi);
      }
    }
    if (outside.length) console.log("Intervals outside the fuzz range (same-day re-review):\n  " + outside.join("\n  "));
  });

  it("revlog factor holds the post-review FSRS difficulty, rescaled to 100–1100", async () => {
    const pkg = await loadPackage(pkgName);
    let checked = 0;
    for (const card of pkg.cards) {
      const last = pkg.revlog.filter((r) => r.cardId === card.id && r.ease > 0).at(-1);
      if (!last || !card.data.memoryState) continue;
      expect(last.factor).toBe(Math.round(100 + (1000 * (card.data.memoryState.difficulty - 1)) / 9));
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(10);
  });

  it("learning/relearning step delays match the preset's steps", async () => {
    const pkg = await loadPackage(pkgName);
    for (const r of await compute(pkgName)) {
      const card = pkg.cards.find((c) => c.id === r.cardId)!;
      const conf = pkg.deckConfigs.find((c) => c.id === pkg.decks.find((d) => d.id === card.deckId)!.configId)!;
      const again = r.ratings[0]!;
      const steps = card.type === 1 ? conf.learnSteps : conf.relearnSteps;
      expect(again.ankiSecs, r.label).toBe(Math.round(steps[0]! * 60));
    }
  });
});
