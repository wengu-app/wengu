/** Row shapes of the main tables, and conversions to the public types. */
import type { Deck, DeckConfig, Notetype } from "@wengu/anki";

import type { ItemDue, KnowledgePoint, NoteType, ReviewItem } from "../types.js";
import { itemStateOf, memoryFromData, parseCardData } from "./scheduler.js";
import { splitTags } from "./text.js";

export interface ItemRow {
  id: number;
  kp_id: number;
  deck_id: number;
  ord: number;
  mtime: number;
  usn: number;
  type: number;
  queue: number;
  due: number;
  ivl: number;
  factor: number;
  reps: number;
  lapses: number;
  left: number;
  odue: number;
  odid: number;
  flags: number;
  data: string;
}

export const ITEM_COLS = "id, kp_id, deck_id, ord, mtime, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data";
export const ITEM_INSERT = `INSERT INTO review_items (${ITEM_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
export const itemValues = (r: ItemRow) =>
  [r.id, r.kp_id, r.deck_id, r.ord, r.mtime, r.usn, r.type, r.queue, r.due, r.ivl, r.factor, r.reps, r.lapses, r.left, r.odue, r.odid, r.flags, r.data] as const;

export interface KpRow {
  id: number;
  guid: string;
  note_type_id: number;
  mtime: number;
  usn: number;
  tags: string;
  fields: string;
  sort_field: string | number;
  checksum: number;
  flags: number;
  data: string;
  search_text: string;
}

export const KP_COLS = "id, guid, note_type_id, mtime, usn, tags, fields, sort_field, checksum, flags, data, search_text";
export const KP_INSERT = `INSERT INTO knowledge_points (${KP_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
export const kpValues = (r: KpRow) =>
  [r.id, r.guid, r.note_type_id, r.mtime, r.usn, r.tags, r.fields, r.sort_field, r.checksum, r.flags, r.data, r.search_text] as const;

export interface RevlogRow {
  id: number;
  card_id: number;
  usn: number;
  ease: number;
  ivl: number;
  last_ivl: number;
  factor: number;
  taken: number;
  kind: number;
}

export const REVLOG_INSERT = "INSERT INTO revlog (id, card_id, usn, ease, ivl, last_ivl, factor, taken, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";
export const revlogValues = (r: RevlogRow) => [r.id, r.card_id, r.usn, r.ease, r.ivl, r.last_ivl, r.factor, r.taken, r.kind] as const;

export interface DeckStatsRow {
  id: number;
  last_day_studied: number;
  new_studied: number;
  review_studied: number;
  learning_studied: number;
  ms_studied: number;
}

/** A deck as cached in memory: the Anki deck (stats from the columns). */
export type DeckRecord = Deck;
export type PresetRecord = DeckConfig;
export type NoteTypeRecord = Notetype;

export const FIELD_SEP = "\x1f";

export function kpToPublic(r: KpRow): KnowledgePoint {
  return {
    id: r.id,
    guid: r.guid,
    noteTypeId: r.note_type_id,
    fields: r.fields.split(FIELD_SEP),
    tags: splitTags(r.tags),
    createdAt: r.id,
    modifiedAt: r.mtime * 1000,
  };
}

export function noteTypeToPublic(n: Notetype): NoteType {
  return {
    id: n.id,
    name: n.name,
    kind: n.kind,
    fields: n.fields.map((f) => ({
      ord: f.ord,
      name: f.name,
      rtl: f.rtl,
      fontName: f.fontName,
      fontSize: f.fontSize,
      description: f.description,
      plainText: f.plainText,
      collapsed: f.collapsed,
      sticky: f.sticky,
    })),
    templates: n.templates.map((t) => ({ ord: t.ord, name: t.name, questionFormat: t.qfmt, answerFormat: t.afmt })),
    css: n.css,
    sortFieldIndex: n.sortFieldIndex,
    modifiedAt: n.mtime * 1000,
  };
}

export function itemDue(r: Pick<ItemRow, "type" | "queue" | "due">, dayStart: (day: number) => number): ItemDue {
  const timeLike = (r.type === 1 || r.type === 3) && r.due > 1_000_000_000;
  if (r.type === 0) return { kind: "new", position: r.due };
  if (r.queue === 1 || r.queue === 4 || timeLike) return { kind: "time", at: r.due * 1000 };
  return { kind: "day", day: r.due, at: dayStart(r.due) };
}

export function itemToPublic(r: ItemRow, dayStart: (day: number) => number, lastReviewAt: number | null = null): ReviewItem {
  const data = parseCardData(r.data);
  const lrt = typeof data["lrt"] === "number" ? data["lrt"] * 1000 : lastReviewAt;
  return {
    id: r.id,
    knowledgePointId: r.kp_id,
    deckId: r.deck_id,
    homeDeckId: r.odid ? r.odid : null,
    ord: r.ord,
    state: itemStateOf(r.type),
    status: r.queue === -1 ? "suspended" : r.queue === -2 || r.queue === -3 ? "buried" : "active",
    due: itemDue(r, dayStart),
    intervalDays: r.type === 2 || r.type === 3 ? r.ivl : 0,
    reps: r.reps,
    lapses: r.lapses,
    flag: r.flags & 7,
    memory: memoryFromData(data),
    lastReviewAt: lrt,
    modifiedAt: r.mtime * 1000,
  };
}

/** Queue an item returns to when unburied/unsuspended (Anki's rules by card type). */
export function restoredQueue(r: Pick<ItemRow, "type" | "due">): number {
  switch (r.type) {
    case 0:
      return 0;
    case 2:
      return 2;
    default:
      return r.due > 1_000_000_000 ? 1 : 3;
  }
}
