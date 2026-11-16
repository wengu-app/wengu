/**
 * A synthetic Anki collection for benchmarks: by default 50,000 notes (Basic and reversed: 100,000 cards) in a
 * 3-level deck tree, about 500,000 review-log rows, FSRS memory states on reviewed cards.
 */
import type { AnkiPackage, Card, Deck, Note, RevlogEntry } from "@wengu/anki";

import { defaultPreset, newDeck, stockNoteType } from "../src/engine/defaults.js";

export interface SyntheticOptions {
  notes?: number;
  /** Review-log rows per reviewed card (average). */
  reviewsPerCard?: number;
  /** "Now" of the collection, unix seconds. */
  nowSecs?: number;
  seed?: number;
}

const WORDS = ["memory", "spaced", "repetition", "温故", "知新", "学而时习之", "photosynthesis", "mitochondria", "integral", "derivative", "猫", "犬", "ありがとう", "Paris", "capital", "theorem", "entropy", "vector", "matrix", "電車"];

export function syntheticPackage(opts: SyntheticOptions = {}): AnkiPackage {
  const N = opts.notes ?? 50_000;
  const perCard = opts.reviewsPerCard ?? 9;
  const nowSecs = opts.nowSecs ?? 1_767_607_200; // 2026-01-05 10:00 UTC
  let seed = opts.seed ?? 42;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x80000000;
  };
  const pick = <T>(a: readonly T[]) => a[Math.floor(rnd() * a.length)]!;

  const crt = nowSecs - 1000 * 86400 - ((nowSecs - 4 * 3600) % 86400); // ~1000 days ago, at 04:00 UTC
  const today = Math.floor((nowSecs - crt) / 86400);
  const nt = stockNoteType("basic-reversed", 1_600_000_000_000, 0);
  const preset = defaultPreset(1, "Default", 0);
  preset.newPerDay = 20;
  preset.reviewsPerDay = 9999;

  const decks: Deck[] = [newDeck(1, "Default", 1, 0)];
  const leaves: number[] = [];
  let did = 1_600_000_000_100;
  for (let a = 0; a < 4; a++) {
    const top = did++;
    decks.push(newDeck(top, `Subject ${a}`, 1, 0));
    for (let b = 0; b < 4; b++) {
      const mid = did++;
      decks.push(newDeck(mid, `Subject ${a}::Topic ${b}`, 1, 0));
      leaves.push(mid);
      const leaf = did++;
      decks.push(newDeck(leaf, `Subject ${a}::Topic ${b}::Part`, 1, 0));
      leaves.push(leaf);
    }
  }
  for (const d of decks) d.usn = 0;

  const notes: Note[] = [];
  const cards: Card[] = [];
  const revlog: RevlogEntry[] = [];
  let revId = (crt + 86400) * 1000;
  const baseId = 1_610_000_000_000;
  for (let i = 0; i < N; i++) {
    const id = baseId + i * 10;
    const front = `${pick(WORDS)} ${pick(WORDS)} <b>${i}</b> ${pick(WORDS)}`;
    const back = `${pick(WORDS)} — answer ${i} ${pick(WORDS)} ${pick(WORDS)}`;
    notes.push({
      id,
      guid: `g${i.toString(36)}`,
      notetypeId: nt.id,
      mtime: Math.floor(id / 1000),
      usn: 0,
      tags: [pick(["vocab", "grammar", "science::bio", "science::chem", "math"]), ...(rnd() < 0.1 ? ["marked"] : [])],
      fields: [front, back],
      sortField: front.replace(/<[^>]+>/g, ""),
      checksum: i,
      flags: 0,
      data: "",
    });
    const deckId = pick(leaves);
    for (let ord = 0; ord < 2; ord++) {
      const cid = id + ord;
      const r = rnd();
      let card: Card;
      const base = { id: cid, noteId: id, deckId, ord, mtime: Math.floor(cid / 1000), usn: 0, originalDue: 0, originalDeckId: 0, flags: 0 };
      if (r < 0.4) {
        card = { ...base, type: 0, queue: 0, due: i, interval: 0, easeFactor: 0, reps: 0, lapses: 0, left: 0, data: emptyData(), rawData: "{}" };
      } else {
        const ivl = Math.max(1, Math.floor(rnd() * rnd() * 400));
        // ~2% of review cards due today or overdue
        const due = rnd() < 0.03 ? today - Math.floor(rnd() * 5) : today + 1 + Math.floor(rnd() * ivl);
        const reps = 2 + Math.floor(rnd() * perCard * 2 - 2);
        const lrt = nowSecs - (ivl - (due - today)) * 86400;
        const s = Math.max(0.5, ivl * (0.8 + rnd() * 0.4));
        const d = 1 + rnd() * 9;
        const learning = r > 0.97;
        const rawData = JSON.stringify({ pos: i, s: round(s, 4), d: round(d, 3), dr: 0.9, decay: 0.1542, lrt });
        card = learning
          ? { ...base, type: 3, queue: 1, due: nowSecs + Math.floor(rnd() * 3000) - 1500, interval: ivl, easeFactor: 2300, reps, lapses: 1, left: 1, data: emptyData(), rawData }
          : { ...base, type: 2, queue: 2, due, interval: ivl, easeFactor: 2500, reps, lapses: Math.floor(rnd() * 2), left: 0, data: emptyData(), rawData };
        for (let k = 0; k < reps; k++) {
          revId += 1 + Math.floor(rnd() * 400);
          revlog.push({ id: revId, cardId: cid, usn: 0, ease: rnd() < 0.1 ? 1 : 3, interval: k === 0 ? -600 : ivl, lastInterval: k === 0 ? 0 : ivl, factor: 500, taken: 4000, kind: k === 0 ? 0 : 1 });
        }
      }
      cards.push(card);
    }
  }
  revlog.sort((a, b) => a.id - b.id);
  return {
    format: { metaVersion: 3, collectionEntry: "collection.anki21b", schemaVersion: 18, zstdCollection: true, mediaManifest: "protobuf" },
    collection: { crt, mod: nowSecs * 1000, scm: nowSecs * 1000, usn: 0, ls: 0, config: { collapseTime: 1200, nextPos: N } },
    notetypes: [nt],
    notes,
    cards,
    decks,
    deckConfigs: [preset],
    revlog,
    media: [],
    tags: ["vocab", "grammar", "science::bio", "science::chem", "math", "marked"].map((name) => ({ name, usn: 0, collapsed: false })),
    warnings: [],
  };
}

function emptyData() {
  return { originalPosition: null, memoryState: null, desiredRetention: null, decay: null, lastReviewTime: null, customData: null, extra: {} };
}

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;
