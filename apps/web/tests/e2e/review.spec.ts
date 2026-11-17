import { expect, test, type Page } from "@playwright/test";
import { cardFrame, importFixture, openApp, reveal, waitSide } from "./helpers.ts";

/** The card the app shows must be the one core says is next; returns core's labels for it. */
async function coreLabels(page: Page) {
  return page.evaluate(async () => {
    const s = await window.__wenguDb!.study(null);
    const o = s.card!.schedule.outcomes;
    return { id: s.card!.item.id, labels: [o.again.label, o.hard.label, o.good.label, o.easy.label] };
  });
}
const revlog = (page: Page) => page.evaluate(async () => (await window.__wenguDb!.info()).counts.reviewLog);
const questionText = async (page: Page) => (await cardFrame(page).locator("#qa").innerText()).trim();

test("review: reveal, rate with keys, labels from core, undo", async ({ page }) => {
  await openApp(page);
  await importFixture(page, "full-latest.apkg", false);
  await page.getByRole("button", { name: "Start reviewing" }).click();
  await page.getByRole("button", { name: "Study all decks" }).click();

  const before = await revlog(page);
  const ratings = ["3", "1", "4", "2", "3", "3"];
  let lastText = "";
  for (const key of ratings) {
    await waitSide(page, "question");
    lastText = await questionText(page);
    const core = await coreLabels(page);
    await reveal(page, "thank yuo");
    const shown = await Promise.all(["again", "hard", "good", "easy"].map((n) => page.getByTestId(`ivl-${n}`).innerText()));
    expect(shown).toEqual(core.labels);
    await page.keyboard.press(key);
  }
  await waitSide(page, "question");
  expect(await revlog(page)).toBe(before + ratings.length);

  // Undo the last answer (Good): that card comes back and its review leaves the log.
  await page.keyboard.press("z");
  await expect(page.getByText("Undone: answer (Good)")).toBeVisible();
  await expect.poll(() => questionText(page)).toBe(lastText);
  expect(await revlog(page)).toBe(before + ratings.length - 1);
  // Ctrl+Z works too.
  await page.keyboard.press("Control+z");
  await expect(page.getByText("Undone: answer (Good)").last()).toBeVisible();
  expect(await revlog(page)).toBe(before + ratings.length - 2);
});

test("review: type-in comparison, why panel, flag, suspend, bury, done state", async ({ page }) => {
  await openApp(page);
  await importFixture(page, "full-latest.apkg");
  await page.goto("./#/review");
  const count = (state: string) => page.evaluate(async (state) => (await window.__wenguDb!.search({ state: state as "flagged" })).total, state);
  const flagged0 = await count("flagged");
  const suspended0 = await count("suspended");
  let sawType = false;
  let buried = false;
  for (let i = 0; i < 60; i++) {
    if ((await page.getByTestId("review").getAttribute("data-phase")) === "done") break;
    await waitSide(page, "question");
    if (!buried && i === 2) {
      await page.keyboard.press("-");
      await expect(page.getByText("Card buried until tomorrow")).toBeVisible();
      buried = true;
      await page.waitForTimeout(100);
      continue;
    }
    const hadBox = await reveal(page, "thank yuo");
    if (hadBox && !sawType) {
      const result = cardFrame(page).locator("#qa .wg-typeans-result");
      await expect(result.locator(".typeBad")).toHaveText("u");
      await expect(result.locator(".typeMissed")).toHaveText("u");
      sawType = true;
      await page.keyboard.press("i");
      await expect(page.getByTestId("why-panel")).toBeVisible();
      await expect(page.getByTestId("why-panel").locator("tbody tr")).toHaveCount(4);
      await page.keyboard.press("i");
      await page.keyboard.press("Control+2");
      await expect(page.getByText("Flag set")).toBeVisible();
      await expect.poll(() => count("flagged")).toBe(flagged0 + 1);
      await page.keyboard.press("@");
      await expect(page.getByText("Card suspended")).toBeVisible();
      await expect.poll(() => count("suspended")).toBe(suspended0 + 1);
      await page.waitForTimeout(100);
      continue;
    }
    await page.keyboard.press("4");
    await expect(page.getByTestId("review")).not.toHaveAttribute("data-phase", "answer");
  }
  expect(sawType).toBe(true);
  await expect(page.getByTestId("done")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("That is all for today.")).toBeVisible();
});

test("latency: rating a card until the next one is painted", async ({ page }) => {
  await openApp(page);
  await importFixture(page, "full-latest.apkg");
  await page.goto("./#/review");
  const ratings = ["1", "3", "3", "2", "1", "3"];
  for (let i = 0; i < 60; i++) {
    if ((await page.getByTestId("review").getAttribute("data-phase")) === "done") break;
    await reveal(page);
    await page.keyboard.press(ratings[i % ratings.length]!);
    await expect(page.getByTestId("review")).not.toHaveAttribute("data-phase", "answer");
  }
  await page.waitForTimeout(200);
  const lat = await page.evaluate(() => window.__wenguPerf!.answerToNext);
  const rpc = await page.evaluate(() => window.__wenguPerf!.answerRpc);
  const rs = [...rpc].sort((a, b) => a - b);
  console.log(`  of which core answer() round trip: median ${Math.round(rs[Math.floor(rs.length / 2)]!)} ms, p95 ${Math.round(rs[Math.floor(rs.length * 0.95)]!)} ms`);
  const sorted = [...lat].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
  const summary = { n: lat.length, median: Math.round(q(0.5)), p95: Math.round(q(0.95)), max: Math.round(sorted[sorted.length - 1]!), all: lat.map((x) => Math.round(x)) };
  console.log("answer->next latency, 14-note fixture (ms):", JSON.stringify(summary));
  expect(lat.length).toBeGreaterThan(15);
  expect(summary.p95).toBeLessThan(100);
});
