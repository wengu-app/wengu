/**
 * Regression guard for browse search: every combination of text × deck × tag × state × sort on a synthetic
 * 20,000-note collection must finish well within a generous bound. (Before the fix, a text query combined with a
 * state filter took minutes at 50k notes: the item subquery used the (queue, due) index and scanned every
 * matching item for every text match.) Full 50k numbers: bench/search-combinations.bench.test.ts.
 */
import { beforeAll, expect, it } from "vitest";

import { combinations } from "../bench/search-cases.js";
import { syntheticPackage } from "../bench/synthetic.js";
import type { Engine } from "../src/engine/engine.js";
import { ManualClock, openNodeEngine } from "../src/node.js";

const NOW = 1_767_607_200_000;
let e: Engine;

beforeAll(async () => {
  e = await openNodeEngine({ clock: new ManualClock(NOW, 0) });
  await e.importAnki(syntheticPackage({ notes: 20_000, nowSecs: NOW / 1000 }));
}, 120_000);

it("every filter combination answers within 1.5 s", () => {
  const top = e.deckIdByName("Subject 0")!;
  const leaf = e.deckIdByName("Subject 1::Topic 2::Part")!;
  const slow: string[] = [];
  for (const [name, q] of combinations(top, leaf, e.listNoteTypes()[0]!.id)) {
    const t = performance.now();
    e.search(q, { timeoutMs: 30_000 });
    const ms = performance.now() - t;
    if (ms > 1500) slow.push(`${name}: ${ms.toFixed(0)} ms`);
  }
  expect(slow).toEqual([]);
}, 600_000);

it("a query over its time budget is stopped and the engine stays usable", () => {
  let err: unknown;
  try {
    e.search({ text: "theorem" }, { timeoutMs: 0 });
  } catch (x) {
    err = x;
  }
  expect((err as Error).name).toBe("QueryTimeout");
  expect(e.search({ text: "theorem", limit: 5 }).rows).toHaveLength(5);
});
