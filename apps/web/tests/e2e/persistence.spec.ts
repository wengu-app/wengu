import { expect, test } from "@playwright/test";
import { importFixture, openApp, reveal, waitSide } from "./helpers.ts";

test("collection, reviews and settings persist across reload; a second tab gets a clear message", async ({ page, context }) => {
  await openApp(page);
  await importFixture(page, "full-latest.apkg");
  await page.goto("./#/review");
  await reveal(page);
  await page.keyboard.press("3");
  await waitSide(page, "question");
  await page.keyboard.press("Escape");
  const before = await page.evaluate(async () => (await window.__wenguDb!.info()).counts);
  await page.goto("./#/settings");
  await page.getByTestId("lang-setting").getByRole("radio", { name: "中文" }).click();
  await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
  const after = await page.evaluate(async () => (await window.__wenguDb!.info()).counts);
  expect(after).toEqual(before);
  expect(after.reviewLog).toBe(62);
  await page.goto("./#/");
  await expect(page.getByTestId("deck-row").first()).toBeVisible();

  // second tab: the database is held by the first one
  const second = await context.newPage();
  await second.goto("./");
  await expect(second.getByRole("alert")).toContainText("温故已在另一个标签页中打开");
  await second.screenshot({ path: test.info().outputPath("second-tab.png") });
  // after the first tab closes, "try again" opens the collection
  await page.close();
  await second.getByRole("button", { name: "重试" }).click();
  await expect(second.getByTestId("deck-row").first()).toBeVisible({ timeout: 15_000 });
});
