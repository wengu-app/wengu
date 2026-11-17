#!/usr/bin/env node
/**
 * Builds the browser harness with esbuild, serves it (no COOP/COEP headers, on purpose), and drives headless
 * Chromium with Playwright.
 *
 *   node bench/browser/run.mjs --test        functional checks: OPFS persistence across worker restarts and page
 *                                            reloads, undo after reopen, media blobs, one-tab lock
 *   node bench/browser/run.mjs [--notes N] [--backlog-days D]   benchmark through the worker client
 *                                            (D > 0: the collection was last studied D days ago — a big backlog)
 */
import { copyFileSync, mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import { build } from "esbuild";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "../..");
const require = createRequire(import.meta.url);
const out = process.env.BROWSER_OUT ?? join(pkgRoot, "node_modules", ".cache", "browser-harness");
const PORT = Number(process.env.PORT ?? 5291);
const args = process.argv.slice(2);
const testMode = args.includes("--test");
const notes = args.includes("--notes") ? Number(args[args.indexOf("--notes") + 1]) : 50000;
const backlogDays = args.includes("--backlog-days") ? Number(args[args.indexOf("--backlog-days") + 1]) : 0;

mkdirSync(join(out, "fixtures"), { recursive: true });
await build({
  entryPoints: { page: join(here, "page.ts"), worker: join(here, "worker.ts") },
  outdir: out,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "chrome120",
  sourcemap: true,
  logLevel: "warning",
});
const wasm = join(dirname(require.resolve("@sqlite.org/sqlite-wasm/package.json")), "dist", "sqlite3.wasm");
copyFileSync(wasm, join(out, "sqlite3.wasm"));
copyFileSync(join(pkgRoot, "..", "anki", "fixtures", "apkg", "full-latest.apkg"), join(out, "fixtures", "full-latest.apkg"));
writeFileSync(join(out, "index.html"), `<!doctype html><meta charset="utf-8"><title>wengu core</title><script type="module" src="./page.js"></script>`);

const MIME = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm", ".map": "application/json", ".apkg": "application/octet-stream" };
const server = createServer((req, res) => {
  const path = join(out, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!path.startsWith(out) || !existsSync(path)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" });
  res.end(readFileSync(path));
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
const base = `http://localhost:${PORT}/index.html`;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
let failed = false;

async function run(page, query, timeout = 600_000) {
  await page.goto(`${base}?${query}`);
  await page.waitForFunction(() => window.__result !== undefined || window.__error !== undefined, null, { timeout, polling: 200 });
  const { result, error } = await page.evaluate(() => ({ result: window.__result, error: window.__error }));
  if (error) throw new Error(`${query}: ${error}`);
  return result;
}

function check(name, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
  if (!ok) failed = true;
}

try {
  if (testMode) {
    const page = await context.newPage();
    page.on("console", (m) => m.type() === "error" && console.log("[page error]", m.text()));
    await run(page, "step=wipe");
    const a = await run(page, "step=import");
    check("not cross-origin isolated (no COOP/COEP needed)", a.crossOriginIsolated === false, a.crossOriginIsolated);
    check("storage backend is OPFS SAH pool", a.info.storage === "opfs-sahpool", a.info.storage);
    check("import through the worker", a.import.knowledgePoints.added === 14 && a.import.reviewLog.added === 61, a.import.knowledgePoints);
    check("progress events reached the page", a.phases.includes("knowledge-points") && a.phases.includes("finishing"), a.phases);
    check("answer recorded", a.undoLabel === "Answer good", a.undoLabel);
    check("media blob from OPFS decodes as an image", a.imageSize[0] > 0, a.imageSize);
    check("exportApkg returns .apkg bytes; exportApkgFile an OPFS-backed File", a.export.isUint8Array && a.export.zip && a.export.isFile && a.export.bytes > 1000 && a.export.file > 1000, a.export);
    const b = await run(page, "step=check");
    check("persists across worker restart (review log)", b.revlog === 62, b.revlog);
    check("undo stack persists across worker restart", b.undoLabel === "Answer good", b.undoLabel);
    check("media persists", b.catSize > 0, b.catSize);
    await page.reload();
    const c = await run(page, "step=undo");
    check("undo after page reload", c.undo?.label === "Answer good" && c.revlog === 61, c);
    const d = await run(page, "step=check");
    check("undo persisted", d.revlog === 61 && d.undoLabel === null, d);
    // one tab at a time
    const holder = await context.newPage();
    await run(holder, "step=hold");
    const other = await context.newPage();
    let lockError = "";
    try {
      await run(other, "step=check");
    } catch (e) {
      lockError = String(e);
    }
    check("a second tab gets a clear error while the first holds the database", /already open in another tab/.test(lockError), lockError.split("\n")[0]);
    await holder.close();
    const e = await run(other, "step=check");
    check("after the first tab closes, the second can open", e.revlog === 61, e.revlog);
  } else {
    const page = await context.newPage();
    page.on("console", (m) => console.log("[page]", m.text()));
    const r = await run(page, `mode=bench&notes=${notes}&backlogDays=${backlogDays}`, 1_800_000);
    console.log(`\nChromium (headless) ${r.ua}, ${r.cores} threads, OPFS SAH pool, through the worker client:\n`);
    console.log(r.table);
    console.log(`\nanswer() inside the worker (medians, ms): ${JSON.stringify(r.answerBreakdown)}`);
    console.log(`one-row write transaction (median ms): ${JSON.stringify(r.commits)}`);
    console.log(`write transaction modifying n distinct pages (median ms): ${JSON.stringify(r.pages)}`);
    console.log(`\nreopen 50k collection from OPFS (worker start + SQLite init + open): ${r.reopenMs.toFixed(0)} ms; first study() after reopen: ${r.firstStudyAfterReopenMs.toFixed(0)} ms; origin storage used: ${r.storageUsageMB.toFixed(1)} MB`);
    if (process.env.BENCH_OUT) writeFileSync(process.env.BENCH_OUT, JSON.stringify(r, null, 1));
  }
} catch (e) {
  console.error(e);
  failed = true;
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
