/**
 * Public types of @wengu/core: the contract between the data core (running in a worker) and the app.
 *
 * Conventions:
 *  - Ids are JS numbers. Imported Anki ids are kept (millisecond timestamps, < 2^53).
 *  - Times are unix milliseconds unless the name says otherwise (`…Secs`, `day`).
 *  - A "day" is a scheduler day number: whole days since the collection's creation day, with days starting at
 *    the rollover hour (default 4:00 local time), as in Anki.
 *  - Everything here is structured-clone safe (crosses the worker boundary as is).
 */
import type { AnkiPackage, AvTag } from "@wengu/anki";

export type Id = number;

// ------------------------------------------------------------------------------------------------
// Data model
// ------------------------------------------------------------------------------------------------

/** Memory state of a review item under FSRS. */
export interface MemoryState {
  /** Days until recall probability falls to 90%. */
  stability: number;
  /** 1 (easy) – 10 (hard). */
  difficulty: number;
}

/** Learning state of a review item (Anki's card type). */
export type ItemState = "new" | "learning" | "review" | "relearning";
/** Whether the item is in the study queues. Buried items come back at the next day rollover. */
export type ItemStatus = "active" | "suspended" | "buried";

export type ItemDue =
  | { kind: "new"; position: number }
  /** Intraday (re)learning step: due at a time. */
  | { kind: "time"; at: number }
  /** Review or interday learning: due on a scheduler day; `at` is when that day starts. */
  | { kind: "day"; day: number; at: number };

/** One thing to recall (an Anki card), with its own memory state and schedule. */
export interface ReviewItem {
  id: Id;
  knowledgePointId: Id;
  deckId: Id;
  /** Original deck when the item sits in a filtered deck (imported from Anki), else null. */
  homeDeckId: Id | null;
  /** Template ordinal (normal note types) or cloze number − 1 (cloze). */
  ord: number;
  state: ItemState;
  status: ItemStatus;
  due: ItemDue;
  /** Current interval in days (review/relearning items), 0 otherwise. */
  intervalDays: number;
  reps: number;
  lapses: number;
  /** 0 none, 1 red, 2 orange, 3 green, 4 blue, 5 pink, 6 turquoise, 7 purple. */
  flag: number;
  memory: MemoryState | null;
  /** Last answer, ms (null if never answered). */
  lastReviewAt: number | null;
  modifiedAt: number;
}

export interface NoteTypeField {
  ord: number;
  name: string;
  /** Right-to-left text. */
  rtl: boolean;
  fontName: string;
  fontSize: number;
  description: string;
  plainText: boolean;
  /** Collapsed by default in the editor. */
  collapsed: boolean;
  sticky: boolean;
}

export interface NoteTypeTemplate {
  ord: number;
  name: string;
  questionFormat: string;
  answerFormat: string;
}

export interface NoteType {
  id: Id;
  name: string;
  kind: "normal" | "cloze";
  fields: NoteTypeField[];
  templates: NoteTypeTemplate[];
  css: string;
  sortFieldIndex: number;
  modifiedAt: number;
}

/** What is to be learned (an Anki note). */
export interface KnowledgePoint {
  id: Id;
  guid: string;
  noteTypeId: Id;
  /** Raw field HTML in note-type field order. */
  fields: string[];
  tags: string[];
  createdAt: number;
  modifiedAt: number;
}

export interface KnowledgePointDetail extends KnowledgePoint {
  noteType: NoteType;
  /** Field names alongside values, for editors. */
  fieldNames: string[];
  items: ReviewItem[];
  /** Deck of each item, by deck id. */
  deckNames: Record<Id, string>;
}

/**
 * A way of showing a review item. Regular cards use `anki-template`; enhanced visual cards add
 * `visual-component` rows stored in the `presentations` table alongside the underlying Anki note.
 */
export type Presentation = AnkiTemplatePresentation | VisualPresentation | UnknownPresentation;

export type VisualLibraryId = "three" | "d3" | "katex";

export interface VisualSourceReference {
  title: string;
  url?: string;
  locator?: string;
}

export interface VisualManifest {
  id: string;
  title: string;
  apiVersion: 1;
  libraries: VisualLibraryId[];
  knowledgePoints: string[];
  sources: VisualSourceReference[];
  modes: ("learn" | "review")[];
}

/** An interactive 2D/3D visual component presentation attached to a knowledge point or specific review item. */
export interface VisualPresentation {
  kind: "visual-component";
  id: Id;
  kpId: Id;
  reviewItemId: Id | null;
  kindVersion: number;
  manifest: VisualManifest;
  source: string;
  props: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface SetVisualPresentationInput {
  kpId: Id;
  reviewItemId?: Id | null;
  manifest: VisualManifest;
  source: string;
  props?: Record<string, unknown>;
}

export interface SetVisualPresentationResult {
  id: Id;
  replaced: boolean;
  undoStepId: number | null;
}

export interface RemoveVisualPresentationInput {
  id?: Id;
  kpId?: Id;
  reviewItemId?: Id | null;
}

/** An Anki card template rendered for the item (question/answer HTML from the note type). */
export interface AnkiTemplatePresentation {
  kind: "anki-template";
  /** Template name ("Card 1", "Cloze"...). */
  templateName: string;
  /** Question / answer HTML as Anki's library produces it before the reviewer post-processes it:
   *  `{{type:…}}` stays as `[[type:…]]`, sounds/TTS become `[anki:play:q:N]` / `[anki:play:a:N]` markers. */
  question: string;
  answer: string;
  questionAvTags: AvTag[];
  answerAvTags: AvTag[];
  /** Note type CSS. The template's HTML expects to be inside an element with class "card". */
  css: string;
  /** Media file names referenced by the question/answer/CSS (images, sounds, fonts). Resolve with `getMedia`. */
  media: string[];
  /** Template problems (unknown fields, missing cloze, …). Rendering continued past them. */
  errors: string[];
}

/** A stored presentation of a kind this version of Wengu does not know (created by a newer version). Skip it. */
export interface UnknownPresentation {
  kind: "unknown";
  storedKind: string;
  id: Id;
}

// ------------------------------------------------------------------------------------------------
// Decks
// ------------------------------------------------------------------------------------------------

export interface QueueCounts {
  new: number;
  /** Learning/relearning items due now (intraday) or today (interday). */
  learning: number;
  review: number;
}

export interface DeckNode {
  id: Id;
  /** Full name, components separated by "::". */
  name: string;
  /** Last component. */
  shortName: string;
  parentId: Id | null;
  kind: "normal" | "filtered";
  presetId: Id | null;
  collapsed: boolean;
  /** Due today, including subdecks, after daily limits (like Anki's deck list). */
  counts: QueueCounts;
  /** All review items in this deck and its subdecks. */
  totalItems: number;
  children: DeckNode[];
}

/** Changes to a deck options preset; omitted fields stay as they are. */
export interface PresetChanges {
  name?: string;
  /** New items per day, 0–9999. */
  newPerDay?: number;
  /** Reviews per day, 0–9999. */
  reviewsPerDay?: number;
  /** Learning steps in minutes (each > 0, at most 20 steps); [] graduates new items on the first answer. */
  learnStepsMinutes?: number[];
  /** Relearning steps after a lapse, minutes. */
  relearnStepsMinutes?: number[];
  /** FSRS desired retention, 0.70–0.99. */
  desiredRetention?: number;
  /** Maximum interval, days, 1–36500. */
  maximumIntervalDays?: number;
}

export interface DeleteDeckResult {
  /** The deck and its sub-decks. */
  decks: number;
  /** Review items that were in them (deleted). */
  reviewItems: number;
  /** Knowledge points deleted because they had no review item left. */
  knowledgePoints: number;
}

export interface DeckPreset {
  id: Id;
  name: string;
  newPerDay: number;
  reviewsPerDay: number;
  learnStepsMinutes: number[];
  relearnStepsMinutes: number[];
  maximumIntervalDays: number;
  desiredRetention: number;
  /** FSRS parameters in use (FSRS-6 defaults when the preset has none). */
  fsrsParams: number[];
  /** FSRS generation of `fsrsParams` as stored (4, 5 or 6). */
  fsrsVersion: 4 | 5 | 6;
  /** Number of decks using this preset. */
  deckCount: number;
}

// ------------------------------------------------------------------------------------------------
// Review
// ------------------------------------------------------------------------------------------------

export type Rating = 1 | 2 | 3 | 4;
export const Rating = { Again: 1, Hard: 2, Good: 3, Easy: 4 } as const;
export type RatingName = "again" | "hard" | "good" | "easy";

export interface RatingOutcome {
  rating: Rating;
  /** State the item would be in after this rating. */
  state: Exclude<ItemState, "new">;
  /** Next interval: seconds for (re)learning steps, days for reviews. */
  interval: { unit: "seconds" | "days"; value: number };
  /** When the item would be due next, ms (for days: start of that scheduler day). */
  dueAt: number;
  /** Short label for the answer button: "1m", "10m", "1d", "3.5mo", "1.2y". */
  label: string;
  /** Memory state after this rating. */
  memory: MemoryState;
}

/** Why the next intervals are what they are (shown on answer buttons / an info panel). */
export interface ScheduleExplanation {
  /** Current memory state (null for a new item). */
  memory: MemoryState | null;
  /** Probability of recall right now (null for a new item). */
  retrievability: number | null;
  /** Whole days since the last review, as fed to FSRS. */
  elapsedDays: number;
  desiredRetention: number;
  presetId: Id | null;
  presetName: string;
  /** FSRS parameters used. */
  fsrsParams: number[];
  /** Outcome for each rating. */
  outcomes: Record<RatingName, RatingOutcome>;
}

/** Everything the reviewer needs to show one item. */
export interface ReviewCard {
  item: ReviewItem;
  knowledgePoint: KnowledgePoint;
  noteTypeName: string;
  deckName: string;
  /** The presentation to show (M1: always the Anki template). */
  presentation: Presentation;
  /** All presentations available for the item, `presentation` first. */
  presentations: Presentation[];
  schedule: ScheduleExplanation;
}

export interface StudyState {
  /** Deck being studied (null = whole collection). */
  deckId: Id | null;
  /** Remaining today in the studied deck, including the current card. */
  counts: QueueCounts;
  /** Next card, or null when nothing is due now. */
  card: ReviewCard | null;
  /** When nothing is due now but learning steps are pending today: when the next one is due (ms). */
  nextLearningDueAt: number | null;
  /**
   * The card to show after `card`, computed now so the UI can render it in advance: the next item in the queue
   * once `card` has been answered (with `card` excluded and its deck's daily allowance reduced by one).
   * It is a prediction; the authoritative next card is `answer()`'s returned `card`. It differs when:
   *  - the answer puts `card` itself back first: a (re)learning step that is due within the learn-ahead window
   *    (default 20 min) while nothing else is due, e.g. Again on the last item;
   *  - time passes: a learning step of another item falls due before the answer arrives (it then comes first);
   *  - the answer buries `upNext` (a sibling, when the preset buries siblings) or suspends a leech;
   *  - the day rolls over, or other calls (edit, suspend, import, undo) change the queue in between.
   * Compare `upNext.item.id` with the returned `card.item.id` and fall back to the returned card on a miss.
   * Its `schedule` is computed at prediction time; take button labels from the returned card when they matter.
   */
  upNext: ReviewCard | null;
  /** Label of the operation `undo()` would revert, if any (English, for display). */
  undoLabel: string | null;
  /** Stable code of that operation (translate this, not the label). */
  undoCode: UndoCode | null;
  /** Current scheduler day. */
  today: number;
}

export interface AnswerInput {
  itemId: Id;
  rating: Rating;
  /** Time spent on the card (ms); stored in the review log, capped by the preset. */
  takenMs: number;
  /** Deck being studied, for the returned next card (null/omitted = whole collection). */
  deckId?: Id | null;
}

export type UndoCode =
  | "answer-again"
  | "answer-hard"
  | "answer-good"
  | "answer-easy"
  | "suspend"
  | "unsuspend"
  | "bury"
  | "unbury"
  | "flag"
  | "move"
  | "add"
  | "edit"
  | "delete"
  | "delete-deck"
  | "set-visual"
  | "remove-visual"
  /** Not produced by this version; future operations. */
  | "other";

export interface UndoResult {
  label: string;
  code: UndoCode;
  /** Review item(s) restored; for an undone answer, the item to show again. */
  itemIds: Id[];
  /**
   * Study state after the undo, for `options.deckId` (default: whole collection). After undoing an answer its
   * `card` is the undone item (it stays first until it is answered again), as in Anki.
   */
  state: StudyState;
}

// ------------------------------------------------------------------------------------------------
// Browse / edit
// ------------------------------------------------------------------------------------------------

export type ItemFilter = "new" | "learning" | "review" | "due" | "suspended" | "buried" | "flagged";

export interface BrowseQuery {
  /** Words that must all appear in the field text (case-insensitive substring; HTML ignored). */
  text?: string;
  deckId?: Id;
  /** Include subdecks of `deckId` (default true). */
  includeSubdecks?: boolean;
  /** Tags that must all be present; a tag also matches its children ("a" matches "a::b"). */
  tags?: string[];
  noteTypeId?: Id;
  /** At least one review item of the knowledge point matches. */
  state?: ItemFilter;
  sort?: { by: "created" | "modified" | "sortField"; direction?: "asc" | "desc" };
  offset?: number;
  /** Default 50, max 1000. */
  limit?: number;
}

export interface BrowseRow {
  id: Id;
  noteTypeId: Id;
  noteTypeName: string;
  /** Sort field as plain text (HTML stripped), truncated to 200 characters. */
  sortField: string;
  tags: string[];
  deckIds: Id[];
  itemCount: number;
  /** Item states present on this knowledge point. */
  states: ItemState[];
  suspended: boolean;
  createdAt: number;
  modifiedAt: number;
}

export interface SearchOptions {
  /**
   * Time budget for the query in the worker (default 3000 ms). A query still running after it is stopped and the
   * call rejects with a WenguError named "QueryTimeout"; the worker is free again at once.
   */
  timeoutMs?: number;
  /**
   * Client only: abort a search that is no longer wanted (e.g. the user typed on). If it has not started yet the
   * worker skips it; the call rejects with a WenguError named "AbortError". A search that is already running
   * cannot be stopped from outside (the worker is busy in it); `timeoutMs` bounds that case.
   */
  signal?: AbortSignal;
}

export interface BrowsePage {
  total: number;
  offset: number;
  limit: number;
  rows: BrowseRow[];
}

export interface WeakNotesQuery {
  deckId?: Id;
  includeSubdecks?: boolean;
  minLapses?: number;
  minDifficulty?: number;
  hasVisual?: boolean;
  limit?: number;
}

export interface WeakNoteRow {
  id: Id;
  noteTypeName: string;
  first: string;
  tags: string[];
  deckNames: string[];
  maxLapses: number;
  totalReps: number;
  maxDifficulty: number | null;
  minStability: number | null;
  hasVisual: boolean;
  isLeech: boolean;
}

export interface AddKnowledgePointInput {
  noteTypeId: Id;
  deckId: Id;
  /** Field HTML in note-type field order (missing fields are empty). */
  fields: string[];
  tags?: string[];
}

export interface UpdateKnowledgePointInput {
  id: Id;
  /** Replacement field values in note-type field order (omit to keep). */
  fields?: string[];
  /** Replacement tag list (omit to keep). */
  tags?: string[];
}

export interface AddResult {
  id: Id;
  /** Review items created (one per non-empty template / cloze number). */
  itemIds: Id[];
}

export interface UpdateResult {
  /** Review items created because the edit added a template's content or a cloze number. */
  addedItemIds: Id[];
}

// ------------------------------------------------------------------------------------------------
// Import / export
// ------------------------------------------------------------------------------------------------

export type ImportPhase = "reading" | "note-types" | "decks" | "knowledge-points" | "review-items" | "review-log" | "media" | "finishing";

export interface ImportProgress {
  phase: ImportPhase;
  done: number;
  total: number;
}

export interface ImportOptions {
  /** Called with progress (throttled to roughly every 100 ms per phase). */
  onProgress?: (p: ImportProgress) => void;
}

export interface ImportResult {
  noteTypes: { added: number; reused: number };
  decks: { added: number; reused: number };
  presets: { added: number; reused: number };
  knowledgePoints: { added: number; updated: number; unchanged: number };
  reviewItems: { added: number; kept: number };
  reviewLog: { added: number; duplicates: number };
  media: { added: number; unchanged: number; renamed: number };
  warnings: string[];
  durationMs: number;
}

export interface ExportOptions {
  /** Export this deck and its subdecks only (default: whole collection). */
  deckId?: Id;
  /** Include review items' schedules and the review log (default true). Without: like Anki's "shared deck" export. */
  includeScheduling?: boolean;
  /** Include media files referenced by exported knowledge points (whole collection: all media). Default true. */
  includeMedia?: boolean;
}

export type { AnkiPackage };

// ------------------------------------------------------------------------------------------------
// Statistics
// ------------------------------------------------------------------------------------------------

export interface Stats {
  today: {
    reviews: number;
    /** Distinct new items studied for the first time today. */
    newItems: number;
    /** Answers by rating (index 0 = Again … 3 = Easy). */
    byRating: [number, number, number, number];
    timeMs: number;
  };
  /** Share of passed reviews (Hard/Good/Easy) on review-state items. */
  retention: {
    last7Days: RetentionSample;
    last30Days: RetentionSample;
    /** Items with interval ≥ 21 days at the time of review. */
    mature30Days: RetentionSample;
  };
  /** Review items due per day from today: index 0 = today (incl. overdue), up to `days` entries. */
  upcoming: number[];
  overdue: number;
  totals: { new: number; learning: number; review: number; suspended: number; buried: number; knowledgePoints: number };
}

export interface RetentionSample {
  passed: number;
  failed: number;
  /** passed / (passed + failed), null when there were no reviews. */
  rate: number | null;
}

// ------------------------------------------------------------------------------------------------
// Collection
// ------------------------------------------------------------------------------------------------

export interface CollectionInfo {
  schemaVersion: number;
  sqliteVersion: string;
  /** Storage backend in use. */
  storage: "opfs-sahpool" | "memory";
  /** Collection creation time, unix seconds (Anki's crt). */
  crtSecs: number;
  today: number;
  /** When the current scheduler day ends, ms. */
  nextDayAt: number;
  rolloverHour: number;
  counts: { knowledgePoints: number; reviewItems: number; reviewLog: number; media: number; decks: number };
}

export interface MediaInfo {
  name: string;
  size: number;
  /** SHA-256 of the content (the storage address). */
  hash: string;
}

// ------------------------------------------------------------------------------------------------
// The API
// ------------------------------------------------------------------------------------------------

/**
 * Operations of a Wengu collection. The engine implements these synchronously or asynchronously;
 * the client (`WenguClient`) exposes every method as async.
 */
export interface WenguApi {
  info(): CollectionInfo;

  // decks & presets
  deckTree(): DeckNode[];
  createDeck(name: string): Id;
  renameDeck(id: Id, newName: string): void;
  listPresets(): DeckPreset[];
  getPreset(id: Id): DeckPreset | null;
  /**
   * Deletes a deck with its sub-decks and every review item in them; knowledge points left without items are
   * deleted too; review history is kept (Anki's behaviour). Items of a deleted filtered deck go back to their home
   * deck instead. The Default deck (id 1) cannot be deleted. Undoable (code "delete-deck").
   */
  deleteDeck(id: Id): DeleteDeckResult;
  /** Updates a preset (applies to every deck using it; see `DeckPreset.deckCount`). Not undoable. */
  updatePreset(id: Id, changes: PresetChanges): DeckPreset;
  /** Creates a preset, copying another one's settings (default: preset 1 / Anki's defaults). */
  createPreset(name: string, copyFrom?: Id): Id;
  /** Makes a deck use a preset. Not undoable. */
  setDeckPreset(deckId: Id, presetId: Id): void;
  listNoteTypes(): NoteType[];
  /** Adds one of Anki's stock note types (e.g. for a fresh collection with none) and returns its id. */
  createStockNoteType(kind: "basic" | "basic-reversed" | "cloze"): Id;
  listTags(): string[];

  // review
  /** Current study state of a deck (null = whole collection): counts and the next card. */
  study(deckId?: Id | null): StudyState;
  /** Answers a card and returns the next one in the same round trip. */
  answer(input: AnswerInput): StudyState;
  /** Explanation and per-rating outcomes for any item, without answering. */
  explain(itemId: Id): ScheduleExplanation;
  /** Reverts the last undoable operation (answer, suspend, bury, edit, delete). */
  undo(options?: { deckId?: Id | null; expectedStepId?: number }): UndoResult | null;
  undoLabel(): string | null;
  /** The operation `undo()` would revert (label and stable code), or null. */
  undoInfo(): { label: string; code: UndoCode } | null;
  setSuspended(itemIds: Id[], suspended: boolean): void;
  /** Buries until the next day rollover. */
  bury(itemIds: Id[]): void;
  unbury(itemIds: Id[]): void;
  setFlag(itemIds: Id[], flag: number): void;

  // browse & edit
  search(query: BrowseQuery, options?: SearchOptions): BrowsePage;
  /** Notes with high lapses, high FSRS difficulty, or the `leech` tag. */
  listWeakNotes(query?: WeakNotesQuery): WeakNoteRow[];
  getKnowledgePoint(id: Id): KnowledgePointDetail | null;
  /** Renders one item (preview in the browser/editor). */
  renderItem(itemId: Id): AnkiTemplatePresentation;
  /** Active visual presentations attached to a knowledge point (both KP-wide and item-specific). */
  listPresentations(kpId: Id): VisualPresentation[];
  /** Attaches or replaces a visual presentation on a knowledge point (or specific review item). Undoable. */
  setVisualPresentation(input: SetVisualPresentationInput): SetVisualPresentationResult;
  /** Removes matching visual presentation(s). Undoable. Returns count removed. */
  removeVisualPresentation(input: RemoveVisualPresentationInput): number;
  addKnowledgePoint(input: AddKnowledgePointInput): AddResult;
  /** Adds several knowledge points at once: one transaction, one undo step ("add"); all or nothing. */
  addKnowledgePoints(inputs: AddKnowledgePointInput[]): { added: AddResult[]; undoStepId: number | null };
  updateKnowledgePoint(input: UpdateKnowledgePointInput): UpdateResult;
  deleteKnowledgePoints(ids: Id[]): number;
  moveItems(itemIds: Id[], deckId: Id): void;

  // statistics
  stats(options?: { deckId?: Id; days?: number }): Stats;

  // media
  /** Media files by name: a Blob (`File` from OPFS in the browser), or null when missing. */
  getMedia(names: string[]): Promise<Record<string, Blob | null>>;
  /** Stores a media file in the collection and returns the stored filename (disambiguated on collision). */
  putMedia(name: string, data: Uint8Array): Promise<string>;
  listMedia(): MediaInfo[];

  // import / export
  /** Imports an `.apkg`/`.colpkg` (bytes) or an already parsed `AnkiPackage`. */
  importAnki(input: Uint8Array | AnkiPackage, options?: ImportOptions): Promise<ImportResult>;
  exportAnki(options?: ExportOptions): Promise<AnkiPackage>;
  /**
   * Exports an .apkg file (written by @wengu/anki in the legacy-2 format every Anki since 2.1.50 imports).
   * Built in the worker; the bytes are transferred, not copied. Peak worker memory ≈ 2 × exported media + the
   * collection database; for media-heavy exports prefer `exportApkgFile`.
   */
  exportApkg(options?: ExportOptions): Promise<Uint8Array>;
  /**
   * The same file streamed to storage as it is written (OPFS in the browser) and returned as a disk-backed
   * Blob (`File`): peak worker memory ≈ 1 × exported media + the collection database. Only the latest
   * export file is kept. Save it with e.g. `URL.createObjectURL(file)` + a download link.
   */
  exportApkgFile(options?: ExportOptions): Promise<Blob>;
}
