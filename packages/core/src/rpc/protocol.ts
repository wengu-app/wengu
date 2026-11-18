import type { ImportProgress, WenguApi } from "../types.js";

/** Every method of WenguApi, for the client and the worker dispatcher. */
export const API_METHODS = [
  "info",
  "deckTree",
  "createDeck",
  "renameDeck",
  "listPresets",
  "getPreset",
  "deleteDeck",
  "updatePreset",
  "createPreset",
  "setDeckPreset",
  "listNoteTypes",
  "createStockNoteType",
  "listTags",
  "study",
  "answer",
  "explain",
  "undo",
  "undoLabel",
  "undoInfo",
  "setSuspended",
  "bury",
  "unbury",
  "setFlag",
  "search",
  "getKnowledgePoint",
  "renderItem",
  "addKnowledgePoint",
  "addKnowledgePoints",
  "updateKnowledgePoint",
  "deleteKnowledgePoints",
  "moveItems",
  "stats",
  "getMedia",
  "listMedia",
  "importAnki",
  "exportAnki",
  "exportApkg",
  "exportApkgFile",
] as const satisfies readonly (keyof WenguApi)[];

// Compile-time check that API_METHODS lists every method.
type Missing = Exclude<keyof WenguApi, (typeof API_METHODS)[number]>;
const _complete: Missing extends never ? true : Missing = true;
void _complete;

export type ApiMethod = (typeof API_METHODS)[number];

export interface OpenOptions {
  /** "opfs" (default): persistent, OPFS + SAH pool VFS. "memory": nothing persists (demos, tests). */
  storage?: "opfs" | "memory";
  /** Database file name inside the VFS pool (default "/wengu.sqlite3"). */
  dbName?: string;
  /** URL of sqlite3.wasm, when the bundler does not place it next to the worker script. */
  sqliteWasmUrl?: string;
  /** Pause after a failed attempt to acquire the OPFS handles (another tab closing), ms. Default 0 (fail at once). */
  waitForLockMs?: number;
}

export type Request =
  | { t: "open"; id: number; options: OpenOptions }
  | { t: "call"; id: number; method: ApiMethod; args: unknown[]; progress?: boolean; cancellable?: boolean }
  | { t: "close"; id: number }
  /** Abandon request `target` if it has not started yet. */
  | { t: "cancel"; id: number; target: number };

export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
}

export type Response =
  | { t: "result"; id: number; value: unknown }
  | { t: "error"; id: number; error: SerializedError }
  | { t: "progress"; id: number; progress: ImportProgress };

/** What the worker and the client need from a Worker / MessagePort. */
export interface Port {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (ev: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (ev: MessageEvent) => void): void;
  start?(): void;
}
