/**
 * Browse search: combinations of filters (text × deck × tag × state × note type × sort) on the 50k collection.
 * Prints a table, and with SEARCH_PLANS=1 the query plans.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { it } from "vitest";

import { searchSql } from "../src/engine/browse.js";
import { combinations } from "./search-cases.js";
import { ManualClock, openNodeEngine } from "../src/node.js";
import { syntheticPackage } from "./synthetic.js";

const NOW = 1_767_607_200_000;

it("search filter combinations", async () => {
  // Optionally reuse a caller-supplied database; otherwise keep the benchmark entirely in memory.
  const file = process.env["BENCH_DB"];
  const clock = new ManualClock(NOW, 0);
  let e;
  if (file && existsSync(file)) e = await openNodeEngine({ clock, bytes: new Uint8Array(readFileSync(file)) });
  else {
    e = await openNodeEngine({ clock });
    await e.importAnki(syntheticPackage({ nowSecs: NOW / 1000 }));
    if (file) writeFileSync(file, e.db.exportBytes());
  }
  const top = e.deckIdByName("Subject 0")!;
  const leaf = e.deckIdByName("Subject 1::Topic 2::Part")!;
  const nt = e.listNoteTypes()[0]!.id;
  const rows: [string, number, number][] = [];
  const budget = Number(process.env["SEARCH_BUDGET_MS"] ?? 1e9);
  const only = process.env["SEARCH_ONLY"] ? new RegExp(process.env["SEARCH_ONLY"]) : null;
  for (const [name, q] of combinations(top, leaf, nt)) {
    if (only && !only.test(name)) continue;
    if (process.env["SEARCH_PLANS"]) {
      const { whereSql, params, order } = searchSql(e, q);
      const plan = e.db.all<{ detail: string }>(`EXPLAIN QUERY PLAN SELECT k.id FROM knowledge_points k ${whereSql} ORDER BY ${order} LIMIT 50`, params);
      console.log(name, "\n   ", plan.map((p) => p.detail).join(" | "));
    }
    const t = performance.now();
    let total = -1;
    try {
      total = e.search(q, { timeoutMs: 5000 }).total;
    } catch (err) {
      if ((err as Error).name !== "QueryTimeout") throw err;
    }
    const ms = performance.now() - t;
    rows.push([name, ms, total]);
    if (ms > budget) console.log(`SLOW ${ms.toFixed(0)} ms: ${name}`);
  }
  console.log(`over 1 s: ${rows.filter((r) => r[1] > 1000).length}, stopped at the 5 s limit: ${rows.filter((r) => r[2] === -1).length}`);
  rows.sort((a, b) => b[1] - a[1]);
  console.log(`${rows.length} combinations; slowest 15:`);
  for (const [n, ms, total] of rows.slice(0, 15)) console.log(`| ${n} | ${ms.toFixed(1)} | ${total} |`);
  const sorted = rows.map((r) => r[1]).sort((a, b) => a - b);
  console.log(`median ${sorted[Math.floor(sorted.length / 2)]!.toFixed(1)} ms, p95 ${sorted[Math.floor(sorted.length * 0.95)]!.toFixed(1)} ms, max ${sorted[sorted.length - 1]!.toFixed(1)} ms`);
}, 3_600_000);
