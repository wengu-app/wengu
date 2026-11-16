/**
 * FSRS parity: recompute Anki's memory states and next intervals from the
 * imported review log with ts-fsrs, and line them up with Anki's answers.
 *
 * Nothing here is tuned to Anki: day boundaries come from the package
 * (crt), parameters from the preset, and the algorithm is ts-fsrs's FSRS-6
 * implementation used as-is. Differences are reported, not hidden.
 */
import { get_fuzz_range } from "ts-fsrs";
import { FSRS6Algorithm, FSRS6_DEFAULT_WEIGHTS, FSRS6_MODEL_BOUNDS, migrateFSRS6Parameters } from "ts-fsrs/models/fsrs-6";

import type { AnkiPackage, Card, RevlogEntry } from "../src/index.js";
import {
  ankiFuzzFactor,
  fsrsDecay,
  fsrsGraduatingEasyInterval,
  fsrsGraduatingInterval,
  fsrsInterval,
  fsrsParametersFor,
  fsrsPassingIntervals,
} from "../src/index.js";
import type { ExpectedCard, ExpectedState } from "./helpers.js";

export interface MemoryState {
  stability: number;
  difficulty: number;
}

export interface RatingComparison {
  rating: "again" | "hard" | "good" | "easy";
  ankiKind: string;
  anki: MemoryState | null;
  ts: MemoryState;
  /** Review interval in days (review outcomes only). */
  ankiDays: number | null;
  tsUnfuzzedDays: number | null;
  /**
   * ts-fsrs unfuzzed interval + Anki's `fuzz_delta()` for that interval. Not expected to match: `fuzz_delta()` seeds
   * its fuzz with reps - 1 (it re-creates the *previous* answer's fuzz), an answer uses reps.
   */
  tsWithAnkiFuzz: number | null;
  /** Our prediction of Anki's interval: ts-fsrs stability + Anki's interval rules + Anki's fuzz (src/scheduling.ts). */
  ruleDays: number | null;
  /** The same without fuzz. */
  ruleUnfuzzedDays: number | null;
  /**
   * FSRS fuzz range around the ts-fsrs unfuzzed interval (ts-fsrs
   * get_fuzz_range with elapsed = 0, i.e. the documented percentage bands
   * without ts-fsrs's extra "must exceed elapsed days" floor).
   */
  fuzzRange: [number, number] | null;
  /** The same range with ts-fsrs's floor (fuzzed interval > elapsed days), as ts-fsrs itself would fuzz. */
  tsFsrsFuzzRange: [number, number] | null;
  /** Learning/relearning step delay in seconds (step outcomes only). */
  ankiSecs: number | null;
}

export interface CardParity {
  cardId: number;
  label: string;
  paramsVersion: number;
  defaultParams: boolean;
  desiredRetention: number;
  reviews: number;
  /** Stored in cards.data (rounded by Anki to 4/3 decimals, updated incrementally). */
  stored: MemoryState;
  /** Anki's compute_memory_state(): full replay of the revlog. */
  ankiReplay: MemoryState;
  /** ts-fsrs replay of the same revlog. */
  tsReplay: MemoryState;
  /** ts-fsrs replay, rounding S to 4 and D to 3 decimals after each step like the stored value. */
  tsReplayRounded: MemoryState;
  elapsedDaysAnki: number | null;
  elapsedDaysOurs: number;
  ratings: RatingComparison[];
}

/** Day number of a unix time, counted from the collection creation day (crt is a day start). */
export function dayOf(unixSecs: number, crt: number): number {
  return Math.floor((unixSecs - crt) / 86400);
}

/** Reviews that feed FSRS: real answers (ease 1–4). Manual entries (set due date, reset) have ease 0. */
export function fsrsReviews(revlog: readonly RevlogEntry[]): RevlogEntry[] {
  return revlog.filter((r) => r.ease >= 1 && r.ease <= 4 && r.kind !== 4 && r.kind !== 5);
}

export function algorithmFor(params: number[] | null): FSRS6Algorithm {
  const w = params ? migrateFSRS6Parameters(params) : [...FSRS6_DEFAULT_WEIGHTS];
  return new FSRS6Algorithm(w, true, FSRS6_MODEL_BOUNDS);
}

export function replay(
  algo: FSRS6Algorithm,
  reviews: readonly RevlogEntry[],
  crt: number,
  roundEachStep: boolean,
): { state: MemoryState; lastDay: number } {
  let state: MemoryState | null = null;
  let lastDay: number | null = null;
  for (const r of reviews) {
    const day = dayOf(Math.floor(r.id / 1000), crt);
    const t = lastDay === null ? 0 : day - lastDay;
    state = algo.next_state(state, t, r.ease);
    if (roundEachStep) state = { stability: round(state.stability, 4), difficulty: round(state.difficulty, 3) };
    lastDay = day;
  }
  if (!state || lastDay === null) throw new Error("no reviews");
  return { state, lastDay };
}

function fuzzRange(ivl: number, elapsed: number, max: number): [number, number] {
  const r = get_fuzz_range(ivl, elapsed, max);
  return [r.min_ivl, r.max_ivl];
}

function round(x: number, d: number): number {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}

function memOf(s: ExpectedState): MemoryState | null {
  return s.memory_state ? { stability: s.memory_state.stability, difficulty: s.memory_state.difficulty } : null;
}

export function compareCard(pkg: AnkiPackage, card: Card, exp: ExpectedCard, today: number, label: string): CardParity {
  const deck = pkg.decks.find((d) => d.id === card.deckId)!;
  const fp = fsrsParametersFor(deck, pkg.deckConfigs)!;
  const algo = algorithmFor(fp.params);
  const conf = pkg.deckConfigs.find((c) => c.id === deck.configId)!;
  const reviews = fsrsReviews(pkg.revlog.filter((r) => r.cardId === card.id));
  const crt = pkg.collection.crt;
  const exact = replay(algo, reviews, crt, false);
  const rounded = replay(algo, reviews, crt, true);
  const stored = card.data.memoryState!;
  const lastReviewDay = card.data.lastReviewTime !== null ? dayOf(card.data.lastReviewTime, crt) : exact.lastDay;
  const elapsed = today - lastReviewDay;
  const ratings: RatingComparison[] = [];
  const names = ["again", "hard", "good", "easy"] as const;
  const next = names.map((_, i) => algo.next_state(stored, elapsed, i + 1));
  const rule = (fuzzFactor: number | null): (number | null)[] => {
    const decay = fsrsDecay(fp.params);
    const ivl = next.map((s) => fsrsInterval(s.stability, fp.desiredRetention, decay));
    const max = conf.maximumReviewInterval;
    const kinds = names.map((n) => exp.next![n].kind);
    if (card.type === 2) {
      if (kinds[1] !== "review" || kinds[2] !== "review" || kinds[3] !== "review") return [null, null, null, null];
      const p = fsrsPassingIntervals({ hard: ivl[1]!, good: ivl[2]!, easy: ivl[3]!, previousInterval: card.interval, maximumInterval: max, fuzzFactor });
      return [null, p.hard, p.good, p.easy];
    }
    return names.map((n, i) =>
      kinds[i] !== "review" ? null
      : n === "easy" ? fsrsGraduatingEasyInterval(ivl[2]!, ivl[3]!, max, fuzzFactor)
      : fsrsGraduatingInterval(ivl[i]!, max, fuzzFactor),
    );
  };
  const ruleFuzzed = rule(ankiFuzzFactor(card.id, card.reps));
  const ruleUnfuzzed = rule(null);
  names.forEach((rating, i) => {
    const g = i + 1;
    const st = exp.next![rating];
    // Anki answers from the stored (rounded) state, with whole elapsed days.
    const ts = next[i]!;
    const isReview = st.kind === "review";
    const tsDays = isReview ? Math.min(Math.max(algo.next_interval(ts.stability, fp.desiredRetention), 1), conf.maximumReviewInterval) : null;
    const fuzz = tsDays !== null && exp.fuzzDelta ? (exp.fuzzDelta[tsDays] ?? null) : null;
    ratings.push({
      rating,
      ankiKind: st.kind,
      anki: memOf(st),
      ts,
      ankiDays: isReview ? (st.scheduled_days ?? null) : null,
      tsUnfuzzedDays: tsDays,
      tsWithAnkiFuzz: tsDays !== null && fuzz !== null ? tsDays + fuzz : null,
      ruleDays: ruleFuzzed[i] ?? null,
      ruleUnfuzzedDays: ruleUnfuzzed[i] ?? null,
      fuzzRange: tsDays !== null ? fuzzRange(tsDays, 0, conf.maximumReviewInterval) : null,
      tsFsrsFuzzRange: tsDays !== null ? fuzzRange(tsDays, elapsed, conf.maximumReviewInterval) : null,
      ankiSecs: isReview ? null : (st.scheduled_secs ?? st.learning_scheduled_secs ?? null),
    });
  });
  return {
    cardId: card.id,
    label,
    paramsVersion: fp.version,
    defaultParams: fp.params === null,
    desiredRetention: fp.desiredRetention,
    reviews: reviews.length,
    stored,
    ankiReplay: { stability: exp.recomputedMemoryState!.stability, difficulty: exp.recomputedMemoryState!.difficulty },
    tsReplay: exact.state,
    tsReplayRounded: rounded.state,
    elapsedDaysAnki: exp.next!.current.elapsed_days ?? null,
    elapsedDaysOurs: elapsed,
    ratings,
  };
}

export function relErr(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(Math.abs(b), 1e-9);
}

const f = (x: number, d = 4) => x.toFixed(d);

export function formatReport(rows: CardParity[]): string {
  const out: string[] = [];
  out.push("FSRS parity: ts-fsrs FSRS6Algorithm vs Anki 26.09 (v = FSRS version of preset params, d = Anki default params)");
  out.push("");
  out.push("Memory state after replaying the revlog (S = stability days, D = difficulty):");
  out.push("card                         | v | n  | Anki stored S/D     | Anki replay S/D         | ts replay S/D           | ts rounded-chain S/D | max rel err vs Anki replay");
  for (const r of rows) {
    const e = Math.max(relErr(r.tsReplay.stability, r.ankiReplay.stability), relErr(r.tsReplay.difficulty, r.ankiReplay.difficulty));
    out.push(
      `${r.label.padEnd(28)} | ${r.paramsVersion}${r.defaultParams ? "d" : " "}| ${String(r.reviews).padStart(2)} | ` +
        `${f(r.stored.stability)}/${f(r.stored.difficulty, 3)}`.padEnd(19) + " | " +
        `${f(r.ankiReplay.stability, 5)}/${f(r.ankiReplay.difficulty, 5)}`.padEnd(23) + " | " +
        `${f(r.tsReplay.stability, 5)}/${f(r.tsReplay.difficulty, 5)}`.padEnd(23) + " | " +
        `${f(r.tsReplayRounded.stability)}/${f(r.tsReplayRounded.difficulty, 3)}`.padEnd(20) + " | " +
        e.toExponential(2),
    );
  }
  out.push("");
  out.push("Next states at export time. 'elapsed' = Anki's current-state elapsed_days / ours (today − day of last review).");
  out.push("Per rating: Anki vs ts-fsrs memory state; Anki interval, ts-fsrs unfuzzed interval, fuzz range around it, ts + Anki fuzz_delta(),");
  out.push("and 'rule': our prediction with Anki's interval rules and fuzz (src/scheduling.ts; unfuzzed in parentheses):");
  for (const r of rows) {
    out.push(`${r.label}  elapsed ${r.elapsedDaysAnki}/${r.elapsedDaysOurs}  DR ${r.desiredRetention}`);
    for (const x of r.ratings) {
      const mem = x.anki ? `S ${f(x.anki.stability)} vs ${f(x.ts.stability)}  D ${f(x.anki.difficulty, 3)} vs ${f(x.ts.difficulty, 3)}` : "(no memory state)";
      const ivl =
        x.ankiDays !== null
          ? `days Anki ${String(x.ankiDays).padStart(4)}  ts ${String(x.tsUnfuzzedDays).padStart(4)}  fuzz range [${x.fuzzRange![0]},${x.fuzzRange![1]}]` +
            `${x.ankiDays >= x.fuzzRange![0] && x.ankiDays <= x.fuzzRange![1] ? " in " : " OUT"}  ts+fuzz_delta() ${x.tsWithAnkiFuzz}${x.tsWithAnkiFuzz === x.ankiDays ? " =" : " ≠"}` +
            (x.ankiDays < x.tsFsrsFuzzRange![0] ? `  [below ts-fsrs floor ${x.tsFsrsFuzzRange![0]}]` : "") +
            `  rule ${x.ruleDays} (${x.ruleUnfuzzedDays})${x.ruleDays === x.ankiDays ? " =" : " ≠"}`
          : `step ${x.ankiKind} ${x.ankiSecs}s`;
      out.push(`   ${x.rating.padEnd(5)} ${mem}   ${ivl}`);
    }
  }
  const all = rows.flatMap((r) => r.ratings).filter((x) => x.ankiDays !== null);
  const inRange = all.filter((x) => x.ankiDays! >= x.fuzzRange![0] && x.ankiDays! <= x.fuzzRange![1]).length;
  const exactUnfuzzed = all.filter((x) => x.ankiDays === x.tsUnfuzzedDays).length;
  const exactDelta = all.filter((x) => x.ankiDays === x.tsWithAnkiFuzz).length;
  const belowFloor = all.filter((x) => x.ankiDays! < x.tsFsrsFuzzRange![0]).length;
  const exactRule = all.filter((x) => x.ankiDays === x.ruleDays).length;
  const memCmp = rows.flatMap((r) => r.ratings).filter((x) => x.anki);
  const maxMemErr = Math.max(
    ...rows.map((r) => Math.max(relErr(r.tsReplay.stability, r.ankiReplay.stability), relErr(r.tsReplay.difficulty, r.ankiReplay.difficulty))),
    ...memCmp.map((x) => Math.max(relErr(x.ts.stability, x.anki!.stability), relErr(x.ts.difficulty, x.anki!.difficulty))),
  );
  out.push("");
  out.push(`Summary: ${rows.length} cards, ${memCmp.length} per-rating memory states + ${rows.length} replays, max relative error ${maxMemErr.toExponential(2)}.`);
  out.push(
    `Review intervals: ${all.length} compared; inside fuzz range ${inRange}/${all.length}; equal to unfuzzed ts-fsrs ${exactUnfuzzed}/${all.length}; ` +
      `equal to ts-fsrs + Anki fuzz_delta() ${exactDelta}/${all.length}; below ts-fsrs's own fuzz floor ${belowFloor}/${all.length}; ` +
      `equal to our rule-based prediction ${exactRule}/${all.length}.`,
  );
  return out.join("\n");
}
