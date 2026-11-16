/**
 * The Wengu engine: all collection operations, synchronous over `SqlDatabase` (media I/O is async).
 * Runs inside the database worker in the app, or directly in Node (tests, benchmarks, tools).
 */
import type { AnkiPackage, Deck, DeckConfig, Notetype } from "@wengu/anki";
import { fsrsParametersFor, renderCard } from "@wengu/anki";

import type { SqlDatabase } from "../db/driver.js";
import { SCHEMA_VERSION, migrate } from "../db/schema.js";
import type { MediaStore } from "../media/store.js";
import { mimeType } from "../media/store.js";
import type {
  AddKnowledgePointInput,
  AddResult,
  AnkiTemplatePresentation,
  AnswerInput,
  BrowsePage,
  BrowseQuery,
  CollectionInfo,
  DeckNode,
  DeckPreset,
  ExportOptions,
  Id,
  ImportOptions,
  ImportResult,
  KnowledgePointDetail,
  MediaInfo,
  NoteType,
  Presentation,
  QueueCounts,
  Rating,
  ReviewCard,
  ScheduleExplanation,
  Stats,
  StudyState,
  UndoResult,
  UpdateKnowledgePointInput,
  UpdateResult,
  WenguApi,
} from "../types.js";
import * as browse from "./browse.js";
import { defaultPreset, newDeck, stockNoteType, type StockNoteType } from "./defaults.js";
import { exportPackage } from "./exporter.js";
import { importPackage } from "./importer.js";
import type { DeckStatsRow, ItemRow, KpRow } from "./rows.js";
import { ITEM_COLS, REVLOG_INSERT, itemToPublic, kpToPublic, noteTypeToPublic, restoredQueue } from "./rows.js";
import type { CardMemory, SchedulingConfig, SchedulingTime } from "./scheduler.js";
import { RATING_NAMES, memoryFromData, memoryFromSm2, parseCardData, previewCard, replayMemory, retrievability, fsrsWeights } from "./scheduler.js";
import { computeStats } from "./stats.js";
import { mediaReferences, normaliseTags, splitTags } from "./text.js";
import type { Clock, DayTiming } from "./time.js";
import { SchedulerDays, dayStartSecs, systemClock } from "./time.js";
import { UndoRecorder, applyUndo } from "./undo.js";

export interface EngineOptions {
  clock?: Clock;
  /** Reported by `info()`. */
  storage?: CollectionInfo["storage"];
  sqliteVersion?: string;
  /** Apply Anki's interval fuzz (default true). Tests turn it off to compare with unfuzzed Anki. */
  fuzz?: boolean;
  /** Reads an .apkg (needed by importAnki(bytes)). */
  readPackage?: (bytes: Uint8Array) => Promise<AnkiPackage>;
}

const UNDO_LIMIT = 30;
const DEFAULT_LEARN_AHEAD_SECS = 1200;

interface Settings {
  lastUnburiedDay?: number;
}

export class Engine implements WenguApi {
  readonly clock: Clock;
  readonly fuzz: boolean;
  private readonly opts: EngineOptions;

  // caches (loaded at open, kept in sync by every write)
  noteTypes = new Map<number, Notetype>();
  decks = new Map<number, Deck>();
  presets = new Map<number, DeckConfig>();
  private children = new Map<number | null, number[]>();
  private deckByName = new Map<string, number>();
  private days!: SchedulerDays;
  private crt: number | null = null;
  private totalsCache: Map<number, number> | null = null;

  private constructor(
    readonly db: SqlDatabase,
    readonly media: MediaStore,
    opts: EngineOptions,
  ) {
    this.opts = opts;
    this.clock = opts.clock ?? systemClock;
    this.fuzz = opts.fuzz ?? true;
  }

  static open(db: SqlDatabase, media: MediaStore, opts: EngineOptions = {}): Engine {
    db.exec("PRAGMA foreign_keys = OFF; PRAGMA temp_store = MEMORY; PRAGMA cache_size = -32768;");
    migrate(db);
    const e = new Engine(db, media, opts);
    e.reload();
    return e;
  }

  // ----------------------------------------------------------------------------------------------
  // collection meta & caches
  // ----------------------------------------------------------------------------------------------

  getMeta<T>(key: string): T | undefined {
    const v = this.db.value("SELECT value FROM collection WHERE key = ?", [key]);
    return typeof v === "string" ? (JSON.parse(v) as T) : undefined;
  }

  setMeta(key: string, value: unknown): void {
    this.db.run("INSERT INTO collection (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [key, JSON.stringify(value)]);
  }

  /** Anki's collection config (`col.conf`). */
  ankiConfig(): Record<string, unknown> {
    return this.getMeta<Record<string, unknown>>("config") ?? {};
  }

  rolloverHour(): number {
    const r = this.ankiConfig()["rollover"];
    return typeof r === "number" && r >= 0 && r < 24 ? r : 4;
  }

  learnAheadSecs(): number {
    const v = this.ankiConfig()["collapseTime"];
    return typeof v === "number" && v >= 0 ? v : DEFAULT_LEARN_AHEAD_SECS;
  }

  /** Collection creation time (unix seconds); initialised on first use. */
  crtSecs(): number {
    if (this.crt === null) {
      let crt = this.getMeta<number>("crt");
      if (crt === undefined) {
        crt = dayStartSecs(this.clock.now(), this.rolloverHour(), this.clock);
        const nowMs = this.clock.now();
        this.db.transaction(() => {
          this.setMeta("crt", crt);
          this.setMeta("mod", nowMs);
          this.setMeta("scm", nowMs);
          this.setMeta("usn", 0);
          this.setMeta("ls", 0);
          this.setMeta("config", this.getMeta("config") ?? {});
        });
      }
      this.crt = crt;
    }
    return this.crt;
  }

  schedulerDays(): SchedulerDays {
    const crt = this.crtSecs();
    const roll = this.rolloverHour();
    if (!this.days || this.days.crtSecs !== crt || this.days.rolloverHour !== roll) this.days = new SchedulerDays(crt, roll, this.clock);
    return this.days;
  }

  timing(): DayTiming {
    return this.schedulerDays().timing();
  }

  reload(): void {
    this.crt = null;
    this.noteTypes.clear();
    for (const r of this.db.all<{ data: string }>("SELECT data FROM note_types")) {
      const n = JSON.parse(r.data) as Notetype;
      this.noteTypes.set(n.id, n);
    }
    this.presets.clear();
    for (const r of this.db.all<{ data: string }>("SELECT data FROM deck_presets")) {
      const p = JSON.parse(r.data) as DeckConfig;
      this.presets.set(p.id, p);
    }
    this.decks.clear();
    for (const r of this.db.all<{ data: string } & DeckStatsRow>("SELECT * FROM decks")) {
      const d = JSON.parse(r.data) as Deck;
      d.stats = {
        lastDayStudied: r.last_day_studied,
        newStudied: r.new_studied,
        reviewStudied: r.review_studied,
        learningStudied: r.learning_studied,
        millisecondsStudied: r.ms_studied,
      };
      this.decks.set(d.id, d);
    }
    this.rebuildDeckIndex();
    this.totalsCache = null;
  }

  invalidateTotals(): void {
    this.totalsCache = null;
  }

  private rebuildDeckIndex(): void {
    this.children.clear();
    this.deckByName.clear();
    for (const d of this.decks.values()) this.deckByName.set(d.name.toLowerCase(), d.id);
    for (const d of this.decks.values()) {
      const parentName = d.name.includes("::") ? d.name.slice(0, d.name.lastIndexOf("::")) : null;
      const parentId = parentName === null ? null : (this.deckByName.get(parentName.toLowerCase()) ?? null);
      d.parentId = parentId;
      const list = this.children.get(parentId) ?? [];
      list.push(d.id);
      this.children.set(parentId, list);
    }
    for (const list of this.children.values()) list.sort((a, b) => cmpName(this.decks.get(a)!.name, this.decks.get(b)!.name));
  }

  deckIdByName(name: string): number | undefined {
    return this.deckByName.get(name.toLowerCase());
  }

  childDecks(id: number | null): readonly number[] {
    return this.children.get(id) ?? [];
  }

  /** The deck and all its descendants, in tree order. */
  subtree(id: number): number[] {
    const out: number[] = [];
    const walk = (d: number) => {
      out.push(d);
      for (const c of this.childDecks(d)) walk(c);
    };
    walk(id);
    return out;
  }

  ancestors(id: number): number[] {
    const out: number[] = [];
    let d = this.decks.get(id);
    while (d && d.parentId !== null) {
      out.push(d.parentId);
      d = this.decks.get(d.parentId);
    }
    return out;
  }

  /** Writes a deck (definition) to the database and cache. Stats columns are written from `deck.stats`. */
  saveDeck(deck: Deck): void {
    const { stats, ...rest } = deck;
    this.db.run(
      `INSERT INTO decks (id, name, kind, preset_id, mtime, last_day_studied, new_studied, review_studied, learning_studied, ms_studied, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, kind = excluded.kind, preset_id = excluded.preset_id, mtime = excluded.mtime,
         last_day_studied = excluded.last_day_studied, new_studied = excluded.new_studied, review_studied = excluded.review_studied,
         learning_studied = excluded.learning_studied, ms_studied = excluded.ms_studied, data = excluded.data`,
      [
        deck.id,
        deck.name,
        deck.kind,
        deck.configId,
        deck.mtime,
        stats.lastDayStudied,
        stats.newStudied,
        stats.reviewStudied,
        stats.learningStudied,
        stats.millisecondsStudied,
        JSON.stringify(rest),
      ],
    );
    this.decks.set(deck.id, deck);
    this.rebuildDeckIndex();
  }

  savePreset(p: DeckConfig): void {
    this.db.run(
      "INSERT INTO deck_presets (id, name, mtime, data) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET name = excluded.name, mtime = excluded.mtime, data = excluded.data",
      [p.id, p.name, p.mtime, JSON.stringify(p)],
    );
    this.presets.set(p.id, p);
  }

  saveNoteType(n: Notetype): void {
    this.db.run(
      "INSERT INTO note_types (id, name, kind, mtime, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET name = excluded.name, kind = excluded.kind, mtime = excluded.mtime, data = excluded.data",
      [n.id, n.name, n.kind, n.mtime, JSON.stringify(n)],
    );
    this.noteTypes.set(n.id, n);
  }

  /** Marks the collection modified (Anki's col.mod). */
  touch(): void {
    this.setMeta("mod", this.clock.now());
  }

  /** A fresh id: a millisecond timestamp not used in `table`. */
  newId(table: "knowledge_points" | "review_items" | "decks" | "deck_presets" | "note_types" | "presentations"): number {
    const max = Number(this.db.value(`SELECT coalesce(max(id), 0) FROM ${table}`) ?? 0);
    return Math.max(this.clock.now(), max + 1);
  }

  isEmpty(): boolean {
    return !this.db.value("SELECT 1 FROM knowledge_points LIMIT 1") && !this.db.value("SELECT 1 FROM review_items LIMIT 1") && !this.db.value("SELECT 1 FROM revlog LIMIT 1");
  }

  ensureDefaultPreset(): DeckConfig {
    const p = this.presets.get(1) ?? [...this.presets.values()][0];
    if (p) return p;
    const preset = defaultPreset(1, "Default", Math.floor(this.clock.now() / 1000));
    this.savePreset(preset);
    return preset;
  }

  presetForDeck(deckId: number): DeckConfig {
    const deck = this.decks.get(deckId);
    const conf = deck?.configId != null ? this.presets.get(deck.configId) : undefined;
    return conf ?? this.presets.get(1) ?? [...this.presets.values()][0] ?? defaultPreset();
  }

  /** The deck whose options apply to an item (its home deck when it sits in a filtered deck). */
  homeDeck(row: Pick<ItemRow, "deck_id" | "odid">): number {
    return row.odid ? row.odid : row.deck_id;
  }

  schedulingConfig(deckId: number): SchedulingConfig & { presetId: number | null; presetName: string } {
    const preset = this.presetForDeck(deckId);
    const deck = this.decks.get(deckId);
    const fp = deck ? fsrsParametersFor({ ...deck, configId: preset.id }, [preset]) : null;
    return {
      learnSteps: preset.learnSteps,
      relearnSteps: preset.relearnSteps,
      maximumInterval: preset.maximumReviewInterval,
      initialEase: preset.initialEase || 2.5,
      desiredRetention: fp?.desiredRetention ?? preset.desiredRetention ?? 0.9,
      params: fp?.params ?? null,
      leechThreshold: preset.leechThreshold,
      leechAction: preset.leechAction,
      fuzz: this.fuzz,
      presetId: preset.id,
      presetName: preset.name,
    };
  }

  // ----------------------------------------------------------------------------------------------
  // info, decks, presets, note types, tags
  // ----------------------------------------------------------------------------------------------

  info(): CollectionInfo {
    const t = this.timing();
    const count = (table: string) => Number(this.db.value(`SELECT count(*) FROM ${table}`) ?? 0);
    return {
      schemaVersion: SCHEMA_VERSION,
      sqliteVersion: this.opts.sqliteVersion ?? String(this.db.value("SELECT sqlite_version()")),
      storage: this.opts.storage ?? "memory",
      crtSecs: this.crtSecs(),
      today: t.today,
      nextDayAt: t.nextDayAtMs,
      rolloverHour: this.rolloverHour(),
      counts: {
        knowledgePoints: count("knowledge_points"),
        reviewItems: count("review_items"),
        reviewLog: count("revlog"),
        media: count("media"),
        decks: this.decks.size,
      },
    };
  }

  private deckTotals(): Map<number, number> {
    if (!this.totalsCache) {
      this.totalsCache = new Map();
      for (const r of this.db.values("SELECT deck_id, count(*) FROM review_items GROUP BY deck_id")) this.totalsCache.set(Number(r[0]), Number(r[1]));
    }
    return this.totalsCache;
  }

  deckTree(): DeckNode[] {
    const t = this.timing();
    this.maybeUnbury(t);
    const totals = this.deckTotals();
    const build = (id: number): DeckNode => {
      const d = this.decks.get(id)!;
      const children = this.childDecks(id).map(build);
      const own = this.ownCounts(id, t, this.remaining(id, t.today));
      const lim = this.remaining(id, t.today);
      const sum = (k: keyof QueueCounts) => own[k] + children.reduce((a, c) => a + c.counts[k], 0);
      return {
        id,
        name: d.name,
        shortName: d.path[d.path.length - 1] ?? d.name,
        parentId: d.parentId,
        kind: d.kind,
        presetId: d.configId,
        collapsed: d.collapsed,
        counts: { new: Math.min(lim.new, sum("new")), learning: sum("learning"), review: Math.min(lim.review, sum("review")) },
        totalItems: (totals.get(id) ?? 0) + children.reduce((a, c) => a + c.totalItems, 0),
        children,
      };
    };
    return this.childDecks(null).map(build);
  }

  createDeck(name: string): Id {
    const clean = name
      .split("::")
      .map((p) => p.trim())
      .filter(Boolean)
      .join("::");
    if (!clean) throw new Error("deck name is empty");
    const existing = this.deckIdByName(clean);
    if (existing !== undefined) return existing;
    return this.db.transaction(() => {
      const preset = this.ensureDefaultPreset();
      const parts = clean.split("::");
      let id = 0;
      for (let i = 1; i <= parts.length; i++) {
        const n = parts.slice(0, i).join("::");
        const ex = this.deckIdByName(n);
        if (ex !== undefined) {
          id = ex;
          continue;
        }
        id = this.newId("decks");
        this.saveDeck(newDeck(id, n, preset.id, Math.floor(this.clock.now() / 1000)));
      }
      this.touch();
      return id;
    });
  }

  renameDeck(id: Id, newName: string): void {
    const deck = this.decks.get(id);
    if (!deck) throw new Error(`no deck ${id}`);
    const clean = newName
      .split("::")
      .map((p) => p.trim())
      .filter(Boolean)
      .join("::");
    if (!clean) throw new Error("deck name is empty");
    const clash = this.deckIdByName(clean);
    if (clash !== undefined && clash !== id) throw new Error(`a deck named "${clean}" already exists`);
    this.db.transaction(() => {
      const old = deck.name;
      const nowSecs = Math.floor(this.clock.now() / 1000);
      for (const d of [...this.decks.values()]) {
        if (d.id === id || d.name.toLowerCase().startsWith(old.toLowerCase() + "::")) {
          const name = clean + d.name.slice(old.length);
          this.saveDeck({ ...d, name, path: name.split("::"), mtime: nowSecs, usn: -1 });
        }
      }
      // parents of the new name
      const parts = clean.split("::");
      for (let i = 1; i < parts.length; i++) {
        const n = parts.slice(0, i).join("::");
        if (this.deckIdByName(n) === undefined) this.saveDeck(newDeck(this.newId("decks"), n, this.ensureDefaultPreset().id, nowSecs));
      }
      this.touch();
    });
  }

  listPresets(): DeckPreset[] {
    const counts = new Map<number, number>();
    for (const d of this.decks.values()) if (d.configId !== null) counts.set(d.configId, (counts.get(d.configId) ?? 0) + 1);
    return [...this.presets.values()].map((p) => {
      const version = p.fsrsParams6.length ? 6 : p.fsrsParams5.length ? 5 : p.fsrsParams4.length ? 4 : 6;
      const stored = version === 6 ? p.fsrsParams6 : version === 5 ? p.fsrsParams5 : p.fsrsParams4;
      return {
        id: p.id,
        name: p.name,
        newPerDay: p.newPerDay,
        reviewsPerDay: p.reviewsPerDay,
        learnStepsMinutes: p.learnSteps,
        relearnStepsMinutes: p.relearnSteps,
        maximumIntervalDays: p.maximumReviewInterval,
        desiredRetention: p.desiredRetention,
        fsrsParams: fsrsWeights(stored.length ? stored : null),
        fsrsVersion: version,
        deckCount: counts.get(p.id) ?? 0,
      };
    });
  }

  listNoteTypes(): NoteType[] {
    return [...this.noteTypes.values()].map(noteTypeToPublic).sort((a, b) => cmpName(a.name, b.name));
  }

  /** Adds one of Anki's stock note types (for a fresh collection) and returns its id. */
  createStockNoteType(kind: StockNoteType): Id {
    return this.db.transaction(() => {
      const id = this.newId("note_types");
      this.saveNoteType(stockNoteType(kind, id, Math.floor(this.clock.now() / 1000)));
      this.touch();
      return id;
    });
  }

  listTags(): string[] {
    return this.db.values("SELECT name FROM tags ORDER BY name COLLATE NOCASE").map((r) => String(r[0]));
  }

  // ----------------------------------------------------------------------------------------------
  // queues
  // ----------------------------------------------------------------------------------------------

  /** Buried items come back when a new scheduler day starts. */
  maybeUnbury(t: DayTiming): void {
    const settings = this.getMeta<Settings>("settings") ?? {};
    const ankiLast = this.ankiConfig()["lastUnburied"];
    const last = settings.lastUnburiedDay ?? (typeof ankiLast === "number" ? ankiLast : undefined);
    if (last !== undefined && last >= t.today) return;
    this.db.transaction(() => {
      this.db.run(
        `UPDATE review_items SET queue = CASE type WHEN 0 THEN 0 WHEN 2 THEN 2 ELSE CASE WHEN due > 1000000000 THEN 1 ELSE 3 END END
         WHERE queue IN (-2, -3)`,
      );
      this.setMeta("settings", { ...settings, lastUnburiedDay: t.today });
    });
  }

  /** Remaining new/review allowance of a deck today (filtered decks: unlimited). */
  remaining(deckId: number, today: number): { new: number; review: number } {
    const d = this.decks.get(deckId);
    if (!d || d.kind === "filtered") return { new: Infinity, review: Infinity };
    const p = this.presetForDeck(deckId);
    const newLimit = d.newLimitToday && d.newLimitToday.today === today ? d.newLimitToday.limit : (d.newLimit ?? p.newPerDay);
    const revLimit = d.reviewLimitToday && d.reviewLimitToday.today === today ? d.reviewLimitToday.limit : (d.reviewLimit ?? p.reviewsPerDay);
    const s = d.stats.lastDayStudied === today ? d.stats : { newStudied: 0, reviewStudied: 0 };
    return { new: Math.max(0, newLimit - s.newStudied), review: Math.max(0, revLimit - s.reviewStudied) };
  }

  /** Items of one deck (not subdecks) due today, each count bounded by the given allowance. */
  private ownCounts(deckId: number, t: DayTiming, lim: { new: number; review: number }): QueueCounts {
    const cap = (n: number) => (Number.isFinite(n) ? n : 1_000_000);
    const bounded = (sql: string, params: (number | string)[], limit: number) =>
      limit <= 0 ? 0 : Number(this.db.value(`SELECT count(*) FROM (SELECT 1 FROM review_items WHERE ${sql} LIMIT ?)`, [...params, cap(limit)]) ?? 0);
    const nowSecs = Math.floor(t.nowMs / 1000);
    const learning =
      Number(this.db.value("SELECT count(*) FROM review_items WHERE deck_id = ? AND queue IN (1, 4) AND due <= ?", [deckId, nowSecs + this.learnAheadSecs()]) ?? 0) +
      Number(this.db.value("SELECT count(*) FROM review_items WHERE deck_id = ? AND queue = 3 AND due <= ?", [deckId, t.today]) ?? 0);
    return {
      new: bounded("deck_id = ? AND queue = 0", [deckId], lim.new),
      learning,
      review: bounded("deck_id = ? AND queue = 2 AND due <= ?", [deckId, t.today], lim.review),
    };
  }

  /** Counts for a deck subtree (null = all decks) with Anki-v3-style limits: each deck's allowance caps itself and its subdecks. */
  private subtreeCounts(deckId: number | null, t: DayTiming): QueueCounts {
    const walk = (id: number): QueueCounts => {
      const lim = this.remaining(id, t.today);
      const own = this.ownCounts(id, t, lim);
      const kids = this.childDecks(id).map(walk);
      const sum = (k: keyof QueueCounts) => own[k] + kids.reduce((a, c) => a + c[k], 0);
      return { new: Math.min(lim.new, sum("new")), learning: sum("learning"), review: Math.min(lim.review, sum("review")) };
    };
    if (deckId !== null) return walk(deckId);
    const roots = this.childDecks(null).map(walk);
    return {
      new: roots.reduce((a, c) => a + c.new, 0),
      learning: roots.reduce((a, c) => a + c.learning, 0),
      review: roots.reduce((a, c) => a + c.review, 0),
    };
  }

  /** Decks of the subtree whose path (from the studied deck down) has allowance left for `kind`. */
  private allowedDecks(deckId: number | null, today: number, kind: "new" | "review"): number[] {
    const out: number[] = [];
    const walk = (id: number) => {
      if (this.remaining(id, today)[kind] <= 0) return;
      out.push(id);
      for (const c of this.childDecks(id)) walk(c);
    };
    if (deckId === null) for (const r of this.childDecks(null)) walk(r);
    else walk(deckId);
    return out;
  }

  private allDecksOf(deckId: number | null): number[] {
    return deckId === null ? [...this.decks.keys()] : this.subtree(deckId);
  }

  private firstRow(sql: string, params: (number | string)[]): ItemRow | undefined {
    return this.db.get<ItemRow>(`SELECT ${ITEM_COLS} FROM review_items WHERE ${sql}`, params);
  }

  /**
   * Picks the next item. Order (stated simplification of Anki's v3 queues):
   *  1. intraday (re)learning items due now, earliest first;
   *  2. reviews and interday learning due today, earliest due first (most overdue first), within review limits;
   *  3. new items within new limits, deck by deck in deck-tree order, by position;
   *     the preset's "new/review mix" decides between 2 and 3 (reviews first, new first, or spread evenly);
   *  4. learning items due within the learn-ahead window (Anki's collapseTime, default 20 min).
   */
  private pickNext(deckId: number | null, t: DayTiming, counts: QueueCounts): { row: ItemRow | null; nextLearningDueAt: number | null } {
    const nowSecs = Math.floor(t.nowMs / 1000);
    const decks = this.allDecksOf(deckId);
    const pickMin = (rows: (ItemRow | undefined)[]) =>
      rows.reduce<ItemRow | null>((best, r) => (r && (!best || r.due < best.due || (r.due === best.due && r.id < best.id)) ? r : best), null);

    const learningNow = pickMin(decks.map((d) => this.firstRow("deck_id = ? AND queue IN (1, 4) AND due <= ? ORDER BY due, id LIMIT 1", [d, nowSecs])));
    if (learningNow) return { row: learningNow, nextLearningDueAt: null };

    const review = () =>
      pickMin(
        this.allowedDecks(deckId, t.today, "review").flatMap((d) => [
          this.firstRow("deck_id = ? AND queue = 2 AND due <= ? ORDER BY due, id LIMIT 1", [d, t.today]),
          this.firstRow("deck_id = ? AND queue = 3 AND due <= ? ORDER BY due, id LIMIT 1", [d, t.today]),
        ]),
      );
    const fresh = () => {
      for (const d of this.allowedDecks(deckId, t.today, "new")) {
        const r = this.firstRow("deck_id = ? AND queue = 0 ORDER BY due, ord, id LIMIT 1", [d]);
        if (r) return r;
      }
      return null;
    };
    const mix = deckId !== null ? this.presetForDeck(deckId).newMix : 0;
    let order: ("review" | "new")[];
    if (counts.new <= 0) order = ["review"];
    else if (counts.review <= 0) order = ["new", "review"];
    else if (mix === 2) order = ["new", "review"];
    else if (mix === 1) order = ["review", "new"];
    else {
      // spread new items evenly: one new item after every `gap` reviews
      const gap = Math.max(1, Math.floor(counts.review / counts.new));
      const studied = deckId !== null ? this.studiedToday(deckId, t.today) : 0;
      order = studied % (gap + 1) === gap ? ["new", "review"] : ["review", "new"];
    }
    for (const k of order) {
      const r = k === "review" ? review() : counts.new > 0 ? fresh() : null;
      if (r) return { row: r, nextLearningDueAt: null };
    }

    const ahead = pickMin(decks.map((d) => this.firstRow("deck_id = ? AND queue IN (1, 4) AND due <= ? ORDER BY due, id LIMIT 1", [d, nowSecs + this.learnAheadSecs()])));
    if (ahead) return { row: ahead, nextLearningDueAt: null };
    const later = pickMin(decks.map((d) => this.firstRow("deck_id = ? AND queue IN (1, 4) AND due < ? ORDER BY due, id LIMIT 1", [d, Math.floor(t.nextDayAtMs / 1000)])));
    return { row: null, nextLearningDueAt: later ? later.due * 1000 : null };
  }

  private studiedToday(deckId: number, today: number): number {
    const s = this.decks.get(deckId)?.stats;
    return s && s.lastDayStudied === today ? s.newStudied + s.reviewStudied : 0;
  }

  study(deckId: Id | null = null): StudyState {
    if (deckId !== null && !this.decks.has(deckId)) throw new Error(`no deck ${deckId}`);
    const t = this.timing();
    this.maybeUnbury(t);
    const counts = this.subtreeCounts(deckId, t);
    const { row, nextLearningDueAt } = this.pickNext(deckId, t, counts);
    return {
      deckId,
      counts,
      card: row ? this.reviewCard(row, t) : null,
      nextLearningDueAt,
      undoLabel: this.undoLabel(),
      today: t.today,
    };
  }

  // ----------------------------------------------------------------------------------------------
  // cards: rendering, memory, explanation
  // ----------------------------------------------------------------------------------------------

  getItemRow(id: number): ItemRow | undefined {
    return this.db.get<ItemRow>(`SELECT ${ITEM_COLS} FROM review_items WHERE id = ?`, [id]);
  }

  getKpRow(id: number): KpRow | undefined {
    return this.db.get<KpRow>("SELECT * FROM knowledge_points WHERE id = ?", [id]);
  }

  renderRow(row: ItemRow, kp: KpRow): AnkiTemplatePresentation {
    const nt = this.noteTypes.get(kp.note_type_id);
    if (!nt) {
      return { kind: "anki-template", templateName: "", question: "", answer: "", questionAvTags: [], answerAvTags: [], css: "", media: [], errors: [`note type ${kp.note_type_id} missing`] };
    }
    const deck = this.decks.get(row.odid || row.deck_id);
    const r = renderCard({
      notetype: nt,
      note: { fields: kp.fields.split("\x1f"), tags: splitTags(kp.tags) },
      cardOrd: row.ord,
      deckName: deck?.name ?? "",
      flags: row.flags,
      cardId: row.id,
    });
    const template = nt.kind === "cloze" ? nt.templates[0] : nt.templates.find((x) => x.ord === row.ord);
    const media = new Set(mediaReferences(r.question + r.answer + "<style>" + r.css + "</style>"));
    for (const tag of [...r.questionAvTags, ...r.answerAvTags]) if (tag.kind === "sound") media.add(tag.filename);
    return {
      kind: "anki-template",
      templateName: template?.name ?? "",
      question: r.question,
      answer: r.answer,
      questionAvTags: r.questionAvTags,
      answerAvTags: r.answerAvTags,
      css: r.css,
      media: [...media],
      errors: r.errors,
    };
  }

  renderItem(itemId: Id): AnkiTemplatePresentation {
    const row = this.getItemRow(itemId);
    if (!row) throw new Error(`no review item ${itemId}`);
    return this.renderRow(row, this.getKpRow(row.kp_id)!);
  }

  /** Stored presentations of other kinds for an item (none in M1; unknown kinds are passed through as such). */
  storedPresentations(row: ItemRow): Presentation[] {
    return this.db
      .all<{ id: number; kind: string }>("SELECT id, kind FROM presentations WHERE kp_id = ? AND (review_item_id IS NULL OR review_item_id = ?) AND status = 'active' ORDER BY id", [row.kp_id, row.id])
      .map((p) => ({ kind: "unknown", storedKind: p.kind, id: p.id }));
  }

  /** Resolves the FSRS memory state of an item: card data; else review-log replay; else from SM-2 ease/interval. */
  cardMemory(row: ItemRow, cfg: SchedulingConfig): CardMemory {
    if (row.type === 0) return { memory: null, lastReviewSecs: null };
    const data = parseCardData(row.data);
    let memory = memoryFromData(data);
    let last = typeof data["lrt"] === "number" ? data["lrt"] : null;
    if (!memory || last === null) {
      const log = this.db.all<{ id: number; ease: number; kind: number; ivl: number }>("SELECT id, ease, kind, ivl FROM revlog WHERE card_id = ? ORDER BY id", [row.id]);
      const days = this.schedulerDays();
      const replay = replayMemory(log, (ms) => days.dayOf(ms), cfg.params);
      memory ??= replay.memory;
      last ??= replay.lastReviewSecs;
      if (!memory && (row.type === 2 || row.type === 3)) memory = memoryFromSm2((row.factor || 2500) / 1000, Math.max(row.ivl, 1), 0.9, cfg.params);
      if (last === null && row.type === 2 && row.due < 1_000_000_000) last = Math.floor(days.dayStart(row.due - row.ivl) / 1000);
    }
    return { memory, lastReviewSecs: last };
  }

  private schedulingTime(t: DayTiming): SchedulingTime {
    const days = this.schedulerDays();
    return { nowMs: t.nowMs, today: t.today, nextDayAtSecs: Math.floor(t.nextDayAtMs / 1000), dayStart: (d) => days.dayStart(d) };
  }

  private lastIvl(row: ItemRow): number {
    if (row.type === 0) return 0;
    if (row.type === 2) return row.ivl;
    return Number(this.db.value("SELECT ivl FROM revlog WHERE card_id = ? ORDER BY id DESC LIMIT 1", [row.id]) ?? 0);
  }

  private explainRow(row: ItemRow, t: DayTiming) {
    const cfg = this.schedulingConfig(this.homeDeck(row));
    const mem = this.cardMemory(row, cfg);
    const updates = previewCard(row, mem, cfg, this.schedulingTime(t), this.lastIvl(row));
    const elapsedDays = mem.lastReviewSecs !== null ? Math.max(0, Math.floor((t.nextDayAtMs / 1000 - mem.lastReviewSecs) / 86400)) : 0;
    const explanation: ScheduleExplanation = {
      memory: row.type === 0 ? null : mem.memory,
      retrievability:
        row.type !== 0 && mem.memory && mem.lastReviewSecs !== null
          ? retrievability(mem.memory, Math.max(0, (t.nowMs / 1000 - mem.lastReviewSecs) / 86400), cfg.params)
          : null,
      elapsedDays,
      desiredRetention: cfg.desiredRetention,
      presetId: cfg.presetId,
      presetName: cfg.presetName,
      fsrsParams: fsrsWeights(cfg.params),
      outcomes: {
        again: updates[0].outcome,
        hard: updates[1].outcome,
        good: updates[2].outcome,
        easy: updates[3].outcome,
      },
    };
    return { cfg, mem, updates, explanation };
  }

  explain(itemId: Id): ScheduleExplanation {
    const row = this.getItemRow(itemId);
    if (!row) throw new Error(`no review item ${itemId}`);
    return this.explainRow(row, this.timing()).explanation;
  }

  private reviewCard(row: ItemRow, t: DayTiming): ReviewCard {
    const kp = this.getKpRow(row.kp_id)!;
    const days = this.schedulerDays();
    const presentation = this.renderRow(row, kp);
    const deck = this.decks.get(row.deck_id);
    return {
      item: itemToPublic(row, (d) => days.dayStart(d)),
      knowledgePoint: kpToPublic(kp),
      noteTypeName: this.noteTypes.get(kp.note_type_id)?.name ?? "",
      deckName: deck?.name ?? "",
      presentation,
      presentations: [presentation, ...this.storedPresentations(row)],
      schedule: this.explainRow(row, t).explanation,
    };
  }

  // ----------------------------------------------------------------------------------------------
  // answering & undo
  // ----------------------------------------------------------------------------------------------

  answer(input: AnswerInput): StudyState {
    const rating = input.rating;
    if (![1, 2, 3, 4].includes(rating)) throw new Error(`invalid rating ${String(rating)}`);
    const t = this.timing();
    this.maybeUnbury(t);
    const row = this.getItemRow(input.itemId);
    if (!row) throw new Error(`no review item ${input.itemId}`);
    if (row.queue < 0) throw new Error(`review item ${row.id} is suspended or buried`);
    const { cfg, updates } = this.explainRow(row, t);
    const u = updates[rating - 1]!;
    const preset = this.presetForDeck(this.homeDeck(row));
    const nowSecs = Math.floor(t.nowMs / 1000);
    const taken = Math.max(0, Math.min(Math.round(input.takenMs), (preset.capAnswerTimeToSecs || 60) * 1000));

    this.db.transaction(() => {
      const undo = new UndoRecorder(this.db, `Answer ${RATING_NAMES[rating - 1]}`);
      undo.item(row.id);
      const c = u.card;
      this.db.run(
        "UPDATE review_items SET type = ?, queue = ?, due = ?, ivl = ?, factor = ?, reps = ?, lapses = ?, left = ?, data = ?, mtime = ?, usn = -1 WHERE id = ?",
        [c.type, c.queue, c.due, c.ivl, c.factor, c.reps, c.lapses, c.left, c.data, nowSecs, row.id],
      );
      const lastId = Number(this.db.value("SELECT coalesce(max(id), 0) FROM revlog") ?? 0);
      const revlogId = Math.max(t.nowMs, lastId + 1);
      undo.revlogInserted(revlogId);
      this.db.run(REVLOG_INSERT, [revlogId, row.id, -1, u.revlog.ease, u.revlog.ivl, u.revlog.lastIvl, u.revlog.factor, taken, u.revlog.kind]);

      // daily counters on the deck and its parents
      for (const did of [row.deck_id, ...this.ancestors(row.deck_id)]) {
        const d = this.decks.get(did);
        if (!d) continue;
        undo.deckStats(did);
        const s = d.stats.lastDayStudied === t.today ? { ...d.stats } : { lastDayStudied: t.today, newStudied: 0, reviewStudied: 0, learningStudied: 0, millisecondsStudied: 0 };
        if (row.type === 0) s.newStudied++;
        else if (row.type === 2) s.reviewStudied++;
        else s.learningStudied++;
        s.millisecondsStudied += taken;
        this.db.run("UPDATE decks SET last_day_studied = ?, new_studied = ?, review_studied = ?, learning_studied = ?, ms_studied = ? WHERE id = ?", [
          s.lastDayStudied,
          s.newStudied,
          s.reviewStudied,
          s.learningStudied,
          s.millisecondsStudied,
          did,
        ]);
        d.stats = s;
      }

      // bury siblings
      if (preset.buryNew || preset.buryReviews || preset.buryInterdayLearning) {
        const sibs = this.db.all<ItemRow>(`SELECT ${ITEM_COLS} FROM review_items WHERE kp_id = ? AND id != ?`, [row.kp_id, row.id]);
        for (const s of sibs) {
          const bury =
            (preset.buryNew && s.queue === 0) ||
            (preset.buryReviews && s.queue === 2 && s.due <= t.today) ||
            (preset.buryInterdayLearning && s.queue === 3 && s.due <= t.today);
          if (!bury) continue;
          undo.item(s.id);
          this.db.run("UPDATE review_items SET queue = -2, mtime = ?, usn = -1 WHERE id = ?", [nowSecs, s.id]);
        }
      }

      if (u.leech) {
        const kp = this.getKpRow(row.kp_id)!;
        const tags = splitTags(kp.tags);
        if (!tags.some((x) => x.toLowerCase() === "leech")) {
          undo.kp(kp.id);
          browse.writeTags(this, kp.id, [...tags, "leech"], nowSecs);
        }
      }
      undo.commit(t.nowMs, UNDO_LIMIT);
    });
    void cfg;
    return this.study(input.deckId ?? null);
  }

  undoLabel(): string | null {
    const v = this.db.value("SELECT label FROM undo_steps ORDER BY id DESC LIMIT 1");
    return typeof v === "string" ? v : null;
  }

  undo(): UndoResult | null {
    const r = this.db.transaction(() => applyUndo(this));
    if (r) {
      this.reload();
    }
    return r;
  }

  /** Records an undoable operation. */
  undoable<T>(label: string, fn: (undo: UndoRecorder) => T): T {
    return this.db.transaction(() => {
      const undo = new UndoRecorder(this.db, label);
      const r = fn(undo);
      undo.commit(this.clock.now(), UNDO_LIMIT);
      return r;
    });
  }

  private setQueue(itemIds: Id[], label: string, next: (r: ItemRow) => number | null): void {
    this.maybeUnbury(this.timing()); // so items buried now are not unburied by today's first queue build
    const nowSecs = Math.floor(this.clock.now() / 1000);
    this.undoable(label, (undo) => {
      for (const id of itemIds) {
        const r = this.getItemRow(id);
        if (!r) continue;
        const q = next(r);
        if (q === null || q === r.queue) continue;
        undo.item(id);
        this.db.run("UPDATE review_items SET queue = ?, mtime = ?, usn = -1 WHERE id = ?", [q, nowSecs, id]);
      }
    });
  }

  setSuspended(itemIds: Id[], suspended: boolean): void {
    this.setQueue(itemIds, suspended ? "Suspend" : "Unsuspend", (r) => (suspended ? -1 : r.queue === -1 ? restoredQueue(r) : null));
  }

  bury(itemIds: Id[]): void {
    this.setQueue(itemIds, "Bury", (r) => (r.queue >= 0 ? -3 : null));
  }

  unbury(itemIds: Id[]): void {
    this.setQueue(itemIds, "Unbury", (r) => (r.queue === -2 || r.queue === -3 ? restoredQueue(r) : null));
  }

  setFlag(itemIds: Id[], flag: number): void {
    if (!Number.isInteger(flag) || flag < 0 || flag > 7) throw new Error(`invalid flag ${flag}`);
    const nowSecs = Math.floor(this.clock.now() / 1000);
    this.undoable("Flag", (undo) => {
      for (const id of itemIds) {
        const r = this.getItemRow(id);
        if (!r) continue;
        undo.item(id);
        this.db.run("UPDATE review_items SET flags = (flags & ~7) | ?, mtime = ?, usn = -1 WHERE id = ?", [flag, nowSecs, id]);
      }
    });
  }

  moveItems(itemIds: Id[], deckId: Id): void {
    if (!this.decks.has(deckId)) throw new Error(`no deck ${deckId}`);
    const nowSecs = Math.floor(this.clock.now() / 1000);
    this.undoable("Change deck", (undo) => {
      for (const id of itemIds) {
        const r = this.getItemRow(id);
        if (!r || r.deck_id === deckId) continue;
        undo.item(id);
        this.db.run("UPDATE review_items SET deck_id = ?, mtime = ?, usn = -1 WHERE id = ?", [deckId, nowSecs, id]);
      }
    });
    this.invalidateTotals();
  }

  // ----------------------------------------------------------------------------------------------
  // browse / edit (browse.ts)
  // ----------------------------------------------------------------------------------------------

  search(query: BrowseQuery): BrowsePage {
    return browse.search(this, query);
  }

  getKnowledgePoint(id: Id): KnowledgePointDetail | null {
    return browse.getKnowledgePoint(this, id);
  }

  addKnowledgePoint(input: AddKnowledgePointInput): AddResult {
    return browse.addKnowledgePoint(this, input);
  }

  updateKnowledgePoint(input: UpdateKnowledgePointInput): UpdateResult {
    return browse.updateKnowledgePoint(this, input);
  }

  deleteKnowledgePoints(ids: Id[]): number {
    return browse.deleteKnowledgePoints(this, ids);
  }

  normaliseTags(tags: readonly string[]): string[] {
    return normaliseTags(tags);
  }

  // ----------------------------------------------------------------------------------------------
  // stats, media, import/export
  // ----------------------------------------------------------------------------------------------

  stats(options: { deckId?: Id; days?: number } = {}): Stats {
    return computeStats(this, options);
  }

  async getMedia(names: string[]): Promise<Record<string, Blob | null>> {
    const out: Record<string, Blob | null> = {};
    for (const name of names) {
      let r = this.db.get<{ hash: string }>("SELECT hash FROM media WHERE name = ?", [name]);
      if (!r) {
        try {
          const decoded = decodeURIComponent(name);
          if (decoded !== name) r = this.db.get<{ hash: string }>("SELECT hash FROM media WHERE name = ?", [decoded]);
        } catch {
          /* not URI-encoded */
        }
      }
      out[name] = r ? await this.media.get(r.hash, mimeType(name)) : null;
    }
    return out;
  }

  listMedia(): MediaInfo[] {
    return this.db.all<MediaInfo>("SELECT name, size, hash FROM media ORDER BY position");
  }

  async importAnki(input: Uint8Array | AnkiPackage, options: ImportOptions = {}): Promise<ImportResult> {
    const started = Date.now();
    let pkg: AnkiPackage;
    if (input instanceof Uint8Array) {
      if (!this.opts.readPackage) throw new Error("no package reader configured");
      options.onProgress?.({ phase: "reading", done: 0, total: 1 });
      pkg = await this.opts.readPackage(input);
      options.onProgress?.({ phase: "reading", done: 1, total: 1 });
    } else pkg = input;
    const r = await importPackage(this, pkg, options);
    r.durationMs = Date.now() - started;
    return r;
  }

  async exportAnki(options: ExportOptions = {}): Promise<AnkiPackage> {
    return exportPackage(this, options);
  }
}

export function cmpName(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}

export type { Rating };
