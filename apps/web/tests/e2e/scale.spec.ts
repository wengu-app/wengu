/**
 * 50,000 notes (100,000 cards, ~450,000 reviews): browse stays smooth, search is fast, answering stays under 100 ms.
 * The synthetic collection comes from @wengu/core's benchmark generator and is cached under .cache/.
 */
import { expect, test } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeAnkiPackage } from "@wengu/anki";
import { syntheticPackage } from "../../../../packages/core/bench/synthetic.ts";
import { importFixture, openApp, reveal } from "./helpers.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.resolve(here, "../../.cache/synthetic-50k.apkg");

test.setTimeout(900_000);

test("50k notes: import, virtual list, search, answer latency", async ({ page }) => {
  if (!existsSync(CACHE)) {
    mkdirSync(path.dirname(CACHE), { recursive: true });
    const nowSecs = Math.floor(Date.now() / 1000);
    writeFileSync(CACHE, await writeAnkiPackage(syntheticPackage({ notes: 50_000, nowSecs })));
  }
  await openApp(page);
  const t0 = Date.now();
  await importFixture(page, { name: "synthetic-50k.apkg", mimeType: "application/octet-stream", buffer: readFileSync(CACHE) });
  console.log(`import of 50k notes: ${((Date.now() - t0) / 1000).toFixed(1)} s`);

  await page.goto("./#/browse");
  await expect(page.getByTestId("browse-count")).toHaveAttribute("data-total", "50000");
  // Scroll the whole list in steps and record frame intervals.
  const frames = await page.evaluate(async () => {
    const list = document.querySelector(".vlist") as HTMLElement;
    const deltas: number[] = [];
    let last = performance.now();
    const step = list.scrollHeight / 120;
    for (let i = 0; i < 120; i++) {
      list.scrollTop = step * i;
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const now = performance.now();
      deltas.push(now - last);
      last = now;
    }
    return { deltas, rowsInDom: list.querySelectorAll(".vrow").length };
  });
  const sorted = [...frames.deltas].sort((a, b) => a - b);
  console.log(`list scroll: rows in DOM ${frames.rowsInDom}; frame interval median ${sorted[60]!.toFixed(1)} ms, p95 ${sorted[114]!.toFixed(1)} ms, max ${sorted[119]!.toFixed(1)} ms`);
  expect(frames.rowsInDom).toBeLessThan(60);
  await page.locator(".vlist").evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect(page.getByTestId("browse-row").last()).toBeVisible();
  await page.getByTestId("browse-row").last().click();
  await expect(page.getByTestId("note-editor")).toBeVisible();

  // Search: time from typing to the count updating (includes the 150 ms debounce).
  const s0 = Date.now();
  await page.getByTestId("browse-search").fill("mitochondria entropy");
  await expect(page.getByTestId("browse-count")).not.toHaveAttribute("data-total", "50000");
  console.log(`search "mitochondria entropy": ${Date.now() - s0} ms to results incl. 150 ms debounce; ${await page.getByTestId("browse-count").innerText()}`);
  // Core regression tests and benchmarks cover combinations of text, state, deck and tag filters.
  await page.getByTestId("browse-search").fill("");
  await expect(page.getByTestId("browse-count")).toHaveAttribute("data-total", "50000");
  const s1 = Date.now();
  await page.getByTestId("filter-state").selectOption("review");
  await expect(page.getByTestId("browse-count")).not.toHaveAttribute("data-total", "50000");
  console.log(`state filter "review": ${Date.now() - s1} ms; ${await page.getByTestId("browse-count").innerText()}`);

  // Answer latency on the big collection.
  const studyMs = await page.evaluate(async () => {
    const out: number[] = [];
    for (let i = 0; i < 3; i++) {
      const t = performance.now();
      await window.__wenguDb!.study(null);
      out.push(Math.round(performance.now() - t));
    }
    return out;
  });
  console.log(`study(whole collection) round trips: ${studyMs.join(", ")} ms`);
  await page.goto("./#/review");
  await expect(page.getByTestId("review")).toHaveAttribute("data-phase", "question", { timeout: 60_000 });
  for (let i = 0; i < 25; i++) {
    await reveal(page);
    await page.keyboard.press(i % 4 === 0 ? "1" : "3");
  }
  await page.waitForTimeout(300);
  const lat = await page.evaluate(() => window.__wenguPerf!.answerToNext);
  const rpc = await page.evaluate(() => window.__wenguPerf!.answerRpc);
  const rs = [...rpc].sort((a, b) => a - b);
  console.log(`  of which core answer() round trip: median ${Math.round(rs[Math.floor(rs.length / 2)]!)} ms, p95 ${Math.round(rs[Math.floor(rs.length * 0.95)]!)} ms`);
  const ls = [...lat].sort((a, b) => a - b);
  const q = (p: number) => Math.round(ls[Math.min(ls.length - 1, Math.floor(p * ls.length))]!);
  console.log(`answer->next latency, 50k notes (ms): ${JSON.stringify({ n: lat.length, median: q(0.5), p95: q(0.95), max: q(1), all: lat.map(Math.round) })}`);
  expect(q(0.95)).toBeLessThan(100);
});
