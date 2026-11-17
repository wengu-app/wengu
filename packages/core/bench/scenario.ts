/**
 * The benchmark scenario, run against anything with the client's async API: the engine directly (Node) or the
 * worker client (browser, so the numbers include the message round trip the UI sees).
 */
import type { AnkiPackage } from "@wengu/anki";

import type { BrowseQuery, DeckNode, ImportResult, Rating, StudyState, Stats } from "../src/types.js";

export interface BenchApi {
  importAnki(pkg: AnkiPackage): Promise<ImportResult>;
  deckTree(): Promise<DeckNode[]>;
  study(deckId: number | null): Promise<StudyState>;
  answer(input: { itemId: number; rating: Rating; takenMs: number; deckId?: number | null }): Promise<StudyState>;
  undo(): Promise<unknown>;
  search(q: BrowseQuery): Promise<{ total: number }>;
  stats(): Promise<Stats>;
  exportAnki(): Promise<AnkiPackage>;
  exportApkg?(): Promise<Uint8Array>;
  info(): Promise<{ counts: Record<string, number> }>;
}

export interface BenchRow {
  name: string;
  n: number;
  median: number;
  p95: number;
  max: number;
  note?: string;
}

const now = () => performance.now();

async function measure(name: string, n: number, fn: (i: number) => Promise<unknown>, note?: string): Promise<BenchRow> {
  const t: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = now();
    await fn(i);
    t.push(now() - s);
  }
  return summarise(name, t, note);
}

function summarise(name: string, t: number[], note?: string): BenchRow {
  const n = t.length;
  const sorted = [...t].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
  return { name, n, median: q(0.5), p95: q(0.95), max: sorted[sorted.length - 1]!, ...(note ? { note } : {}) };
}

export async function runScenario(api: BenchApi, pkg: AnkiPackage, log: (s: string) => void = () => {}): Promise<BenchRow[]> {
  const rows: BenchRow[] = [];
  const add = (r: BenchRow) => {
    rows.push(r);
    log(`${r.name}: median ${r.median.toFixed(1)} ms, p95 ${r.p95.toFixed(1)}, max ${r.max.toFixed(1)} (n=${r.n})`);
  };
  add(await measure("import AnkiPackage (50k notes / 100k items / ~500k revlog)", 1, () => api.importAnki(pkg)));
  const info = await api.info();
  log(`collection: ${JSON.stringify(info.counts)}`);

  add(await measure("deck tree with counts", 10, () => api.deckTree()));
  const tree = await api.deckTree();
  const top = tree.find((d) => d.name.startsWith("Subject 0"))!;
  log(`deck "${top.name}": counts ${JSON.stringify(top.counts)}, ${top.totalItems} items`);
  add(await measure("study(deck): counts + next card", 20, () => api.study(top.id)));
  add(await measure("study(whole collection)", 10, () => api.study(null)));

  // answer + next card: the reviewer's critical path
  let state = await api.study(top.id);
  const ratings: Rating[] = [3, 3, 1, 4, 3, 2, 3, 3];
  const kinds: Record<string, number> = {};
  const answerTimes: number[] = [];
  for (let i = 0; i < 300 && state.card; i++) {
    kinds[state.card.item.state] = (kinds[state.card.item.state] ?? 0) + 1;
    const s = now();
    state = await api.answer({ itemId: state.card.item.id, rating: ratings[i % ratings.length]!, takenMs: 5000, deckId: top.id });
    answerTimes.push(now() - s);
  }
  add(summarise("answer + next card (deck)", answerTimes));
  log(`answered item states: ${JSON.stringify(kinds)}`);
  add(await measure("undo last answer", 5, () => api.undo()));

  const searches: [string, BrowseQuery][] = [
    ["search: text ≥3 chars (FTS trigram)", { text: "mitochondria" }],
    ["search: text 1 CJK char (scan)", { text: "猫" }],
    ["search: text 2 CJK chars (scan)", { text: "知新" }],
    ["search: two words", { text: "memory entropy" }],
    ["search: tag with children", { tags: ["science"] }],
    ["search: deck subtree + due", { deckId: top.id, state: "due" }],
    ["search: deck + text", { deckId: top.id, text: "theorem" }],
    ["search: all, sort by sort field, page 100", { sort: { by: "sortField" }, offset: 5000, limit: 50 }],
    ["search: suspended", { state: "suspended" }],
  ];
  // First call of each query (nothing cached), then the next page of the same query (total is cached).
  for (const [name, q] of searches) {
    let total = 0;
    add(await measure(name, 1, async () => (total = (await api.search(q)).total)));
    rows[rows.length - 1]!.note = `${total} matches`;
  }
  add(await measure("search: next page of a text search", 5, (i) => api.search({ text: "theorem", offset: 50 * (i + 1) })));
  add(await measure("statistics", 5, () => api.stats()));
  add(await measure("export whole collection to AnkiPackage", 1, () => api.exportAnki()));
  if (api.exportApkg) {
    let size = 0;
    add(await measure("export whole collection to .apkg bytes", 1, async () => (size = (await api.exportApkg!()).byteLength)));
    rows[rows.length - 1]!.note = `${(size / 1e6).toFixed(1)} MB`;
  }
  return rows;
}

export function formatRows(rows: BenchRow[]): string {
  const lines = ["| operation | n | median ms | p95 ms | max ms | note |", "|---|---:|---:|---:|---:|---|"];
  for (const r of rows) lines.push(`| ${r.name} | ${r.n} | ${r.median.toFixed(1)} | ${r.p95.toFixed(1)} | ${r.max.toFixed(1)} | ${r.note ?? ""} |`);
  return lines.join("\n");
}
