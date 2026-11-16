/**
 * How Anki turns FSRS memory states into intervals, checked against Anki itself on many situations: reviews on the
 * due day, early, late, and again on the same day; four presets; with and without fuzz.
 * Fixture: fixtures/expected/review-intervals.json, written by fixtures/intervals.py. The rules are documented in
 * src/scheduling.ts.
 */
import { describe, expect, it } from "vitest";

import {
  ankiFuzzFactor,
  fsrsDecay,
  fsrsElapsedDays,
  fsrsGraduatingEasyInterval,
  fsrsGraduatingInterval,
  fsrsInterval,
  fsrsPassingIntervals,
  fuzzedInterval,
} from "../src/index.js";
import { expected } from "./helpers.js";
import { algorithmFor, relErr } from "./parity.js";

type Kind = "learning" | "relearning" | "review";
/** [kind, scheduled days (review outcomes), stability, difficulty] */
type Outcome = [Kind, number | null, number, number];
interface Rec {
  cardId: number;
  preset: number;
  max: number;
  type: 1 | 2 | 3;
  reps: number;
  ivl: number;
  due: number;
  today: number;
  nextDayStart: number;
  lastReviewTime: number;
  memoryState: { s: number; d: number };
  currentElapsedDays: number | null;
  next: Record<"again" | "hard" | "good" | "easy", Outcome>;
}
interface Fixture {
  ankiVersion: string;
  presets: { name: string; desiredRetention: number; params: number[] }[];
  fuzzed: Rec[];
  unfuzzed: Rec[];
}

const fx = expected("review-intervals.json") as unknown as Fixture;
const RATINGS = ["again", "hard", "good", "easy"] as const;

const presetOf = (r: Rec) => fx.presets[r.preset]!;
const paramsOf = (r: Rec) => (presetOf(r).params.length ? presetOf(r).params : null);
/** Unrounded FSRS interval of an outcome, from Anki's own stability (isolates the interval rules). */
const ivlOf = (r: Rec, o: Outcome) => fsrsInterval(o[2], presetOf(r).desiredRetention, fsrsDecay(paramsOf(r)));
const allReview = (r: Rec) => r.next.hard[0] === "review" && r.next.good[0] === "review" && r.next.easy[0] === "review";

function predictReview(r: Rec, fuzzFactor: number | null) {
  return fsrsPassingIntervals({
    hard: ivlOf(r, r.next.hard),
    good: ivlOf(r, r.next.good),
    easy: ivlOf(r, r.next.easy),
    previousInterval: r.ivl,
    maximumInterval: r.max,
    fuzzFactor,
  });
}

describe.each([
  ["fuzzed", fx.fuzzed, true],
  ["unfuzzed", fx.unfuzzed, false],
] as const)("Anki %s", (_name, recs, fuzz) => {
  const reviews = recs.filter((r) => r.type === 2 && allReview(r));
  const factor = (r: Rec) => (fuzz ? ankiFuzzFactor(r.cardId, r.reps) : null);

  it("covers the interesting situations", () => {
    expect(reviews.length).toBeGreaterThan(200);
    const sameDay = reviews.filter((r) => fsrsElapsedDays(r.lastReviewTime, r.nextDayStart) === 0);
    expect(sameDay.length).toBeGreaterThan(50);
    // Same-day re-reviews where FSRS gives Good no more than Hard, so Good = Hard + 1 is forced by the minimum.
    expect(sameDay.filter((r) => Math.round(ivlOf(r, r.next.good)) <= Math.round(ivlOf(r, r.next.hard))).length).toBeGreaterThan(20);
    // Ratings whose rounded FSRS interval is below the previous interval, where Anki keeps the previous interval.
    const keptPrevious = reviews.flatMap((r) =>
      (["hard", "good", "easy"] as const).filter((k) => Math.round(ivlOf(r, r.next[k])) < r.ivl && r.next[k][1] === r.ivl),
    );
    expect(keptPrevious.length).toBeGreaterThan(10);
  });

  it("FSRS elapsed days = whole days from the last review to the next day start (same-day re-review: 0)", () => {
    let checked = 0;
    for (const r of recs) {
      const algo = algorithmFor(paramsOf(r));
      const elapsed = fsrsElapsedDays(r.lastReviewTime, r.nextDayStart);
      expect(elapsed).toBe(r.today - Math.floor((r.lastReviewTime - (r.nextDayStart - 86400 * (r.today + 1))) / 86400));
      RATINGS.forEach((rating, i) => {
        const ours = algo.next_state({ stability: r.memoryState.s, difficulty: r.memoryState.d }, elapsed, i + 1);
        const anki = r.next[rating];
        expect(relErr(ours.stability, anki[2]), `${r.cardId}@${r.reps} ${rating} S`).toBeLessThan(1e-4);
        expect(relErr(ours.difficulty, anki[3]), `${r.cardId}@${r.reps} ${rating} D`).toBeLessThan(1e-4);
        checked++;
      });
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it("the elapsed_days Anki reports for a not-yet-due review card is its interval, not what FSRS uses", () => {
    const notDue = recs.filter((r) => r.type === 2 && r.due > r.today);
    expect(notDue.length).toBeGreaterThan(50);
    for (const r of notDue) expect(r.currentElapsedDays).toBe(r.ivl);
    expect(notDue.some((r) => fsrsElapsedDays(r.lastReviewTime, r.nextDayStart) !== r.ivl)).toBe(true);
  });

  it("review cards: Hard/Good/Easy days match exactly", () => {
    for (const r of reviews) {
      const p = predictReview(r, factor(r));
      expect([p.hard, p.good, p.easy], `${r.cardId}@${r.reps} ivl ${r.ivl}`).toEqual([r.next.hard[1], r.next.good[1], r.next.easy[1]]);
    }
  });

  it("(re)learning cards: graduating Good/Easy (and Hard/Again) days match exactly", () => {
    let checked = 0;
    for (const r of recs.filter((x) => x.type !== 2)) {
      RATINGS.forEach((rating) => {
        const o = r.next[rating];
        if (o[0] !== "review") return;
        const days =
          rating === "easy"
            ? fsrsGraduatingEasyInterval(ivlOf(r, r.next.good), ivlOf(r, o), r.max, factor(r))
            : fsrsGraduatingInterval(ivlOf(r, o), r.max, factor(r));
        expect(days, `${r.cardId}@${r.reps} type ${r.type} ${rating}`).toBe(o[1]);
        checked++;
      });
    }
    expect(checked).toBeGreaterThan(50);
  });

  it("control: without the previous-interval minimum, predictions stop matching", () => {
    // Plain FSRS interval, fuzzed with no minimum except 1, Good > Hard and Easy > Good kept.
    const naive = (r: Rec) => {
      const f = factor(r);
      const h = fuzzedInterval(ivlOf(r, r.next.hard), 1, r.max, f);
      const g = fuzzedInterval(ivlOf(r, r.next.good), h + 1, r.max, f);
      return [h, g, fuzzedInterval(ivlOf(r, r.next.easy), g + 1, r.max, f)];
    };
    const mismatches = reviews.filter((r) => naive(r).some((d, i) => d !== r.next[(["hard", "good", "easy"] as const)[i]!][1]));
    expect(mismatches.length).toBeGreaterThanOrEqual(5);
  });
});

it("fuzz is seeded by card id + reps: the fuzzed run is not reproduced with reps - 1", () => {
  const reviews = fx.fuzzed.filter((r) => r.type === 2 && allReview(r));
  const wrong = reviews.filter((r) => {
    const p = predictReview(r, ankiFuzzFactor(r.cardId, r.reps - 1));
    return p.hard !== r.next.hard[1] || p.good !== r.next.good[1] || p.easy !== r.next.easy[1];
  });
  expect(wrong.length).toBeGreaterThan(reviews.length / 2);
});
