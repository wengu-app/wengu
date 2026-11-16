/**
 * Schema 18 (Anki 2.1.50+ "latest" packages, `collection.anki21b`).
 *
 * Notetypes, fields, templates, decks, presets and config live in their own
 * tables; per-row settings are protobuf blobs. Field numbers below were read
 * from the protobuf message descriptors embedded in the `anki` Python
 * package (the same library used as the test oracle), not from Anki's source.
 */
import type { Database } from "sql.js";

import { parseJsonExact } from "./json.js";
import type { CardRequirement, CardTemplate, Deck, DeckConfig, Notetype, NotetypeField, Tag } from "./model.js";
import { ProtoMessage, utf8 } from "./protobuf.js";
import type { QueryFn } from "./read.js";
import { num, str } from "./read.js";

export interface SchemaParts {
  config: Record<string, unknown>;
  notetypes: Notetype[];
  decks: Deck[];
  deckConfigs: DeckConfig[];
  tags: Tag[];
}

/** Decode the `other` (field 255) catch-all: JSON of keys Anki doesn't model in protobuf. */
function otherJson(msg: ProtoMessage): Record<string, unknown> {
  const b = msg.bytes(255);
  if (!b || b.length === 0) return {};
  try {
    const v = parseJsonExact(utf8.decode(b));
    return v && typeof v === "object" ? { ...(v as Record<string, unknown>) } : { other: v };
  } catch {
    return { otherBytes: Array.from(b) };
  }
}

/** Keep fields we don't know about, so nothing is silently dropped. */
function unknownFields(msg: ProtoMessage, known: readonly number[], extra: Record<string, unknown>): Record<string, unknown> {
  for (const [field, values] of msg.fields) {
    if (field === 255 || known.includes(field)) continue;
    extra[`proto:${field}`] = values.map((v) => (v.wire === 0 ? v.value.toString() : Array.from(v.bytes)));
  }
  return extra;
}

const REQ_KINDS = ["none", "any", "all"] as const;

// Notetype.Config: 1 kind, 2 sort_field_idx, 3 css, 4 target_deck_id_unused,
// 5 latex_pre, 6 latex_post, 7 latex_svg, 8 reqs, 9 original_stock_kind,
// 10 original_id, 255 other.
const NT_KNOWN = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
// Notetype.Field.Config: 1 sticky, 2 rtl, 3 font_name, 4 font_size,
// 5 description, 6 plain_text, 7 collapsed, 8 exclude_from_search, 9 id,
// 10 tag, 11 prevent_deletion, 255 other.
const FIELD_KNOWN = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;
// Notetype.Template.Config: 1 q_format, 2 a_format, 3 q_format_browser,
// 4 a_format_browser, 5 target_deck_id, 6 browser_font_name,
// 7 browser_font_size, 8 id, 255 other.
const TMPL_KNOWN = [1, 2, 3, 4, 5, 6, 7, 8] as const;

export function readSchema18(db: Database, all: QueryFn): SchemaParts {
  // --- config: key -> JSON bytes ---------------------------------------------
  const config: Record<string, unknown> = {};
  for (const r of all(db, "SELECT key, val FROM config")) {
    const key = str(r[0]);
    const raw = r[1] instanceof Uint8Array ? utf8.decode(r[1]) : str(r[1]);
    try {
      config[key] = parseJsonExact(raw);
    } catch {
      config[key] = raw;
    }
  }

  // --- notetypes -----------------------------------------------------------------
  const fieldsBy = new Map<number, NotetypeField[]>();
  for (const r of all(db, "SELECT ntid, ord, name, config FROM fields ORDER BY ntid, ord")) {
    const c = new ProtoMessage(r[3] as Uint8Array);
    const extra = unknownFields(c, FIELD_KNOWN, otherJson(c));
    const f: NotetypeField = {
      ord: num(r[1]),
      name: str(r[2]),
      sticky: c.bool(1),
      rtl: c.bool(2),
      fontName: c.string(3),
      fontSize: c.uint(4),
      description: c.string(5),
      plainText: c.bool(6),
      collapsed: c.bool(7),
      excludeFromSearch: c.bool(8),
      id: c.int64String(9),
      tag: c.has(10) ? c.uint(10) : null,
      preventDeletion: c.bool(11),
      extra,
    };
    push(fieldsBy, num(r[0]), f);
  }
  const tmplBy = new Map<number, CardTemplate[]>();
  for (const r of all(db, "SELECT ntid, ord, name, mtime_secs, usn, config FROM templates ORDER BY ntid, ord")) {
    const c = new ProtoMessage(r[5] as Uint8Array);
    const extra = unknownFields(c, TMPL_KNOWN, otherJson(c));
    const target = c.int(5);
    const t: CardTemplate = {
      ord: num(r[1]),
      name: str(r[2]),
      qfmt: c.string(1),
      afmt: c.string(2),
      bqfmt: c.string(3),
      bafmt: c.string(4),
      targetDeckId: target === 0 ? null : target,
      browserFontName: c.string(6),
      browserFontSize: c.uint(7),
      id: c.int64String(8),
      mtime: num(r[3]),
      usn: num(r[4]),
      extra,
    };
    push(tmplBy, num(r[0]), t);
  }
  const notetypes: Notetype[] = all(db, "SELECT id, name, mtime_secs, usn, config FROM notetypes ORDER BY id").map((r) => {
    const id = num(r[0]);
    const c = new ProtoMessage(r[4] as Uint8Array);
    const extra = unknownFields(c, NT_KNOWN, otherJson(c));
    const requirements: CardRequirement[] = c.messages(8).map((m) => ({
      cardOrd: m.uint(1),
      kind: REQ_KINDS[m.uint(2)] ?? "none",
      fieldOrds: m.uints(3),
    }));
    return {
      id,
      name: str(r[1]),
      kind: c.uint(1) === 1 ? "cloze" : "normal",
      mtime: num(r[2]),
      usn: num(r[3]),
      sortFieldIndex: c.uint(2),
      css: c.string(3),
      latexPre: c.string(5),
      latexPost: c.string(6),
      latexSvg: c.bool(7),
      requirements,
      originalStockKind: c.uint(9),
      originalId: c.has(10) ? c.int(10) : null,
      fields: fieldsBy.get(id) ?? [],
      templates: tmplBy.get(id) ?? [],
      extra,
    };
  });

  // --- decks -------------------------------------------------------------------------
  // decks.common = Deck.Common: 1 study_collapsed, 2 browser_collapsed,
  //   3 last_day_studied, 4 new_studied, 5 review_studied, 6 learning_studied,
  //   7 milliseconds_studied, 255 other.
  // decks.kind = Deck.KindContainer: 1 normal, 2 filtered.
  //   Normal: 1 config_id, 2 extend_new, 3 extend_review, 4 description,
  //     5 markdown_description, 6 review_limit?, 7 new_limit?,
  //     8 review_limit_today {1 limit, 2 today}, 9 new_limit_today,
  //     10 desired_retention?
  //   Filtered: 1 reschedule, 2 search_terms {1 search, 2 limit, 3 order},
  //     3 delays, 4 preview_delay (legacy), 5 preview_hard_secs,
  //     6 preview_good_secs, 7 preview_again_secs.
  const decks: Deck[] = all(db, "SELECT id, name, mtime_secs, usn, common, kind FROM decks ORDER BY id").map((r) => {
    const common = new ProtoMessage(r[4] as Uint8Array);
    const kindC = new ProtoMessage(r[5] as Uint8Array);
    const extra = unknownFields(common, [1, 2, 3, 4, 5, 6, 7], otherJson(common));
    const normal = kindC.message(1);
    const filtered = kindC.message(2);
    const path = str(r[1]).split("\x1f");
    const dayLimit = (m: ProtoMessage | null) => (m ? { limit: m.uint(1), today: m.uint(2) } : null);
    const deck: Deck = {
      id: num(r[0]),
      name: path.join("::"),
      path,
      parentId: null,
      mtime: num(r[2]),
      usn: num(r[3]),
      kind: filtered ? "filtered" : "normal",
      description: normal?.string(4) ?? "",
      markdownDescription: normal?.bool(5) ?? false,
      collapsed: common.bool(1),
      browserCollapsed: common.bool(2),
      configId: normal ? normal.int(1) : null,
      reviewLimit: normal?.has(6) ? normal.uint(6) : null,
      newLimit: normal?.has(7) ? normal.uint(7) : null,
      reviewLimitToday: dayLimit(normal?.message(8) ?? null),
      newLimitToday: dayLimit(normal?.message(9) ?? null),
      desiredRetention: normal?.has(10) ? round6(normal.float(10)) : null,
      extendNew: normal?.uint(2) ?? 0,
      extendReview: normal?.uint(3) ?? 0,
      filtered: filtered
        ? {
            reschedule: filtered.bool(1),
            searchTerms: filtered.messages(2).map((t) => ({ search: t.string(1), limit: t.uint(2), order: t.uint(3) })),
            delays: filtered.floats(3),
            previewAgainSecs: filtered.uint(7),
            previewHardSecs: filtered.uint(5),
            previewGoodSecs: filtered.uint(6),
          }
        : null,
      stats: {
        lastDayStudied: common.uint(3),
        newStudied: common.int(4),
        reviewStudied: common.int(5),
        learningStudied: common.int(6),
        millisecondsStudied: common.int(7),
      },
      extra,
    };
    if (normal) unknownFields(normal, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], deck.extra);
    if (filtered) {
      unknownFields(filtered, [1, 2, 3, 4, 5, 6, 7], deck.extra);
      if (filtered.has(4)) deck.extra["previewDelay"] = filtered.uint(4);
    }
    return deck;
  });
  linkParents(decks);

  // --- deck config ------------------------------------------------------------------
  const deckConfigs: DeckConfig[] = all(db, "SELECT id, name, mtime_secs, usn, config FROM deck_config ORDER BY id").map((r) => {
    const c = new ProtoMessage(r[4] as Uint8Array);
    const known = [1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 40, 41, 42, 43, 44, 45, 46];
    return {
      id: num(r[0]),
      name: str(r[1]),
      mtime: num(r[2]),
      usn: num(r[3]),
      learnSteps: c.floats(1).map(round6),
      relearnSteps: c.floats(2).map(round6),
      newPerDay: c.uint(9),
      reviewsPerDay: c.uint(10),
      newPerDayMinimum: c.uint(35),
      initialEase: round6(c.float(11)),
      easyMultiplier: round6(c.float(12)),
      hardMultiplier: round6(c.float(13)),
      lapseMultiplier: round6(c.float(14)),
      intervalMultiplier: round6(c.float(15)),
      maximumReviewInterval: c.uint(16),
      minimumLapseInterval: c.uint(17),
      graduatingIntervalGood: c.uint(18),
      graduatingIntervalEasy: c.uint(19),
      newCardInsertOrder: c.uint(20),
      newCardGatherPriority: c.uint(34),
      newCardSortOrder: c.uint(32),
      newMix: c.uint(30),
      reviewOrder: c.uint(33),
      interdayLearningMix: c.uint(31),
      leechAction: c.uint(21),
      leechThreshold: c.uint(22),
      disableAutoplay: c.bool(23),
      capAnswerTimeToSecs: c.uint(24),
      showTimer: c.bool(25),
      stopTimerOnAnswer: c.bool(38),
      secondsToShowQuestion: round6(c.float(41)),
      secondsToShowAnswer: round6(c.float(42)),
      questionAction: c.uint(36),
      answerAction: c.uint(43),
      waitForAudio: c.bool(44),
      skipQuestionWhenReplayingAnswer: c.bool(26),
      buryNew: c.bool(27),
      buryReviews: c.bool(28),
      buryInterdayLearning: c.bool(29),
      fsrsParams4: c.floats(3).map(round6),
      fsrsParams5: c.floats(5).map(round6),
      fsrsParams6: c.floats(6).map(round6),
      desiredRetention: round6(c.float(37)),
      historicalRetention: round6(c.float(40)),
      ignoreRevlogsBeforeDate: c.string(46),
      easyDaysPercentages: c.floats(4).map(round6),
      paramSearch: c.string(45),
      extra: unknownFields(c, known, otherJson(c)),
    };
  });

  // --- tag registry ---------------------------------------------------------------------
  const tags: Tag[] = all(db, "SELECT tag, usn, collapsed FROM tags").map((r) => ({
    name: str(r[0]),
    usn: num(r[1]),
    collapsed: !!num(r[2]),
  }));

  return { config, notetypes, decks, deckConfigs, tags };
}

export function linkParents(decks: Deck[]): void {
  const byName = new Map(decks.map((d) => [d.name.toLowerCase(), d.id]));
  for (const d of decks) {
    if (d.path.length > 1) d.parentId = byName.get(d.path.slice(0, -1).join("::").toLowerCase()) ?? null;
  }
}

/**
 * Protobuf floats are f32; round to 6 significant decimals so 0.9f32
 * reads as 0.9 rather than 0.8999999761581421.
 */
export function round6(x: number): number {
  return Number(x.toPrecision(7));
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const l = m.get(k);
  if (l) l.push(v);
  else m.set(k, [v]);
}
