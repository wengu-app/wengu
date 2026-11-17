// The app's worker file is just `import "@wengu/core/worker"`. The harness adds diagnostics on top.
import { currentEngine } from "../../src/worker/worker.js";

self.addEventListener("message", (ev: MessageEvent) => {
  const m = ev.data as { t?: string; op?: string; sql?: string; n?: number };
  if (m.t !== "bench") return;
  const e = currentEngine();
  if (!e) return void self.postMessage({ t: "bench-result", error: "not open" });
  if (m.op === "uncommitted") {
    // Force dirty database pages out of SQLite's cache, then let the page terminate this worker.
    e.db.exec("PRAGMA cache_size = 4; BEGIN IMMEDIATE; UPDATE review_items SET reps = reps + 1000;");
    return void self.postMessage({ t: "bench-result", value: true });
  }
  if (m.op === "timings") return void self.postMessage({ t: "bench-result", value: e.answerTimings.splice(0) });
  if (m.op === "pragma") {
    e.db.exec(m.sql!);
    return void self.postMessage({ t: "bench-result", value: e.db.value(m.sql!.replace(/=.*$/, "").replace(/;$/, "")) ?? null });
  }
  if (m.op === "pages") {
    // write transactions that modify n distinct pages each: per-page cost of the rollback journal
    e.db.exec("CREATE TABLE IF NOT EXISTS bench_pages (id INTEGER PRIMARY KEY, pad)");
    e.db.transaction(() => {
      for (let i = 0; i < 64; i++) e.db.run("INSERT OR REPLACE INTO bench_pages VALUES (?, zeroblob(6000))", [i]);
    });
    const out: Record<number, number> = {};
    for (const n of [1, 4, 8, 16, 32]) {
      const times: number[] = [];
      for (let k = 0; k < 15; k++) {
        const t = performance.now();
        e.db.transaction(() => {
          for (let i = 0; i < n; i++) e.db.run("UPDATE bench_pages SET pad = zeroblob(6000 + ?) WHERE id = ?", [k % 2, i]);
        });
        times.push(performance.now() - t);
      }
      out[n] = times.sort((a, b) => a - b)[7]!;
    }
    e.db.exec("DROP TABLE bench_pages");
    return void self.postMessage({ t: "bench-result", value: out });
  }
  if (m.op === "commit") {
    // n tiny write transactions (one row each): the fixed cost of a durable commit
    const times: number[] = [];
    e.db.exec("CREATE TABLE IF NOT EXISTS bench_commit (x)");
    for (let i = 0; i < (m.n ?? 50); i++) {
      const t = performance.now();
      e.db.transaction(() => e.db.run("INSERT INTO bench_commit VALUES (?)", [i]));
      times.push(performance.now() - t);
    }
    e.db.exec("DROP TABLE bench_commit");
    return void self.postMessage({ t: "bench-result", value: times });
  }
});
