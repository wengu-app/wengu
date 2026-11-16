/**
 * Scheduler against Anki's recorded behaviour.
 *
 * 1. review-intervals.json (Anki 26.09, ~640 situations × 4 ratings, fuzzed and unfuzzed): for every recorded card
 *    state, the core's full answer computation (state machine + FSRS + interval rules + fuzz) must give Anki's
 *    outcome kind, interval in days (review outcomes) and next memory state.
 * 2. source.json (the fixture collection, exported at a known time): import full-latest.apkg, ask the engine to
 *    explain each card with recorded next states, compare kinds, days, learning-step seconds and memory states.
 */
import { describe, expect, it } from "vitest";

import { previewCard } from "../src/engine/scheduler.js";
import type { CardColumns, SchedulingConfig } from "../src/engine/scheduler.js";
import type { RatingName } from "../src/types.js";
import { FIXTURE_NOW_SECS, engineAt, expectedJson, fixtureBytes } from "./helpers.js";

type Kind = "learning" | "relearning" | "review";
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
  next: Record<RatingName, Outcome>;
}
interface Fixture {
  presets: { name: string; desiredRetention: number; params: number[] }[];
  fuzzed: Rec[];
  unfuzzed: Rec[];
}

const fx = expectedJson<Fixture>("review-intervals.json");
const RATINGS: RatingName[] = ["again", "hard", "good", "easy"];
const relErr = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-9);

function predict(r: Rec, fuzz: boolean) {
  const p = fx.presets[r.preset]!;
  // Anki's default steps (the script only changes retention, maximum and FSRS parameters). Remaining learning
  // steps are not recorded: Good graduating means the card is on its last step.
  const left = r.type === 2 ? 0 : r.type === 3 ? 1 : r.next.good[0] === "review" ? 1 : 2;
  const card: CardColumns = {
    id: r.cardId,
    type: r.type,
    queue: r.type === 2 ? 2 : 1,
    due: r.due,
    ivl: r.ivl,
    factor: 2500,
    reps: r.reps,
    lapses: 0,
    left,
    data: JSON.stringify({ s: r.memoryState.s, d: r.memoryState.d, lrt: r.lastReviewTime }),
  };
  const config: SchedulingConfig = {
    learnSteps: [1, 10],
    relearnSteps: [10],
    maximumInterval: r.max,
    initialEase: 2.5,
    desiredRetention: p.desiredRetention,
    params: p.params.length ? p.params : null,
    leechThreshold: 8,
    leechAction: 1,
    fuzz,
  };
  const time = { nowMs: (r.nextDayStart - 43200) * 1000, today: r.today, nextDayAtSecs: r.nextDayStart, dayStart: (d: number) => d };
  return previewCard(card, { memory: { stability: r.memoryState.s, difficulty: r.memoryState.d }, lastReviewSecs: r.lastReviewTime }, config, time, 0);
}

describe.each([
  ["fuzzed", fx.fuzzed, true],
  ["unfuzzed", fx.unfuzzed, false],
] as const)("Anki %s review-interval records", (_n, recs, fuzz) => {
  it("outcome kind, days and memory state match for every rating", () => {
    let days = 0;
    let states = 0;
    const mismatches: string[] = [];
    for (const r of recs) {
      const out = predict(r, fuzz);
      RATINGS.forEach((rating, i) => {
        const [kind, ankiDays, s, d] = r.next[rating];
        const o = out[i]!.outcome;
        const label = `${r.cardId}@${r.reps} type ${r.type} ${rating}`;
        if (o.state !== kind) mismatches.push(`${label}: state ${o.state} != ${kind}`);
        if (kind === "review") {
          days++;
          if (o.interval.unit !== "days" || o.interval.value !== ankiDays) mismatches.push(`${label}: ${o.interval.value} ${o.interval.unit} != ${ankiDays} days`);
        }
        states++;
        if (relErr(o.memory.stability, s) > 1e-4 || relErr(o.memory.difficulty, d) > 1e-4) mismatches.push(`${label}: memory ${o.memory.stability}/${o.memory.difficulty} != ${s}/${d}`);
      });
    }
    expect(mismatches).toEqual([]);
    expect(days).toBeGreaterThan(800);
    expect(states).toBe(recs.length * 4);
    expect(recs.length).toBeGreaterThan(300);
  });
});

interface SourceState {
  kind: string;
  scheduled_days?: number;
  scheduled_secs?: number;
  learning_scheduled_secs?: number;
  review?: { scheduled_days: number };
  memory_state?: { stability: number; difficulty: number };
}
interface SourceCard {
  id: number;
  next?: Record<"current" | RatingName, SourceState>;
}

describe("imported collection, explained at the fixture's export time", () => {
  it("matches Anki's next states for every card with history (kinds, days, step seconds, memory)", async () => {
    const source = expectedJson<{ now: number; cards: SourceCard[] }>("source.json");
    expect(source.now).toBe(FIXTURE_NOW_SECS);
    const { engine } = await engineAt(FIXTURE_NOW_SECS);
    await engine.importAnki(fixtureBytes("full-latest.apkg"));
    let compared = 0;
    const mismatches: string[] = [];
    for (const c of source.cards) {
      if (!c.next) continue;
      const ex = engine.explain(c.id);
      for (const rating of RATINGS) {
        const a = c.next[rating];
        const o = ex.outcomes[rating];
        const label = `${c.id} ${rating}`;
        compared++;
        if (o.state !== a.kind) mismatches.push(`${label}: state ${o.state} != ${a.kind}`);
        if (a.kind === "review") {
          if (o.interval.unit !== "days" || o.interval.value !== a.scheduled_days) mismatches.push(`${label}: ${o.interval.value}${o.interval.unit} != ${a.scheduled_days}d`);
        } else {
          const secs = a.scheduled_secs ?? a.learning_scheduled_secs;
          if (o.interval.unit !== "seconds" || o.interval.value !== secs) mismatches.push(`${label}: ${o.interval.value}${o.interval.unit} != ${secs}s`);
        }
        if (a.memory_state) {
          if (relErr(o.memory.stability, a.memory_state.stability) > 1e-4 || relErr(o.memory.difficulty, a.memory_state.difficulty) > 1e-4)
            mismatches.push(`${label}: memory ${o.memory.stability}/${o.memory.difficulty} != ${a.memory_state.stability}/${a.memory_state.difficulty}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
    expect(compared).toBeGreaterThanOrEqual(40);
  });

  it("the interval an Again on a review card keeps for after relearning matches Anki's", async () => {
    const source = expectedJson<{ cards: (SourceCard & { type: number })[] }>("source.json");
    const { engine } = await engineAt(FIXTURE_NOW_SECS);
    await engine.importAnki(fixtureBytes("full-latest.apkg"));
    let n = 0;
    for (const c of source.cards) {
      if (!c.next || c.type !== 2 || c.next.again.kind !== "relearning") continue;
      const before = engine.getKnowledgePoint(engine.getItemRow(c.id)!.kp_id)!;
      expect(before).not.toBeNull();
      engine.answer({ itemId: c.id, rating: 1, takenMs: 1000 });
      expect(engine.getItemRow(c.id)!.ivl, String(c.id)).toBe(c.next.again.review!.scheduled_days);
      n++;
    }
    expect(n).toBeGreaterThan(5);
  });
});
