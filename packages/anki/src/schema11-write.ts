/**
 * Model → schema 11 JSON (the documents stored in the `col` row of a legacy
 * package). The inverse of `schema11.ts`: every key that reader maps to a
 * typed field is written back from that field, every key it kept in an
 * `extra` bag is written back as it was.
 *
 * Models read from schema 18 packages can carry protobuf fields the reader
 * did not recognise (`extra["proto:N"]`); schema 11 has no place for them,
 * so they are dropped with a warning.
 */
import { JsonInt } from "./json.js";
import type { CardData, CardTemplate, Deck, DeckConfig, Notetype, NotetypeField } from "./model.js";

type Json = Record<string, unknown>;

/** Keys of `extra` that cannot be written to schema 11 JSON. */
function isProtoOnly(key: string): boolean {
  return /^proto:\d+$/.test(key) || key === "otherBytes";
}

/** defaults, then extra (minus proto-only keys), then the typed keys. */
function compose(defaults: Json, extra: Json, typed: Json, where: string, warn: (m: string) => void): Json {
  const out: Json = { ...defaults };
  for (const [k, v] of Object.entries(extra)) {
    if (isProtoOnly(k)) {
      warn(`${where}: "${k}" has no schema 11 equivalent and is not written`);
      continue;
    }
    if (!(k in typed)) out[k] = v;
  }
  return Object.assign(out, typed);
}

export function int64Json(id: string | null, where: string): JsonInt | null {
  if (id === null) return null;
  if (!/^-?\d+$/.test(id)) throw new Error(`${where}: id "${id}" is not a decimal integer`);
  const b = BigInt(id);
  if (b < -(2n ** 63n) || b >= 2n ** 63n) throw new Error(`${where}: id ${id} does not fit in 64 bits`);
  return new JsonInt(b.toString());
}

function fieldJson(f: NotetypeField, where: string, warn: (m: string) => void): Json {
  return compose({}, f.extra, {
    name: f.name,
    ord: f.ord,
    sticky: f.sticky,
    rtl: f.rtl,
    font: f.fontName,
    size: f.fontSize,
    description: f.description,
    plainText: f.plainText,
    collapsed: f.collapsed,
    excludeFromSearch: f.excludeFromSearch,
    id: int64Json(f.id, where),
    tag: f.tag,
    preventDeletion: f.preventDeletion,
  }, where, warn);
}

function templateJson(t: CardTemplate, where: string, warn: (m: string) => void): Json {
  return compose({}, t.extra, {
    name: t.name,
    ord: t.ord,
    qfmt: t.qfmt,
    afmt: t.afmt,
    bqfmt: t.bqfmt,
    bafmt: t.bafmt,
    did: t.targetDeckId ?? null,
    bfont: t.browserFontName,
    bsize: t.browserFontSize,
    id: int64Json(t.id, where),
  }, where, warn);
}

export function notetypeJson(nt: Notetype, warn: (m: string) => void): Json {
  const where = `notetype ${nt.id} "${nt.name}"`;
  const typed: Json = {
    id: nt.id,
    name: nt.name,
    type: nt.kind === "cloze" ? 1 : 0,
    mod: nt.mtime,
    usn: nt.usn,
    sortf: nt.sortFieldIndex,
    tmpls: nt.templates.map((t) => templateJson(t, `${where} template "${t.name}"`, warn)),
    flds: nt.fields.map((f) => fieldJson(f, `${where} field "${f.name}"`, warn)),
    css: nt.css,
    latexPre: nt.latexPre,
    latexPost: nt.latexPost,
    latexsvg: nt.latexSvg,
    req: nt.requirements.map((r) => [r.cardOrd, r.kind, r.fieldOrds]),
    originalStockKind: nt.originalStockKind,
  };
  if (nt.originalId !== null) typed["originalId"] = nt.originalId;
  // "did" (last deck used with this notetype) is written by every Anki version.
  return compose({ did: null }, nt.extra, typed, where, warn);
}

/** Per-deck desired retention: the model keeps 0–1, schema 11 stores a whole percentage (Anki writes 0.855 as 85). */
export function retentionPercent(r: number | null): number | null {
  return r === null ? null : Math.round(Math.fround(r) * 100);
}

export function deckJson(d: Deck, warn: (m: string) => void): Json {
  const where = `deck ${d.id} "${d.name}"`;
  const s = d.stats;
  const common: Json = {
    id: d.id,
    mod: d.mtime,
    name: d.name,
    usn: d.usn,
    lrnToday: [s.lastDayStudied, s.learningStudied],
    revToday: [s.lastDayStudied, s.reviewStudied],
    newToday: [s.lastDayStudied, s.newStudied],
    timeToday: [s.lastDayStudied, s.millisecondsStudied],
    collapsed: d.collapsed,
    browserCollapsed: d.browserCollapsed,
    desc: d.description,
  };
  if (d.markdownDescription) common["md"] = true;
  if (d.kind === "filtered" && d.filtered) {
    const f = d.filtered;
    return compose({}, d.extra, {
      ...common,
      dyn: 1,
      resched: f.reschedule,
      terms: f.searchTerms.map((t) => [t.search, t.limit, t.order]),
      delays: f.delays.length ? f.delays : null,
      previewAgainSecs: f.previewAgainSecs,
      previewHardSecs: f.previewHardSecs,
      previewGoodSecs: f.previewGoodSecs,
    }, where, warn);
  }
  return compose({}, d.extra, {
    ...common,
    dyn: 0,
    conf: d.configId ?? 1,
    extendNew: d.extendNew,
    extendRev: d.extendReview,
    reviewLimit: d.reviewLimit,
    newLimit: d.newLimit,
    reviewLimitToday: d.reviewLimitToday,
    newLimitToday: d.newLimitToday,
    desiredRetention: retentionPercent(d.desiredRetention),
  }, where, warn);
}

export function deckConfigJson(c: DeckConfig, warn: (m: string) => void): Json {
  const where = `deck preset ${c.id} "${c.name}"`;
  // The reader stores unknown keys of the nested objects as "new.x", "rev.x", "lapse.x".
  const top: Json = {};
  const nested: Record<"new" | "rev" | "lapse", Json> = { new: {}, rev: {}, lapse: {} };
  for (const [k, v] of Object.entries(c.extra)) {
    const m = /^(new|rev|lapse)\.(.+)$/.exec(k);
    if (m) nested[m[1] as "new" | "rev" | "lapse"][m[2]!] = v;
    else top[k] = v;
  }
  return compose({ dyn: false }, top, {
    id: c.id,
    mod: c.mtime,
    name: c.name,
    usn: c.usn,
    maxTaken: c.capAnswerTimeToSecs,
    autoplay: !c.disableAutoplay,
    timer: c.showTimer ? 1 : 0,
    replayq: !c.skipQuestionWhenReplayingAnswer,
    new: {
      ...nested.new,
      bury: c.buryNew,
      delays: c.learnSteps,
      initialFactor: Math.round(c.initialEase * 1000),
      ints: [c.graduatingIntervalGood, c.graduatingIntervalEasy, 0],
      // Legacy JSON: 0 = random, 1 = due (the protobuf enum is the other way round).
      order: c.newCardInsertOrder === 1 ? 0 : 1,
      perDay: c.newPerDay,
    },
    rev: {
      ...nested.rev,
      bury: c.buryReviews,
      ease4: c.easyMultiplier,
      ivlFct: c.intervalMultiplier,
      maxIvl: c.maximumReviewInterval,
      perDay: c.reviewsPerDay,
      hardFactor: c.hardMultiplier,
    },
    lapse: {
      ...nested.lapse,
      delays: c.relearnSteps,
      leechAction: c.leechAction,
      leechFails: c.leechThreshold,
      minInt: c.minimumLapseInterval,
      mult: c.lapseMultiplier,
    },
    newMix: c.newMix,
    newPerDayMinimum: c.newPerDayMinimum,
    interdayLearningMix: c.interdayLearningMix,
    reviewOrder: c.reviewOrder,
    newSortOrder: c.newCardSortOrder,
    newGatherPriority: c.newCardGatherPriority,
    buryInterdayLearning: c.buryInterdayLearning,
    fsrsWeights: c.fsrsParams4,
    fsrsParams5: c.fsrsParams5,
    fsrsParams6: c.fsrsParams6,
    desiredRetention: c.desiredRetention,
    ignoreRevlogsBeforeDate: c.ignoreRevlogsBeforeDate,
    easyDaysPercentages: c.easyDaysPercentages,
    stopTimerOnAnswer: c.stopTimerOnAnswer,
    secondsToShowQuestion: c.secondsToShowQuestion,
    secondsToShowAnswer: c.secondsToShowAnswer,
    questionAction: c.questionAction,
    answerAction: c.answerAction,
    waitForAudio: c.waitForAudio,
    sm2Retention: c.historicalRetention,
    weightSearch: c.paramSearch,
  }, where, warn);
}

/** `CardData` → the `cards.data` JSON object, keys in the order Anki writes them. */
export function cardDataObject(d: CardData): Json {
  const o: Json = {};
  if (d.originalPosition !== null) o["pos"] = d.originalPosition;
  if (d.memoryState) {
    o["s"] = d.memoryState.stability;
    o["d"] = d.memoryState.difficulty;
  }
  if (d.desiredRetention !== null) o["dr"] = d.desiredRetention;
  if (d.decay !== null) o["decay"] = d.decay;
  if (d.lastReviewTime !== null) o["lrt"] = d.lastReviewTime;
  if (d.customData !== null) o["cd"] = d.customData;
  for (const [k, v] of Object.entries(d.extra)) if (!(k in o)) o[k] = v;
  return o;
}
