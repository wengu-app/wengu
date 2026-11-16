import { writeFileSync } from "node:fs";
import os from "node:os";

import { it } from "vitest";

import { ManualClock, openNodeEngine } from "../src/node.js";
import { formatRows, runScenario } from "./scenario.js";
import type { BenchApi } from "./scenario.js";
import { syntheticPackage } from "./synthetic.js";

it("benchmark (Node, in-memory SQLite WASM)", async () => {
  const t0 = performance.now();
  const nowMs = 1_767_607_200_000;
  const backlogDays = Number(process.env["BENCH_BACKLOG_DAYS"] ?? 0);
  const pkg = syntheticPackage({ notes: Number(process.env["BENCH_NOTES"] ?? 50_000), nowSecs: nowMs / 1000 - backlogDays * 86400 });
  console.log(`generated ${pkg.notes.length} notes, ${pkg.cards.length} cards, ${pkg.revlog.length} revlog in ${(performance.now() - t0).toFixed(0)} ms`);
  const clock = new ManualClock(nowMs, 0);
  const engine = await openNodeEngine({ clock });
  // Advance the clock a little on every call so answers get distinct times, as in real use.
  const tick = <T>(fn: () => T) => {
    clock.advance(2000);
    return Promise.resolve(fn());
  };
  const api: BenchApi = {
    importAnki: (p) => engine.importAnki(p),
    deckTree: () => tick(() => engine.deckTree()),
    study: (d) => tick(() => engine.study(d)),
    answer: (a) => tick(() => engine.answer(a)),
    undo: () => tick(() => engine.undo()),
    search: (q) => tick(() => engine.search(q)),
    stats: () => tick(() => engine.stats()),
    exportAnki: () => engine.exportAnki(),
    info: () => tick(() => engine.info()),
  };
  const rows = await runScenario(api, pkg, (s) => console.log(s));
  const env = `Node ${process.version}, ${os.cpus()[0]?.model} (${os.cpus().length} threads), SQLite ${engine.info().sqliteVersion} WASM, in-memory`;
  const out = `Environment: ${env}\n\n${formatRows(rows)}\n`;
  console.log(out);
  if (process.env["BENCH_OUT"]) writeFileSync(process.env["BENCH_OUT"], out);
});
