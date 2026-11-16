/**
 * Schema 11 (legacy packages: `collection.anki2` / `collection.anki21`).
 *
 * Notetypes, decks, presets, config and the tag registry are JSON documents
 * stored in the single `col` row.
 */
import type { SqlValue } from "sql.js";

import { idString, parseJsonExact } from "./json.js";
import type { CardRequirement, CardTemplate, Deck, DeckConfig, Notetype, NotetypeField, Tag } from "./model.js";
import { str } from "./read.js";
import type { SchemaParts } from "./schema18.js";
import { linkParents } from "./schema18.js";

type Json = Record<string, unknown>;

function obj(v: unknown): Json {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {};
}
function n(v: unknown, d = 0): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return d;
}
function nOrNull(v: unknown): number | null {
  return v === null || v === undefined ? null : n(v);
}
function s(v: unknown, d = ""): string {
  return typeof v === "string" ? v : d;
}
function b(v: unknown, d = false): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  return d;
}
function nums(v: unknown): number[] {
  return Array.isArray(v) ? v.map((x) => n(x)) : [];
}
/** Copy keys not in `known` into an extra bag. */
function rest(o: Json, known: readonly string[]): Json {
  const out: Json = {};
  for (const [k, v] of Object.entries(o)) if (!known.includes(k)) out[k] = v;
  return out;
}

const FIELD_KEYS = [
  "name", "ord", "sticky", "rtl", "font", "size", "description", "plainText", "collapsed",
  "excludeFromSearch", "id", "tag", "preventDeletion",
] as const;
const TMPL_KEYS = ["name", "ord", "qfmt", "afmt", "bqfmt", "bafmt", "did", "bfont", "bsize", "id"] as const;
const NT_KEYS = [
  "id", "name", "type", "mod", "usn", "sortf", "tmpls", "flds", "css", "latexPre", "latexPost",
  "latexsvg", "req", "originalStockKind", "originalId",
] as const;

function notetypeFromJson(m: Json): Notetype {
  const fields: NotetypeField[] = (Array.isArray(m["flds"]) ? m["flds"] : []).map((x: unknown, i: number) => {
    const f = obj(x);
    return {
      ord: n(f["ord"], i),
      name: s(f["name"]),
      sticky: b(f["sticky"]),
      rtl: b(f["rtl"]),
      fontName: s(f["font"]),
      fontSize: n(f["size"]),
      description: s(f["description"]),
      plainText: b(f["plainText"]),
      collapsed: b(f["collapsed"]),
      excludeFromSearch: b(f["excludeFromSearch"]),
      id: idString(f["id"]),
      tag: nOrNull(f["tag"]),
      preventDeletion: b(f["preventDeletion"]),
      extra: rest(f, FIELD_KEYS),
    };
  });
  const templates: CardTemplate[] = (Array.isArray(m["tmpls"]) ? m["tmpls"] : []).map((x: unknown, i: number) => {
    const t = obj(x);
    const did = nOrNull(t["did"]);
    return {
      ord: n(t["ord"], i),
      name: s(t["name"]),
      qfmt: s(t["qfmt"]),
      afmt: s(t["afmt"]),
      bqfmt: s(t["bqfmt"]),
      bafmt: s(t["bafmt"]),
      targetDeckId: did === 0 ? null : did,
      browserFontName: s(t["bfont"]),
      browserFontSize: n(t["bsize"]),
      id: idString(t["id"]),
      // schema 11 has no per-template mtime/usn; use the notetype's
      mtime: n(m["mod"]),
      usn: n(m["usn"]),
      extra: rest(t, TMPL_KEYS),
    };
  });
  const requirements: CardRequirement[] = (Array.isArray(m["req"]) ? m["req"] : []).map((r: unknown) => {
    const a = Array.isArray(r) ? r : [];
    const kind = a[1] === "all" ? "all" : a[1] === "any" ? "any" : "none";
    return { cardOrd: n(a[0]), kind, fieldOrds: nums(a[2]) };
  });
  return {
    id: n(m["id"]),
    name: s(m["name"]),
    kind: n(m["type"]) === 1 ? "cloze" : "normal",
    mtime: n(m["mod"]),
    usn: n(m["usn"]),
    sortFieldIndex: n(m["sortf"]),
    css: s(m["css"]),
    latexPre: s(m["latexPre"]),
    latexPost: s(m["latexPost"]),
    latexSvg: b(m["latexsvg"]),
    requirements,
    originalStockKind: n(m["originalStockKind"]),
    originalId: nOrNull(m["originalId"]),
    fields,
    templates,
    extra: rest(m, NT_KEYS),
  };
}

const DECK_KEYS = [
  "id", "mod", "name", "usn", "lrnToday", "revToday", "newToday", "timeToday", "collapsed",
  "browserCollapsed", "desc", "dyn", "conf", "extendNew", "extendRev", "reviewLimit", "newLimit",
  "reviewLimitToday", "newLimitToday", "desiredRetention", "md", "resched", "terms", "delays",
  "previewAgainSecs", "previewHardSecs", "previewGoodSecs",
] as const;

function dayLimit(v: unknown): { limit: number; today: number } | null {
  const o = obj(v);
  if (!("limit" in o)) return null;
  return { limit: n(o["limit"]), today: n(o["today"]) };
}

function deckFromJson(d: Json): Deck {
  const name = s(d["name"]);
  const dyn = n(d["dyn"]) !== 0;
  const day = (k: string, i: number) => (Array.isArray(d[k]) ? n((d[k] as unknown[])[i]) : 0);
  const dr = nOrNull(d["desiredRetention"]);
  return {
    id: n(d["id"]),
    name,
    path: name.split("::"),
    parentId: null,
    mtime: n(d["mod"]),
    usn: n(d["usn"]),
    kind: dyn ? "filtered" : "normal",
    description: s(d["desc"]),
    markdownDescription: b(d["md"]),
    collapsed: b(d["collapsed"]),
    browserCollapsed: b(d["browserCollapsed"]),
    configId: dyn ? null : n(d["conf"], 1),
    reviewLimit: nOrNull(d["reviewLimit"]),
    newLimit: nOrNull(d["newLimit"]),
    reviewLimitToday: dayLimit(d["reviewLimitToday"]),
    newLimitToday: dayLimit(d["newLimitToday"]),
    // Observed: schema 11 stores the per-deck override as a whole percentage (80), schema 18 as 0.8.
    desiredRetention: dr === null ? null : dr > 1 ? dr / 100 : dr,
    extendNew: n(d["extendNew"]),
    extendReview: n(d["extendRev"]),
    filtered: dyn
      ? {
          reschedule: b(d["resched"], true),
          searchTerms: (Array.isArray(d["terms"]) ? d["terms"] : []).map((t: unknown) => {
            const a = Array.isArray(t) ? t : [];
            return { search: s(a[0]), limit: n(a[1]), order: n(a[2]) };
          }),
          delays: nums(d["delays"]),
          previewAgainSecs: n(d["previewAgainSecs"]),
          previewHardSecs: n(d["previewHardSecs"]),
          previewGoodSecs: n(d["previewGoodSecs"]),
        }
      : null,
    stats: {
      lastDayStudied: day("newToday", 0),
      newStudied: day("newToday", 1),
      reviewStudied: day("revToday", 1),
      learningStudied: day("lrnToday", 1),
      millisecondsStudied: day("timeToday", 1),
    },
    extra: rest(d, DECK_KEYS),
  };
}

const DCONF_KEYS = [
  "id", "mod", "name", "usn", "maxTaken", "autoplay", "timer", "replayq", "new", "rev", "lapse",
  "newMix", "newPerDayMinimum", "interdayLearningMix", "reviewOrder", "newSortOrder", "newGatherPriority",
  "buryInterdayLearning", "fsrsWeights", "fsrsParams5", "fsrsParams6", "desiredRetention",
  "ignoreRevlogsBeforeDate", "easyDaysPercentages", "stopTimerOnAnswer", "secondsToShowQuestion",
  "secondsToShowAnswer", "questionAction", "answerAction", "waitForAudio", "sm2Retention", "weightSearch",
] as const;

function deckConfigFromJson(c: Json): DeckConfig {
  const nw = obj(c["new"]);
  const rev = obj(c["rev"]);
  const lapse = obj(c["lapse"]);
  const ints = nums(nw["ints"]);
  const extra = rest(c, DCONF_KEYS);
  const sub = (o: Json, known: string[], prefix: string) => {
    for (const [k, v] of Object.entries(o)) if (!known.includes(k)) extra[`${prefix}.${k}`] = v;
  };
  sub(nw, ["bury", "delays", "initialFactor", "ints", "order", "perDay"], "new");
  sub(rev, ["bury", "ease4", "ivlFct", "maxIvl", "perDay", "hardFactor"], "rev");
  sub(lapse, ["delays", "leechAction", "leechFails", "minInt", "mult"], "lapse");
  return {
    id: n(c["id"]),
    name: s(c["name"]),
    mtime: n(c["mod"]),
    usn: n(c["usn"]),
    learnSteps: nums(nw["delays"]),
    relearnSteps: nums(lapse["delays"]),
    newPerDay: n(nw["perDay"]),
    reviewsPerDay: n(rev["perDay"]),
    newPerDayMinimum: n(c["newPerDayMinimum"]),
    initialEase: n(nw["initialFactor"]) / 1000,
    easyMultiplier: n(rev["ease4"]),
    hardMultiplier: n(rev["hardFactor"], 1.2),
    lapseMultiplier: n(lapse["mult"]),
    intervalMultiplier: n(rev["ivlFct"], 1),
    maximumReviewInterval: n(rev["maxIvl"]),
    minimumLapseInterval: n(lapse["minInt"]),
    graduatingIntervalGood: n(ints[0]),
    graduatingIntervalEasy: n(ints[1]),
    // Legacy JSON: new.order 0 = random, 1 = due. Protobuf enum: 0 = due, 1 = random.
    newCardInsertOrder: n(nw["order"], 1) === 0 ? 1 : 0,
    newCardGatherPriority: n(c["newGatherPriority"]),
    newCardSortOrder: n(c["newSortOrder"]),
    newMix: n(c["newMix"]),
    reviewOrder: n(c["reviewOrder"]),
    interdayLearningMix: n(c["interdayLearningMix"]),
    // Legacy JSON leechAction: 0 = suspend, 1 = tag only (same as protobuf enum).
    leechAction: n(lapse["leechAction"]),
    leechThreshold: n(lapse["leechFails"]),
    disableAutoplay: !b(c["autoplay"], true),
    capAnswerTimeToSecs: n(c["maxTaken"]),
    showTimer: b(c["timer"]),
    stopTimerOnAnswer: b(c["stopTimerOnAnswer"]),
    secondsToShowQuestion: n(c["secondsToShowQuestion"]),
    secondsToShowAnswer: n(c["secondsToShowAnswer"]),
    questionAction: n(c["questionAction"]),
    answerAction: n(c["answerAction"]),
    waitForAudio: b(c["waitForAudio"], true),
    skipQuestionWhenReplayingAnswer: !b(c["replayq"], true),
    buryNew: b(nw["bury"]),
    buryReviews: b(rev["bury"]),
    buryInterdayLearning: b(c["buryInterdayLearning"]),
    fsrsParams4: nums(c["fsrsWeights"]),
    fsrsParams5: nums(c["fsrsParams5"]),
    fsrsParams6: nums(c["fsrsParams6"]),
    desiredRetention: n(c["desiredRetention"], 0.9),
    historicalRetention: n(c["sm2Retention"], 0.9),
    ignoreRevlogsBeforeDate: s(c["ignoreRevlogsBeforeDate"]),
    easyDaysPercentages: nums(c["easyDaysPercentages"]),
    paramSearch: s(c["weightSearch"]),
    extra,
  };
}

function parse(v: SqlValue | undefined): Json {
  const text = str(v);
  if (!text) return {};
  return obj(parseJsonExact(text));
}

/** colRow = SELECT crt, mod, scm, ver, usn, ls, conf, models, decks, dconf, tags FROM col */
export function readSchema11(colRow: SqlValue[]): SchemaParts {
  const config = parse(colRow[6]);
  const notetypes = Object.values(parse(colRow[7])).map((m) => notetypeFromJson(obj(m))).sort((a, b) => a.id - b.id);
  const decks = Object.values(parse(colRow[8])).map((d) => deckFromJson(obj(d))).sort((a, b) => a.id - b.id);
  linkParents(decks);
  const deckConfigs = Object.values(parse(colRow[9])).map((c) => deckConfigFromJson(obj(c))).sort((a, b) => a.id - b.id);
  const tags: Tag[] = Object.entries(parse(colRow[10])).map(([name, usn]) => ({ name, usn: n(usn), collapsed: false }));
  return { config, notetypes, decks, deckConfigs, tags };
}
