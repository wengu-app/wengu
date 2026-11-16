import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { readAnkiPackage } from "../src/index.js";
import type { AnkiPackage } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURES = join(here, "..", "fixtures");

export interface ExpectedState {
  kind: string;
  scheduled_days?: number;
  elapsed_days?: number;
  scheduled_secs?: number;
  remaining_steps?: number;
  learning_scheduled_secs?: number;
  review?: { scheduled_days: number; elapsed_days: number; lapses: number };
  memory_state?: { stability: number; difficulty: number };
}

export interface ExpectedCard {
  id: number;
  nid: number;
  noteGuid: string;
  ord: number;
  deck: string;
  type: number;
  queue: number;
  due: number;
  ivl: number;
  factor: number;
  reps: number;
  lapses: number;
  left: number;
  flags: number;
  odid: number;
  odue: number;
  data: string;
  memoryState: { stability: number; difficulty: number } | null;
  desiredRetention: number | null;
  decay: number | null;
  lastReviewTime: number | null;
  render: { question: string; answer: string; questionAvTags: string[]; answerAvTags: string[] };
  next?: Record<"current" | "again" | "hard" | "good" | "easy", ExpectedState>;
  recomputedMemoryState?: { stability: number; difficulty: number; desiredRetention: number; decay: number };
  fuzzDelta?: number[];
}

export interface Expected {
  ankiVersion: string;
  now: number;
  crt: number;
  today: number;
  rolloverHour: number;
  counts: Record<string, number>;
  tags: string[];
  decks: { id: number; name: string; dyn: boolean; conf: number | null; desc: string; desiredRetention: number | null }[];
  deckConfigs: {
    id: number;
    name: string;
    learnSteps: number[];
    relearnSteps: number[];
    newPerDay: number;
    reviewsPerDay: number;
    maxIvl: number;
    desiredRetention: number;
    fsrsParams4: number[];
    fsrsParams5: number[];
    fsrsParams6: number[];
  }[];
  notetypes: {
    id: number;
    name: string;
    type: number;
    css: string;
    sortf: number;
    latexPre: string;
    latexPost: string;
    fields: string[];
    templates: { name: string; qfmt: string; afmt: string }[];
  }[];
  notes: { id: number; guid: string; notetype: string; fields: Record<string, string>; tags: string[] }[];
  cards: ExpectedCard[];
  revlog: number[][];
  media: Record<string, { size: number; sha1: string }>;
}

export function expected(name: string): Expected {
  return JSON.parse(readFileSync(join(FIXTURES, "expected", name), "utf8")) as Expected;
}

export function manifest(): { now: number; packages: Record<string, { options: Record<string, unknown> }> } {
  return JSON.parse(readFileSync(join(FIXTURES, "expected", "manifest.json"), "utf8"));
}

const cache = new Map<string, Promise<AnkiPackage>>();

export function loadPackage(name: string): Promise<AnkiPackage> {
  let p = cache.get(name);
  if (!p) {
    const bytes = new Uint8Array(readFileSync(join(FIXTURES, "apkg", name)));
    p = readAnkiPackage(bytes);
    cache.set(name, p);
  }
  return p;
}

export function sha1(data: Uint8Array): string {
  return createHash("sha1").update(data).digest("hex");
}
