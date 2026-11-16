/**
 * Typed in-memory model of an Anki package.
 *
 * The model is format-neutral: schema 11 (JSON in the `col` row) and
 * schema 18 (separate tables with protobuf blobs) both map onto it.
 * Field names follow Anki's concepts but use plain English names; raw Anki
 * column names are noted in comments where they differ.
 *
 * "No content lost": every value Anki stores is either mapped to a typed
 * field or kept in an `extra` bag (unknown JSON keys / unknown protobuf
 * fields), so a later exporter can round-trip it.
 */

/** Which container/collection layout the package used. */
export interface PackageFormat {
  /**
   * Version from the `meta` protobuf: 1 = legacy 1 (`collection.anki2`),
   * 2 = legacy 2 (`collection.anki21`), 3 = latest (`collection.anki21b`,
   * zstd). `null` when the package has no `meta` entry (pre-2.1.50 packages).
   */
  metaVersion: number | null;
  /** The zip entry the collection was read from. */
  collectionEntry: "collection.anki21b" | "collection.anki21" | "collection.anki2";
  /** Collection schema version (`col.ver`): 11 for legacy exports, 18 for current ones. */
  schemaVersion: number;
  /** Whether the collection database was zstd-compressed inside the zip. */
  zstdCollection: boolean;
  /** Media manifest encoding. */
  mediaManifest: "json" | "protobuf" | "none";
}

export interface Collection {
  /** Collection creation time, unix seconds. Review-card due days count from the day containing this time. */
  crt: number;
  /** Last modified, ms. */
  mod: number;
  /** Schema modified, ms. */
  scm: number;
  usn: number;
  /** Last sync, ms. */
  ls: number;
  /** Collection config (`col.conf` JSON in schema 11; `config` table in schema 18). Values are parsed JSON. */
  config: Record<string, unknown>;
}

export type NotetypeKind = "normal" | "cloze";

export interface NotetypeField {
  ord: number;
  name: string;
  sticky: boolean;
  rtl: boolean;
  fontName: string;
  fontSize: number;
  description: string;
  plainText: boolean;
  collapsed: boolean;
  excludeFromSearch: boolean;
  /** Random 64-bit id (decimal string: it does not fit in a JS number). */
  id: string | null;
  /** Stock-notetype field tag (e.g. image occlusion fields). */
  tag: number | null;
  preventDeletion: boolean;
  extra: Record<string, unknown>;
}

export interface CardTemplate {
  ord: number;
  name: string;
  /** Question format. */
  qfmt: string;
  /** Answer format. */
  afmt: string;
  /** Browser question/answer formats (usually empty). */
  bqfmt: string;
  bafmt: string;
  /** Deck override for cards generated from this template (0 / null = none). */
  targetDeckId: number | null;
  browserFontName: string;
  browserFontSize: number;
  /** Random 64-bit id (decimal string). */
  id: string | null;
  mtime: number;
  usn: number;
  extra: Record<string, unknown>;
}

export interface CardRequirement {
  cardOrd: number;
  kind: "none" | "any" | "all";
  fieldOrds: number[];
}

export interface Notetype {
  id: number;
  name: string;
  kind: NotetypeKind;
  mtime: number;
  usn: number;
  /** Index of the sort field. */
  sortFieldIndex: number;
  css: string;
  latexPre: string;
  latexPost: string;
  latexSvg: boolean;
  /** Legacy card-generation requirements (informational; modern Anki derives them from templates). */
  requirements: CardRequirement[];
  /** Stock notetype this was created from (0 = custom, 1 basic … 5 cloze, 6 image occlusion). */
  originalStockKind: number;
  originalId: number | null;
  fields: NotetypeField[];
  templates: CardTemplate[];
  extra: Record<string, unknown>;
}

export interface Note {
  id: number;
  guid: string;
  notetypeId: number;
  mtime: number;
  usn: number;
  tags: string[];
  /** Raw field HTML, in notetype field order. */
  fields: string[];
  /** Sort field value as stored (`sfld`; may be a number). */
  sortField: string | number;
  /** First 8 hex digits of SHA-1 of the first field (as stored). */
  checksum: number;
  flags: number;
  data: string;
}

export const CardType = { New: 0, Learning: 1, Review: 2, Relearning: 3 } as const;
export type CardType = (typeof CardType)[keyof typeof CardType];

export const CardQueue = {
  ManuallyBuried: -3,
  SiblingBuried: -2,
  Suspended: -1,
  New: 0,
  Learning: 1,
  Review: 2,
  DayLearning: 3,
  Preview: 4,
} as const;
export type CardQueue = (typeof CardQueue)[keyof typeof CardQueue];

export interface FsrsMemoryState {
  stability: number;
  difficulty: number;
}

/** Parsed `cards.data` JSON. */
export interface CardData {
  /** Original new-card position (`pos`). */
  originalPosition: number | null;
  /** FSRS memory state (`s`, `d`), if FSRS has seen this card. */
  memoryState: FsrsMemoryState | null;
  /** Desired retention in effect when last answered (`dr`). */
  desiredRetention: number | null;
  /** FSRS forgetting-curve decay in effect (`decay`). FSRS-6: -w20 is used as exponent, stored here as w20. */
  decay: number | null;
  /** Last review time, unix seconds (`lrt`). */
  lastReviewTime: number | null;
  /** User custom data from the card-state customizer (`cd`). */
  customData: string | null;
  extra: Record<string, unknown>;
}

export interface Card {
  id: number;
  noteId: number;
  deckId: number;
  ord: number;
  mtime: number;
  usn: number;
  type: CardType;
  queue: CardQueue;
  /**
   * Meaning depends on queue: new = position; learning (1) / preview (4) =
   * unix seconds; review (2) / day-learning (3) = day number counted from
   * the collection's creation day (`Collection.crt`). See `cardDue()`.
   */
  due: number;
  /** Interval in days (review cards). */
  interval: number;
  /** SM-2 ease factor in permille (2500 = 250%). 0 for new cards. */
  easeFactor: number;
  reps: number;
  lapses: number;
  /** Remaining learning steps (encoded by Anki as today*1000 + remaining in old versions; modern: remaining steps). */
  left: number;
  /** Original due, when in a filtered deck. */
  originalDue: number;
  /** Original deck, when in a filtered deck (0 otherwise). */
  originalDeckId: number;
  /** Bits 0-2 = user flag (1 red … 7 purple). */
  flags: number;
  data: CardData;
  /** The raw `data` column text. */
  rawData: string;
}

export interface FilteredSearchTerm {
  search: string;
  limit: number;
  order: number;
}

export interface Deck {
  id: number;
  /** Full name with "::" separators. */
  name: string;
  /** Name components (split on "::"). */
  path: string[];
  /** Parent deck id, if the parent exists in the package. */
  parentId: number | null;
  mtime: number;
  usn: number;
  kind: "normal" | "filtered";
  description: string;
  markdownDescription: boolean;
  collapsed: boolean;
  browserCollapsed: boolean;
  /** Normal decks: preset id (`conf`). */
  configId: number | null;
  /** Per-deck review/new limit overrides. */
  reviewLimit: number | null;
  newLimit: number | null;
  reviewLimitToday: { limit: number; today: number } | null;
  newLimitToday: { limit: number; today: number } | null;
  /** Per-deck FSRS desired retention override, 0–1 (schema 11 stores it as a percentage; normalised here). */
  desiredRetention: number | null;
  extendNew: number;
  extendReview: number;
  /** Filtered decks only. */
  filtered: {
    reschedule: boolean;
    searchTerms: FilteredSearchTerm[];
    /** Legacy learning delays for filtered decks without rescheduling. */
    delays: number[];
    previewAgainSecs: number;
    previewHardSecs: number;
    previewGoodSecs: number;
  } | null;
  /** Daily counters (`lastDayStudied`, etc.). */
  stats: {
    lastDayStudied: number;
    newStudied: number;
    reviewStudied: number;
    learningStudied: number;
    millisecondsStudied: number;
  };
  extra: Record<string, unknown>;
}

/** A deck options preset (`dconf` / `deck_config`). */
export interface DeckConfig {
  id: number;
  name: string;
  mtime: number;
  usn: number;
  /** Learning steps in minutes. */
  learnSteps: number[];
  relearnSteps: number[];
  newPerDay: number;
  reviewsPerDay: number;
  newPerDayMinimum: number;
  /** Initial ease as a ratio (2.5 = 250%). */
  initialEase: number;
  easyMultiplier: number;
  hardMultiplier: number;
  lapseMultiplier: number;
  intervalMultiplier: number;
  maximumReviewInterval: number;
  minimumLapseInterval: number;
  graduatingIntervalGood: number;
  graduatingIntervalEasy: number;
  newCardInsertOrder: number;
  newCardGatherPriority: number;
  newCardSortOrder: number;
  newMix: number;
  reviewOrder: number;
  interdayLearningMix: number;
  leechAction: number;
  leechThreshold: number;
  disableAutoplay: boolean;
  capAnswerTimeToSecs: number;
  showTimer: boolean;
  stopTimerOnAnswer: boolean;
  secondsToShowQuestion: number;
  secondsToShowAnswer: number;
  questionAction: number;
  answerAction: number;
  waitForAudio: boolean;
  skipQuestionWhenReplayingAnswer: boolean;
  buryNew: boolean;
  buryReviews: boolean;
  buryInterdayLearning: boolean;
  /** FSRS parameter sets. Anki uses the newest non-empty one. */
  fsrsParams4: number[];
  fsrsParams5: number[];
  fsrsParams6: number[];
  desiredRetention: number;
  historicalRetention: number;
  ignoreRevlogsBeforeDate: string;
  easyDaysPercentages: number[];
  paramSearch: string;
  extra: Record<string, unknown>;
}

export const RevlogKind = {
  Learning: 0,
  Review: 1,
  Relearning: 2,
  /** Review in a filtered deck (historically "cram"). */
  Filtered: 3,
  /** Manual change: set due date, reset, etc. ease is 0. */
  Manual: 4,
  /** Rescheduled by FSRS ("reschedule cards on change"). */
  Rescheduled: 5,
} as const;
export type RevlogKind = (typeof RevlogKind)[keyof typeof RevlogKind];

export interface RevlogEntry {
  /** Review time, unix ms (doubles as the primary key). */
  id: number;
  cardId: number;
  usn: number;
  /** Button pressed: 1 again, 2 hard, 3 good, 4 easy; 0 for manual entries. */
  ease: number;
  /** New interval: positive = days, negative = seconds. */
  interval: number;
  lastInterval: number;
  /**
   * SM-2: ease factor in permille. With FSRS on, Anki stores the post-review
   * difficulty here as round(100 + 1000 × (D − 1) / 9), i.e. 100–1100
   * (observed on the fixtures, not documented).
   */
  factor: number;
  /** Time taken, ms. */
  taken: number;
  kind: RevlogKind;
}

export interface MediaFile {
  /** Filename as referenced from note fields (NFC as stored by Anki). */
  name: string;
  data: Uint8Array;
  /** SHA-1 from the manifest (latest format only), lowercase hex. */
  sha1: string | null;
}

export interface Tag {
  name: string;
  usn: number | null;
  collapsed: boolean;
}

export interface AnkiPackage {
  format: PackageFormat;
  collection: Collection;
  notetypes: Notetype[];
  notes: Note[];
  cards: Card[];
  decks: Deck[];
  deckConfigs: DeckConfig[];
  revlog: RevlogEntry[];
  media: MediaFile[];
  /** Tag registry merged with every tag used on a note, sorted. */
  tags: Tag[];
  /** Non-fatal oddities found while reading (missing media, unknown versions…). */
  warnings: string[];
}
