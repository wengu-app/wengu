import { expect, type Locator, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES = path.resolve(here, "../../../../packages/anki/fixtures/apkg");
export const fixture = (name: string) => path.join(FIXTURES, name);
export const SHOTS = process.env.WENGU_SHOTS ?? "";

/** Opens the app with English UI (tests assert on English labels) and test hooks enabled. */
export async function openApp(page: Page, opts: { lang?: "en" | "zh"; theme?: "light" | "dark"; settings?: Record<string, unknown> } = {}): Promise<void> {
  await page.addInitScript(
    ([lang, theme, extra]) => {
      try {
        localStorage.setItem("wengu.debug", "1");
        if (!localStorage.getItem("wengu.settings.v1"))
          localStorage.setItem("wengu.settings.v1", JSON.stringify({ lang, theme, ...(extra as object) }));
      } catch {
        /* ignore */
      }
    },
    [opts.lang ?? "en", opts.theme ?? "light", opts.settings ?? {}] as const,
  );
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await page.goto("./");
}

export async function importFixture(page: Page, name: string | { name: string; mimeType: string; buffer: Buffer }, close = true): Promise<void> {
  await page.getByTestId("import-input").setInputFiles(typeof name === "string" ? fixture(name) : name);
  await expect(page.getByTestId("import-summary")).toBeVisible({ timeout: 300_000 });
  if (close) {
    await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
}

export function cardFrame(page: Page, testId = "card-frame") {
  return page.frameLocator(`[data-testid="${testId}"]`);
}

/** Waits until the card frame has painted the given side of the current card. */
export async function waitSide(page: Page, side: "question" | "answer"): Promise<void> {
  await expect(page.getByTestId("review")).toHaveAttribute("data-phase", side);
  await expect(page.locator(".review-stage")).toHaveAttribute("data-shown-side", side);
}

/** Reveals the current card: Enter in the type-in box if there is one, else Space. */
export async function reveal(page: Page, typed?: string): Promise<boolean> {
  await waitSide(page, "question");
  const box = cardFrame(page).locator("#qa input#typeans");
  const hasBox = (await box.count()) > 0;
  if (hasBox) {
    if (typed !== undefined) await box.fill(typed);
    await box.press("Enter");
  } else await page.keyboard.press("Space");
  await waitSide(page, "answer");
  return hasBox;
}

/** Opens a note in Browse by searching for text; returns the editor. */
export async function openNote(page: Page, text: string, rowText = text) {
  await page.goto("./#/browse");
  await page.getByTestId("browse-search").fill(text);
  await page.getByTestId("browse-row").filter({ hasText: rowText }).first().click();
  const editor = page.getByTestId("note-editor");
  await expect(editor).toBeVisible();
  return editor;
}

export const previewFrame = (page: Page) => page.frameLocator('[data-testid="preview-frame"]');

/** Chooses an option in a ui/Select dropdown: opens it from its trigger and clicks the option by accessible name. */
export async function pick(trigger: Locator, option: string): Promise<void> {
  await trigger.click();
  await trigger.page().locator(".select-pop").getByRole("option", { name: option, exact: true }).click();
}
