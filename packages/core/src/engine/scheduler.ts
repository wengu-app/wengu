/**
 * Answering review items: FSRS memory states (ts-fsrs) + Anki's interval rules (@wengu/anki scheduling.ts) +
 * Anki's learning-step / lapse / ease / leech bookkeeping, as pure functions over Anki-style card columns.
 */
import {
  ankiFuzzFactor,
  cardDataJson,
  fsrsDecay,
  fsrsElapsedDays,
  fsrsGraduatingEasyInterval,
  fsrsGraduatingInterval,
  fsrsInterval,
  fsrsPassingIntervals,
} from "@wengu/anki";
import { FSRS6Algorithm, FSRS6_DEFAULT_WEIGHTS, FSRS6_MODEL_BOUNDS, migrateFSRS6Parameters } from "ts-fsrs/models/fsrs-6";

import type { ItemState, MemoryState, Rating, RatingName, RatingOutcome } from "../types.js";
import { cardDataOf } from "./carddata.js";

export const RATING_NAMES: readonly RatingName[] = ["again", "hard", "good", "easy"];

/** The card columns the scheduler reads and writes (Anki semantics). */
export interface CardColumns {
  id: number;
  type: number;
  queue: number;
  due: number;
  ivl: number;
  factor: number;
  reps: number;
  lapses: number;
  left: number;
  data: string;
}

export interface SchedulingConfig {
  /** Minutes. */
  learnSteps: readonly number[];
  relearnSteps: readonly number[];
  maximumInterval: number;
  /** Ratio (2.5 = 250%). */
  initialEase: number;
  desiredRetention: number;
  /** FSRS parameters as stored in the preset (null = FSRS-6 defaults, as Anki). */
  params: readonly number[] | null;
  leechThreshold: number;
  /** 0 = suspend, 1 = tag only. */
  leechAction: number;
  /** Apply Anki's interval fuzz (default true, as Anki). */
  fuzz: boolean;
}

export interface SchedulingTime {
  nowMs: number;
  today: number;
  /** Start of the next scheduler day, unix seconds. */
  nextDayAtSecs: number;
  /** Start (ms) of a scheduler day. */
  dayStart(day: number): number;
}

/** Memory state and last review time of a card, resolved by the caller (card data, else revlog replay). */
export interface CardMemory {
  memory: MemoryState | null;
  /** Unix seconds of the last review, if known. */
  lastReviewSecs: number | null;
}

export interface AnswerUpdate {
  card: Omit<CardColumns, "id">;
  /** Review log row (without id/cid/usn). */
  revlog: { ease: number; ivl: number; lastIvl: number; factor: number; kind: number };
  outcome: RatingOutcome;
  leech: boolean;
}

// ------------------------------------------------------------------------------------------------
// FSRS
// ------------------------------------------------------------------------------------------------

const algorithms = new Map<string, FSRS6Algorithm>();

export function fsrsWeights(params: readonly number[] | null): number[] {
  return params && params.length ? migrateFSRS6Parameters([...params]) : [...FSRS6_DEFAULT_WEIGHTS];
}

export function algorithmFor(params: readonly number[] | null): FSRS6Algorithm {
  const key = params && params.length ? params.join(",") : "default";
  let a = algorithms.get(key);
  if (!a) {
    a = new FSRS6Algorithm(fsrsWeights(params), true, FSRS6_MODEL_BOUNDS);
    algorithms.set(key, a);
  }
  return a;
}

/** Probability of recall after `elapsedDays` (FSRS forgetting curve with the preset's decay). */
export function retrievability(memory: MemoryState, elapsedDays: number, params: readonly number[] | null): number {
  const decay = -fsrsDecay(params ? [...params] : null);
  const factor = Math.pow(0.9, 1 / decay) - 1;
  return Math.pow(1 + (factor * Math.max(0, elapsedDays)) / memory.stability, decay);
}

/**
 * Memory state for a card that has SM-2 history but no FSRS state and no review log (FSRS's
 * `memory_state_from_sm2`, as Anki uses when FSRS is switched on): stability such that the SM-2 interval
 * had `sm2Retention` recall probability; difficulty from the ease factor.
 */
export function memoryFromSm2(easeFactor: number, intervalDays: number, sm2Retention: number, params: readonly number[] | null): MemoryState {
  const w = fsrsWeights(params);
  const decay = -fsrsDecay(params ? [...params] : null);
  const factor = Math.pow(0.9, 1 / decay) - 1;
  const stability = (Math.max(intervalDays, 0.001) * factor) / (Math.pow(sm2Retention, 1 / decay) - 1);
  const difficulty = 11 - (easeFactor - 1) / (Math.exp(w[8]!) * Math.pow(stability, -w[9]!) * Math.expm1((1 - sm2Retention) * w[10]!));
  return { stability, difficulty: Math.min(10, Math.max(1, difficulty)) };
}

export interface ReplayEntry {
  /** Review time, ms. */
  id: number;
  ease: number;
  kind: number;
  ivl: number;
}

/** Memory state from a card's review log (Anki's "compute memory state"): answers only; a manual reset starts over. */
export function replayMemory(entries: readonly ReplayEntry[], dayOf: (ms: number) => number, params: readonly number[] | null): CardMemory {
  const algo = algorithmFor(params);
  let state: MemoryState | null = null;
  let lastDay: number | null = null;
  let lastSecs: number | null = null;
  for (const r of entries) {
    if (r.kind === 4 && r.ease === 0 && r.ivl === 0) {
      state = null; // "forget"/reset to new
      lastDay = null;
      continue;
    }
    if (r.ease < 1 || r.ease > 4 || r.kind === 4 || r.kind === 5) continue;
    const day = dayOf(r.id);
    const t = lastDay === null ? 0 : day - lastDay;
    state = algo.next_state(state, t, r.ease);
    lastDay = day;
    lastSecs = Math.floor(r.id / 1000);
  }
  return { memory: state, lastReviewSecs: lastSecs };
}

// ------------------------------------------------------------------------------------------------
// Learning steps (Anki's LearningSteps)
// ------------------------------------------------------------------------------------------------

const stepSecs = (steps: readonly number[], i: number): number | null => {
  const m = steps[i];
  return m === undefined ? null : Math.max(1, Math.round(m * 60));
};

function stepIndex(steps: readonly number[], remaining: number): number {
  const total = steps.length;
  return Math.min(Math.max(total - (remaining % 1000), 0), Math.max(total - 1, 0));
}

function hardDelaySecs(steps: readonly number[], remaining: number): number | null {
  const idx = stepIndex(steps, remaining);
  const current = stepSecs(steps, idx);
  if (current === null) return null;
  if (idx !== 0) return current;
  const next = stepSecs(steps, idx + 1);
  if (next !== null) return Math.floor((current + next) / 2);
  return Math.min(Math.floor(current * 1.5), current + 86_400);
}

function goodDelaySecs(steps: readonly number[], remaining: number): number | null {
  return stepSecs(steps, stepIndex(steps, remaining) + 1);
}

/** Anki adds a random delay of up to 25% (at most 5 minutes) to learning steps; seeded here like the review fuzz. */
function learningFuzz(secs: number, cardId: number, reps: number, fuzz: boolean): number {
  if (!fuzz) return secs;
  const upper = secs + Math.floor(Math.min(secs * 0.25, 300));
  if (upper <= secs) return secs;
  return secs + Math.floor(ankiFuzzFactor(cardId, reps) * (upper - secs));
}

// ------------------------------------------------------------------------------------------------
// Card data JSON
// ------------------------------------------------------------------------------------------------

export function parseCardData(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function memoryFromData(data: Record<string, unknown>): MemoryState | null {
  const s = data["s"];
  const d = data["d"];
  return typeof s === "number" && typeof d === "number" ? { stability: s, difficulty: d } : null;
}

const round = (x: number, digits: number) => {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
};

/** Card data after an answer: Anki's layout (pos, s, d, dr, decay, lrt, then everything else kept), via @wengu/anki. */
function nextCardData(raw: string, memory: MemoryState, desiredRetention: number, decay: number, nowSecs: number): string {
  const data = cardDataOf(raw);
  data.memoryState = { stability: round(memory.stability, 4), difficulty: round(memory.difficulty, 3) };
  data.desiredRetention = round(desiredRetention, 2);
  data.decay = round(decay, 3);
  data.lastReviewTime = nowSecs;
  return cardDataJson(data);
}

/** Revlog `factor` under FSRS: post-review difficulty mapped to 100–1100 (observed in Anki's exports). */
export function revlogDifficultyFactor(difficulty: number): number {
  return Math.round(100 + (1000 * (difficulty - 1)) / 9);
}

export function itemStateOf(type: number): ItemState {
  return type === 1 ? "learning" : type === 2 ? "review" : type === 3 ? "relearning" : "new";
}

// ------------------------------------------------------------------------------------------------
// Answering
// ------------------------------------------------------------------------------------------------

export function intervalLabel(unit: "seconds" | "days", value: number): string {
  const fmt = (x: number) => (x >= 10 || Number.isInteger(x) ? String(Math.round(x)) : x.toFixed(1).replace(/\.0$/, ""));
  if (unit === "seconds") {
    if (value < 60) return `${Math.max(1, Math.round(value))}s`;
    if (value < 3600) return `${fmt(value / 60)}m`;
    if (value < 86_400) return `${fmt(value / 3600)}h`;
    value = value / 86_400;
  }
  if (value < 30) return `${fmt(value)}d`;
  if (value < 365) return `${fmt(value / 30)}mo`;
  return `${fmt(value / 365)}y`;
}

const EASE_MIN = 1300;
const EASE_DELTA = [0, -200, -150, 0, 150] as const;

function isLeech(lapses: number, threshold: number): boolean {
  if (threshold <= 0) return false;
  const half = Math.max(1, Math.ceil(threshold / 2));
  return lapses >= threshold && (lapses - threshold) % half === 0;
}

/**
 * Computes the result of answering `card` with `rating` at `time`. `lastIvl` is the interval of the previous
 * answer as the review log records it (days > 0, seconds < 0, 0 for a new card).
 */
export function answerCard(
  card: CardColumns,
  rating: Rating,
  mem: CardMemory,
  config: SchedulingConfig,
  time: SchedulingTime,
  lastIvl: number,
): AnswerUpdate {
  const all = previewCard(card, mem, config, time, lastIvl);
  return all[rating - 1]!;
}

/** Outcomes of all four ratings (the same computation `answerCard` commits). */
export function previewCard(
  card: CardColumns,
  mem: CardMemory,
  config: SchedulingConfig,
  time: SchedulingTime,
  lastIvl: number,
): [AnswerUpdate, AnswerUpdate, AnswerUpdate, AnswerUpdate] {
  const algo = algorithmFor(config.params);
  const decay = fsrsDecay(config.params ? [...config.params] : null);
  const dr = config.desiredRetention;
  const max = Math.max(1, config.maximumInterval);
  const nowSecs = Math.floor(time.nowMs / 1000);
  const isNew = card.type === 0;
  const memory = isNew ? null : mem.memory;
  const elapsed = memory && mem.lastReviewSecs !== null ? fsrsElapsedDays(mem.lastReviewSecs, time.nextDayAtSecs) : 0;
  const next = [1, 2, 3, 4].map((g) => {
    const s = algo.next_state(memory, elapsed, g);
    return { stability: s.stability, difficulty: s.difficulty };
  });
  const ivls = next.map((s) => fsrsInterval(s.stability, dr, decay));
  const fuzzFactor = config.fuzz ? ankiFuzzFactor(card.id, card.reps) : null;
  const revlogKind = card.type === 2 ? 1 : card.type === 3 ? 2 : 0;
  const startEase = card.factor > 0 ? card.factor : Math.round(config.initialEase * 1000);

  const results: AnswerUpdate[] = [];
  const passing = card.type === 2 ? fsrsPassingIntervals({ hard: ivls[1]!, good: ivls[2]!, easy: ivls[3]!, previousInterval: card.ivl, maximumInterval: max, fuzzFactor }) : null;

  for (let i = 0; i < 4; i++) {
    const rating = (i + 1) as Rating;
    const m = next[i]!;
    let type: number;
    let queue: number;
    let due: number;
    let ivl = card.ivl;
    let factor = card.factor;
    let lapses = card.lapses;
    let left = card.left;
    let unit: "seconds" | "days";
    let value: number;
    let leech = false;

    const toStep = (secs: number, remaining: number, steptype: 1 | 3) => {
      type = steptype;
      left = remaining;
      unit = "seconds";
      value = secs;
      if (secs >= 86_400) {
        queue = 3;
        due = time.today + Math.max(1, Math.round(secs / 86_400));
      } else {
        queue = 1;
        due = nowSecs + learningFuzz(secs, card.id, card.reps, config.fuzz);
      }
    };
    const toReview = (days: number) => {
      type = 2;
      queue = 2;
      left = 0;
      ivl = Math.min(Math.max(1, days), max);
      due = time.today + ivl;
      unit = "days";
      value = ivl;
    };

    if (card.type === 0 || card.type === 1) {
      const steps = config.learnSteps;
      const remaining = card.type === 0 ? steps.length : card.left;
      const graduate = (days: number) => {
        factor = startEase;
        toReview(days);
      };
      const graduating = () => fsrsGraduatingInterval(ivls[i]!, max, fuzzFactor);
      if (rating === 4) graduate(fsrsGraduatingEasyInterval(ivls[2]!, ivls[3]!, max, fuzzFactor));
      else if (steps.length === 0) graduate(graduating());
      else if (rating === 1) toStep(stepSecs(steps, 0)!, steps.length, 1);
      else if (rating === 2) toStep(hardDelaySecs(steps, remaining)!, remaining % 1000, 1);
      else {
        const d = goodDelaySecs(steps, remaining);
        if (d === null) graduate(graduating());
        else toStep(d, Math.max(1, (remaining % 1000) - 1), 1);
      }
    } else if (card.type === 2) {
      factor = Math.max(EASE_MIN, startEase + EASE_DELTA[rating]);
      if (rating === 1) {
        lapses = card.lapses + 1;
        leech = isLeech(lapses, config.leechThreshold);
        const lapseIvl = Math.min(Math.max(1, Math.round(Math.fround(ivls[0]!))), max);
        const first = stepSecs(config.relearnSteps, 0);
        if (first !== null) {
          ivl = lapseIvl;
          toStep(first, config.relearnSteps.length, 3);
        } else toReview(fsrsGraduatingInterval(ivls[0]!, max, fuzzFactor));
      } else {
        toReview(rating === 2 ? passing!.hard : rating === 3 ? passing!.good : passing!.easy);
      }
    } else {
      // relearning
      const steps = config.relearnSteps;
      const remaining = card.left;
      if (rating === 4) toReview(fsrsGraduatingEasyInterval(ivls[2]!, ivls[3]!, max, fuzzFactor));
      else if (steps.length === 0) toReview(fsrsGraduatingInterval(ivls[i]!, max, fuzzFactor));
      else if (rating === 1) {
        ivl = Math.min(Math.max(1, Math.round(Math.fround(ivls[0]!))), max);
        toStep(stepSecs(steps, 0)!, steps.length, 3);
      } else if (rating === 2) toStep(hardDelaySecs(steps, remaining)!, remaining % 1000, 3);
      else {
        const d = goodDelaySecs(steps, remaining);
        if (d === null) toReview(fsrsGraduatingInterval(ivls[2]!, max, fuzzFactor));
        else toStep(d, Math.max(1, (remaining % 1000) - 1), 3);
      }
    }

    const outState = itemStateOf(type!) as Exclude<ItemState, "new">;
    const dueAt = unit! === "days" ? time.dayStart(due!) : queue! === 3 ? time.dayStart(due!) : due! * 1000;
    if (leech && config.leechAction === 0) queue = -1;
    results.push({
      card: {
        type: type!,
        queue: queue!,
        due: due!,
        ivl,
        factor,
        reps: card.reps + 1,
        lapses,
        left,
        data: nextCardData(card.data, m, dr, decay, nowSecs),
      },
      revlog: {
        ease: rating,
        ivl: unit! === "days" ? value! : -value!,
        lastIvl,
        factor: revlogDifficultyFactor(m.difficulty),
        kind: revlogKind,
      },
      outcome: {
        rating,
        state: outState,
        interval: { unit: unit!, value: value! },
        dueAt,
        label: intervalLabel(unit!, value!),
        memory: m,
      },
      leech,
    });
  }
  return results as [AnswerUpdate, AnswerUpdate, AnswerUpdate, AnswerUpdate];
}
