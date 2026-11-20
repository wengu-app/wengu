/** Screenshots for review (light: Chinese UI, dark: English UI). Runs only when WENGU_SHOTS is set to a directory. */
import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { cardFrame, importFixture, openApp, openNote, reveal, SHOTS, waitSide } from "./helpers.ts";

test.skip(!SHOTS, "set WENGU_SHOTS=<dir> to take screenshots");

for (const theme of ["light", "dark"] as const) {
  const lang = theme === "light" ? "zh" : "en";
  test(`screenshots ${theme}`, async ({ page }) => {
    const shot = (name: string, p: Page = page) => p.screenshot({ path: path.join(SHOTS, `${theme}-${name}.png`) });
    await openApp(page, { lang, theme });
    await expect(page.getByTestId("welcome")).toBeVisible();
    await shot("01-empty");

    await page.getByTestId("import-input").setInputFiles(path.resolve("../../packages/anki/fixtures/apkg/full-latest.apkg"));
    await expect(page.getByTestId("import-summary")).toBeVisible();
    await shot("02-import-summary");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: lang === "zh" ? "展开 Wengu Test" : "Expand Wengu Test" }).click();
    await page.getByRole("button", { name: lang === "zh" ? "展开 Languages" : "Expand Languages" }).click();
    await shot("03-decks");

    await page.goto("./#/review");
    await waitSide(page, "question");
    // move to a card with a picture or furigana for a representative shot
    for (let i = 0; i < 12; i++) {
      const text = await cardFrame(page).locator("#qa").innerText();
      if (/Which animal|猫/.test(text)) break;
      await reveal(page);
      await page.keyboard.press("3");
      await waitSide(page, "question");
    }
    await page.waitForTimeout(250);
    await shot("04-review-question");
    await reveal(page);
    await page.keyboard.press("i");
    await expect(page.getByTestId("why-panel")).toBeVisible();
    await page.waitForTimeout(300);
    await shot("05-review-answer-why");
    await page.keyboard.press("i");

    // a math card in Wengu mode
    await openNote(page, "Euler");
    await page.waitForTimeout(800);
    await shot("06-browse-edit");

    await page.setViewportSize({ width: 420, height: 820 });
    await page.goto("./#/");
    await shot("07-decks-narrow");
    await page.setViewportSize({ width: 1200, height: 820 });

    await page.getByRole("button", { name: lang === "zh" ? "导出" : "Export", exact: true }).click();
    await expect(page.getByTestId("export-dialog")).toBeVisible();
    await page.waitForTimeout(250);
    await shot("08-export");
    await page.keyboard.press("Escape");

    await page.goto("./#/review");
    for (let i = 0; i < 60; i++) {
      if ((await page.getByTestId("review").getAttribute("data-phase")) === "done") break;
      await reveal(page);
      await page.keyboard.press("4");
      await expect(page.getByTestId("review")).not.toHaveAttribute("data-phase", "answer");
    }
    await expect(page.getByTestId("done")).toBeVisible();
    await page.waitForTimeout(300);
    await shot("09-done");

    await page.goto("./#/stats");
    await page.waitForTimeout(300);
    await shot("10-stats");
    await page.goto("./#/settings");
    await shot("11-settings");

    await page.goto("./#/make");
    await page.getByRole("tab", { name: "Basic", exact: true }).click();
    await page.getByTestId("add-field-0").locator(".fe-rich").click();
    await page.keyboard.type(lang === "zh" ? "FSRS 中稳定性（Stability）的含义是什么？" : "What does Stability mean in FSRS?");
    await page.keyboard.press("Tab");
    await page.keyboard.type(lang === "zh" ? "回忆概率从 100% 降到 90% 所需的天数。" : "Days until recall probability falls from 100% to 90%.");
    const tagInput = page.getByLabel(lang === "zh" ? "标签" : "Tags");
    await tagInput.fill("memory::fsrs ");
    await tagInput.fill("concept ");
    await page.waitForTimeout(150);
    await shot("12-make");

    await page.getByTestId("make-more-types").click();
    await expect(page.getByTestId("make-more-pop")).toBeVisible();
    await page.waitForTimeout(150);
    await shot("13-make-more");
  });
}
