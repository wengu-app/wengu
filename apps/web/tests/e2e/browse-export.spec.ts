import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { readAnkiPackage } from "@wengu/anki";
import { importFixture, openApp, openNote, reveal, waitSide } from "./helpers.ts";

test("browse, edit, add, delete; export with progress and read it back", async ({ page }) => {
  await openApp(page);
  await importFixture(page, "full-latest.apkg");

  // three reviews
  await page.goto("./#/review");
  for (let i = 0; i < 3; i++) {
    await reveal(page);
    await page.keyboard.press("3");
  }
  await waitSide(page, "question");
  await page.keyboard.press("Escape");

  // search + edit a field in HTML mode, add a tag
  const editor = await openNote(page, "capital", "France");
  const back = editor.getByTestId("field-1");
  await back.getByTitle("HTML").click();
  await back.locator("textarea").fill("Paris, <b>France</b>");
  await editor.getByTestId("tags-input").fill("geo edited");
  await editor.getByTestId("save-note").click();
  await expect(page.getByText("Saved")).toBeVisible();
  // rich-text editing of the front field
  const front = editor.getByTestId("field-0").locator(".fe-rich");
  await front.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" (city)");

  await expect(editor.getByTestId("save-note")).toBeEnabled();
  await page.keyboard.press("Control+s");
  await expect(editor.getByTestId("save-note")).toBeDisabled();


  // filters: tag
  await page.getByTestId("browse-search").fill("");
  await page.getByTestId("filter-tag").selectOption("edited");
  await expect(page.getByTestId("browse-count")).toHaveAttribute("data-total", "1");
  await page.getByTestId("filter-tag").selectOption("");

  // suspend the card, move it to another deck
  const item = editor.getByTestId("item-row").first();
  await item.getByTestId("item-suspend").click();
  await expect(item).toContainText("Suspended");
  await item.getByLabel("Move to deck").selectOption({ label: "Wengu Test / Misc" });
  await expect.poll(async () => page.evaluate(async () => {
    const r = await window.__wenguDb!.search({ text: "France" });
    return r.rows[0]?.deckIds;
  })).toHaveLength(1);
  await page.getByTestId("filter-state").selectOption("suspended");
  await expect(page.getByTestId("browse-row").filter({ hasText: "France" })).toHaveCount(1);
  await page.getByTestId("filter-state").selectOption("");

  // add a note
  await page.getByTestId("add-note").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Note type").selectOption({ label: "Basic" });
  await dialog.getByTestId("add-field-0").locator(".fe-rich").click();
  await page.keyboard.type("温故而知新");
  await dialog.getByTestId("add-field-1").locator(".fe-rich").click();
  await page.keyboard.type("Review the old, learn the new");
  await dialog.getByTestId("add-note-submit").click();
  await expect(page.getByText("Note added")).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).first().click();

  // delete a note, then undo from the toast
  await openNote(page, "goodbye", "再见");
  await page.getByTestId("delete-note").click();
  await page.getByTestId("confirm-delete").click();
  await expect(page.getByText("Note deleted")).toBeVisible();
  const notesAfterDelete = await page.evaluate(async () => (await window.__wenguDb!.info()).counts.knowledgePoints);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => page.evaluate(async () => (await window.__wenguDb!.info()).counts.knowledgePoints)).toBe(notesAfterDelete + 1);

  // export everything with progress (the button is always in the sidebar)
  await page.getByRole("button", { name: "Export" }).click();
  const exp = page.getByTestId("export-dialog");
  await expect(exp.getByTestId("export-progress")).toBeChecked();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-go").click()]);
  await expect(page.getByTestId("export-done")).toBeVisible();
  expect(download.suggestedFilename()).toMatch(/^wengu \d{4}-\d{2}-\d{2}\.apkg$/);
  const bytes = new Uint8Array(readFileSync((await download.path())!));
  const pkg = await readAnkiPackage(bytes);
  const edited = pkg.notes.find((n) => n.fields[1] === "Paris, <b>France</b>");
  expect(edited, "edited note in the export").toBeTruthy();
  expect(edited!.fields[0]).toContain("(city)");
  expect(edited!.tags.sort()).toEqual(["edited", "geo"]);
  expect(pkg.notes.some((n) => n.fields[0] === "温故而知新")).toBe(true);
  expect(pkg.notes.some((n) => n.fields[0] === "再见")).toBe(true);
  expect(pkg.revlog.length).toBe(61 + 3);
  const editedCard = pkg.cards.find((c) => c.noteId === edited!.id)!;
  expect(editedCard.queue).toBe(-1);
  expect(pkg.decks.find((d) => d.id === editedCard.deckId)?.name).toBe("Wengu Test::Misc");
  expect(pkg.media.length).toBe(3);
});

test("export one deck without progress", async ({ page }) => {
  await openApp(page);
  await importFixture(page, "full-latest.apkg");
  await page.goto("./#/");
  await page.getByRole("button", { name: "Expand Wengu Test" }).click();
  await page.getByRole("button", { name: "Actions for Languages" }).click();
  await page.getByRole("menuitem", { name: "Export this deck" }).click();
  const exp = page.getByTestId("export-dialog");
  await expect(exp.getByTestId("export-deck")).toHaveValue(/\d+/);
  await exp.getByTestId("export-progress").uncheck();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-go").click()]);
  expect(download.suggestedFilename()).toMatch(/^Wengu Test - Languages \d{4}-\d{2}-\d{2}\.apkg$/);
  const pkg = await readAnkiPackage(new Uint8Array(readFileSync((await download.path())!)));
  expect(pkg.revlog.length).toBe(0);
  expect(pkg.cards.every((c) => c.type === 0)).toBe(true);
  const names = new Set(pkg.cards.map((c) => pkg.decks.find((d) => d.id === c.deckId)!.name));
  for (const n of names) expect(n.startsWith("Wengu Test::Languages")).toBe(true);
});
