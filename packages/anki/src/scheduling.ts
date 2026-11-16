import type { AnkiPackage, Card, Deck, DeckConfig } from "./model.js";

export type CardDue =
  | { kind: "position"; position: number }
  | { kind: "timestamp"; unixSeconds: number }
  | { kind: "day"; day: number; /** Unix seconds of the start of that day, assuming the given rollover hour in UTC offset 0. */ approxUnixSeconds: number };

/**
 * Interpret `card.due`.
 *
 * Review and day-learning cards count days from the collection's creation
 * day. A package does not record the user's rollover hour or time zone
 * (verified: neither is in an exported .apkg), so the absolute time is an
 * approximation: crt is the start of the creation day, plus `day` × 24h.
 */
export function cardDue(card: Pick<Card, "due" | "queue" | "type">, crt: number): CardDue {
  switch (card.queue) {
    case 0:
      return { kind: "position", position: card.due };
    case 1:
    case 4:
      return { kind: "timestamp", unixSeconds: card.due };
    case 2:
    case 3:
      return { kind: "day", day: card.due, approxUnixSeconds: crt + card.due * 86400 };
    default:
      // buried / suspended: interpret by card type
      if (card.type === 0) return { kind: "position", position: card.due };
      if (card.type === 1 || card.type === 3) {
        // intraday learning cards keep a timestamp; interday ones a day number
        return card.due > 1_000_000_000
          ? { kind: "timestamp", unixSeconds: card.due }
          : { kind: "day", day: card.due, approxUnixSeconds: crt + card.due * 86400 };
      }
      return { kind: "day", day: card.due, approxUnixSeconds: crt + card.due * 86400 };
  }
}

export interface FsrsParameters {
  /** FSRS generation the parameters belong to. */
  version: 4 | 5 | 6;
  /** The stored parameters (17, 19 or 21 numbers), or null if the preset uses Anki's built-in defaults. */
  params: number[] | null;
  desiredRetention: number;
}

/**
 * The FSRS parameters and desired retention Anki would use for a card in
 * `deck`: newest non-empty parameter set from the deck's preset, and the
 * deck-level retention override if present.
 */
export function fsrsParametersFor(deck: Deck, configs: readonly DeckConfig[]): FsrsParameters | null {
  const conf = configs.find((c) => c.id === deck.configId);
  if (!conf) return null;
  const desiredRetention = deck.desiredRetention ?? conf.desiredRetention;
  if (conf.fsrsParams6.length) return { version: 6, params: conf.fsrsParams6, desiredRetention };
  if (conf.fsrsParams5.length) return { version: 5, params: conf.fsrsParams5, desiredRetention };
  if (conf.fsrsParams4.length) return { version: 4, params: conf.fsrsParams4, desiredRetention };
  return { version: 6, params: null, desiredRetention };
}

/** Lookup helpers for a package. */
export function indexPackage(pkg: AnkiPackage) {
  const notes = new Map(pkg.notes.map((n) => [n.id, n]));
  const notetypes = new Map(pkg.notetypes.map((n) => [n.id, n]));
  const decks = new Map(pkg.decks.map((d) => [d.id, d]));
  const revlogByCard = new Map<number, AnkiPackage["revlog"]>();
  for (const r of pkg.revlog) {
    const l = revlogByCard.get(r.cardId);
    if (l) l.push(r);
    else revlogByCard.set(r.cardId, [r]);
  }
  return { notes, notetypes, decks, revlogByCard };
}

// ------------------------------------------------------------------------------------------------
// Review intervals, as Anki (26.09) derives them from FSRS.
//
// FSRS itself only yields a memory state and an unrounded interval per rating. What Anki then
// schedules for a passing review (Hard/Good/Easy) depends on three more things, all verified
// against the Anki library (see test/review-intervals.test.ts and fixtures/intervals.py):
//
//  1. Elapsed days fed to FSRS: whole days from the last review to the start of the *next*
//     scheduler day, i.e. today's day number minus the day number of the last review. A card
//     already reviewed today has 0 elapsed days. (`ReviewState.elapsed_days` that Anki reports for
//     the current state is something else: for a card that is not yet due it equals the scheduled
//     interval.)
//  2. A minimum per rating, derived from the card's *previous scheduled interval* (`card.ivl`),
//     not from the elapsed days:
//       - if the new interval (rounded) is longer than the previous one: previous + 1;
//       - else, if the previous interval is still inside the new interval's fuzz range: the previous
//         interval itself (so fuzz cannot shorten it; the result may *equal* the old interval);
//       - else (the interval genuinely shrank): no minimum.
//     Hard is at least 1, Good at least Hard + 1, Easy at least Good + 1.
//  3. Fuzz is applied *after* raising the interval to that minimum: the fuzz range is centred on
//     max(interval, minimum), and its lower end is cut at the minimum. So when the minimum binds
//     (typically Good = Hard + 1 after a same-day re-review, where FSRS gives Hard and Good the same
//     stability), the result can lie far outside the fuzz range of the plain FSRS interval.
//
// Anki computes in 32-bit floats; Math.fround reproduces that where it decides a rounding.

const f32 = Math.fround;

/** FSRS elapsed days for an answer given today, from the last review time and the start of the next scheduler day (unix seconds). */
export function fsrsElapsedDays(lastReviewUnixSecs: number, nextDayStartUnixSecs: number): number {
  return Math.max(0, Math.floor((nextDayStartUnixSecs - lastReviewUnixSecs) / 86400));
}

/** Unrounded FSRS interval in days for a stability and desired retention. `decay` is w20 (FSRS-6), 0.5 for FSRS-4.5/5. */
export function fsrsInterval(stability: number, desiredRetention: number, decay: number): number {
  const d = f32(-decay);
  const factor = f32(f32(Math.exp(f32(f32(Math.log(0.9)) / d))) - 1);
  const r = f32(f32(Math.pow(f32(desiredRetention), f32(1 / d))) - 1);
  return f32(f32(f32(stability) / factor) * r);
}

/** The FSRS decay Anki uses for a preset's parameter list (w20; 0.5 before FSRS-6; 0.1542 for Anki's defaults). */
export function fsrsDecay(params: readonly number[] | null): number {
  if (!params || params.length === 0) return 0.1542;
  if (params.length < 21) return 0.5;
  return params[20]!;
}

const FUZZ_BANDS: ReadonlyArray<readonly [start: number, end: number, factor: number]> = [
  [2.5, 7, 0.15],
  [7, 20, 0.1],
  [20, Infinity, 0.05],
];

/** Half-width of the fuzz range: 0 below 2.5 days, else 1 day plus 15% / 10% / 5% of the days in each band. */
export function fuzzHalfWidth(interval: number): number {
  const ivl = f32(interval);
  if (ivl < 2.5) return 0;
  let delta = f32(1);
  for (const [start, end, factor] of FUZZ_BANDS) {
    const days = Math.max(0, f32(Math.min(ivl, end) - start));
    delta = f32(delta + f32(f32(factor) * days));
  }
  return delta;
}

const roundHalfAway = (x: number) => Math.sign(x) * Math.round(Math.abs(x));
const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);

/**
 * Fuzz range [lo, hi] (whole days) for an interval, after raising the interval to `minimum` and keeping both ends within
 * [minimum, maximum]. If that collapses the range to one day above 2, it is widened by one day when `maximum` allows.
 */
export function fuzzRange(interval: number, minimum: number, maximum: number): [number, number] {
  const min = Math.min(minimum, maximum);
  const ivl = f32(clamp(f32(interval), min, maximum));
  const delta = fuzzHalfWidth(ivl);
  let lo = clamp(Math.max(0, roundHalfAway(f32(ivl - delta))), min, maximum);
  let hi = clamp(Math.max(0, roundHalfAway(f32(ivl + delta))), min, maximum);
  if (hi === lo && hi > 2 && hi < maximum) hi = lo + 1;
  return [lo, hi];
}

/** Rule 2 above: the least interval a passing rating may get, given the card's previous scheduled interval. */
export function minimumPassingInterval(interval: number, previousInterval: number, maximum: number): number {
  const rounded = Math.max(0, roundHalfAway(f32(interval)));
  if (rounded > previousInterval) return previousInterval + 1;
  const [, hi] = fuzzRange(interval, 1, maximum);
  return previousInterval <= hi ? previousInterval : 0;
}

/** Applies a fuzz factor in [0, 1) to an interval within [minimum, maximum]; null = no fuzz (round and clamp). */
export function fuzzedInterval(interval: number, minimum: number, maximum: number, fuzzFactor: number | null): number {
  const max = Math.max(maximum, 1);
  const min = clamp(minimum, 1, max);
  if (fuzzFactor === null) return clamp(Math.max(0, roundHalfAway(f32(interval))), min, max);
  const [lo, hi] = fuzzRange(interval, min, max);
  return Math.floor(f32(lo + f32(f32(fuzzFactor) * (1 + hi - lo))));
}

export interface PassingIntervalInput {
  /** Unrounded FSRS intervals (days) of the Hard / Good / Easy outcomes (see fsrsInterval). */
  hard: number;
  good: number;
  easy: number;
  /** The card's current scheduled interval (`card.ivl`) before this answer. */
  previousInterval: number;
  /** The preset's maximum interval. */
  maximumInterval: number;
  /** Fuzz factor in [0, 1) (see ankiFuzzFactor), or null for Anki's unfuzzed behaviour. */
  fuzzFactor: number | null;
}

/** Days Anki schedules for Hard / Good / Easy on a review card under FSRS (load balancer off). */
export function fsrsPassingIntervals(x: PassingIntervalInput): { hard: number; good: number; easy: number } {
  const max = x.maximumInterval;
  const next = (ivl: number, floor: number) =>
    fuzzedInterval(ivl, Math.max(minimumPassingInterval(ivl, x.previousInterval, max), floor), max, x.fuzzFactor);
  const hard = next(x.hard, 1);
  const good = next(x.good, hard + 1);
  const easy = next(x.easy, good + 1);
  return { hard, good, easy };
}

/**
 * Days Anki schedules when a (re)learning card under FSRS leaves its last step with Good: the FSRS interval rounded to
 * whole days first, then fuzzed with no minimum other than 1. The previous-interval minimum of reviews does not apply.
 * (Anki's source treats Hard/Again on a relearning card without steps the same way; the tests do not exercise that.)
 */
export function fsrsGraduatingInterval(interval: number, maximumInterval: number, fuzzFactor: number | null): number {
  return fuzzedInterval(Math.max(1, roundHalfAway(f32(interval))), 1, maximumInterval, fuzzFactor);
}

/**
 * Days for Easy on a (re)learning card under FSRS: at least one more than Good would get, where that Good value is
 * fuzzed from the *unrounded* Good interval (unlike fsrsGraduatingInterval).
 */
export function fsrsGraduatingEasyInterval(goodInterval: number, easyInterval: number, maximumInterval: number, fuzzFactor: number | null): number {
  const good = fuzzedInterval(goodInterval, 1, maximumInterval, fuzzFactor);
  return fuzzedInterval(Math.max(1, roundHalfAway(f32(easyInterval))), good + 1, maximumInterval, fuzzFactor);
}

// ------------------------------------------------------------------------------------------------
// Anki's fuzz factor. Anki seeds a ChaCha12 generator (Rust `rand` 0.9 StdRng, seeded through
// `seed_from_u64`, which expands the 64-bit seed with PCG32) with card id + review count (`reps`)
// and takes its first 32-bit output as an f32 in [0, 1) (top 23 bits as the mantissa). The same card
// at the same review count therefore always gets the same fuzz. Implemented here from the published
// ChaCha (RFC 8439) and PCG definitions.

const MASK64 = (1n << 64n) - 1n;

function pcg32Words(seed: bigint, count: number): number[] {
  let state = seed & MASK64;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    state = (state * 6364136223846793005n + 11634580027462260723n) & MASK64;
    const xorshifted = Number((((state >> 18n) ^ state) >> 27n) & 0xffffffffn);
    const rot = Number(state >> 59n);
    out.push(((xorshifted >>> rot) | (xorshifted << ((32 - rot) & 31))) >>> 0);
  }
  return out;
}

/** First 32-bit word of ChaCha with `doubleRounds` double rounds, 256-bit key (8 LE words), block counter 0, nonce 0. */
function chachaFirstWord(key: readonly number[], doubleRounds: number): number {
  const init = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574, ...key, 0, 0, 0, 0];
  const s = [...init];
  const rotl = (v: number, c: number) => ((v << c) | (v >>> (32 - c))) >>> 0;
  const qr = (a: number, b: number, c: number, d: number) => {
    s[a] = (s[a]! + s[b]!) >>> 0; s[d] = rotl(s[d]! ^ s[a]!, 16);
    s[c] = (s[c]! + s[d]!) >>> 0; s[b] = rotl(s[b]! ^ s[c]!, 12);
    s[a] = (s[a]! + s[b]!) >>> 0; s[d] = rotl(s[d]! ^ s[a]!, 8);
    s[c] = (s[c]! + s[d]!) >>> 0; s[b] = rotl(s[b]! ^ s[c]!, 7);
  };
  for (let i = 0; i < doubleRounds; i++) {
    qr(0, 4, 8, 12); qr(1, 5, 9, 13); qr(2, 6, 10, 14); qr(3, 7, 11, 15);
    qr(0, 5, 10, 15); qr(1, 6, 11, 12); qr(2, 7, 8, 13); qr(3, 4, 9, 14);
  }
  return (s[0]! + init[0]!) >>> 0;
}

/**
 * The fuzz factor Anki uses when a card with id `cardId` and `reps` reviews so far is answered.
 * (Anki's `fuzz_delta()` helper, used by the FSRS add-on, uses `reps - 1` instead.)
 */
export function ankiFuzzFactor(cardId: number, reps: number): number {
  const word = chachaFirstWord(pcg32Words(BigInt(cardId) + BigInt(reps), 8), 6);
  return (word >>> 9) / 2 ** 23;
}
