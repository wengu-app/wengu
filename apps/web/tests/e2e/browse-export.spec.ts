import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { readAnkiPackage } from "@wengu/anki";
import { importFixture, openApp, openNote, pick, reveal, waitSide } from "./helpers.ts";

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
  // This test covers editing/export. Use the host's exit button: CDP can hang on key-up when Escape destroys
  // the focused card iframe, even though the app has already returned to the deck list.
  await page.getByRole("button", { name: "Back to decks" }).click();

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
  await pick(page.getByTestId("filter-tag"), "edited");
  await expect(page.getByTestId("browse-count")).toHaveAttribute("data-total", "1");
  await pick(page.getByTestId("filter-tag"), "Any tag");

  // suspend the card, move it to another deck
  const item = editor.getByTestId("item-row").first();
  await item.getByTestId("item-suspend").click();
  await expect(item).toContainText("Suspended");
  await pick(item.getByLabel("Move to deck"), "Wengu Test / Misc");
  await expect.poll(async () => page.evaluate(async () => {
    const r = await window.__wenguDb!.search({ text: "France" });
    return r.rows[0]?.deckIds;
  })).toHaveLength(1);
  await pick(page.getByTestId("filter-state"), "Suspended");
  await expect(page.getByTestId("browse-row").filter({ hasText: "France" })).toHaveCount(1);
  await pick(page.getByTestId("filter-state"), "Any state");

  // add a note (Tab flows directly from front to back)
  await page.getByTestId("add-note").click();
  await page.getByRole("tab", { name: "Basic", exact: true }).click();
  await page.getByTestId("add-field-0").locator(".fe-rich").click();
  await page.keyboard.type("温故而知新");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Review the old, learn the new");
  await page.getByLabel("Tags").fill("lunyu ");
  await page.getByTestId("add-note-submit").click();
  await expect(page.getByText("Note added")).toBeVisible();
  await expect.poll(() => page.evaluate(async () => (await window.__wenguDb!.search({ text: "温故而知新" })).rows.length)).toBe(1);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByTestId("browse-search")).toBeVisible();

  // delete a note, then undo from the toast
  await openNote(page, "goodbye", "再见");
  await page.getByTestId("delete-note").click();
  await page.getByTestId("confirm-delete").click();
  await expect(page.getByText("Note deleted")).toBeVisible();
  const notesAfterDelete = await page.evaluate(async () => (await window.__wenguDb!.info()).counts.knowledgePoints);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => page.evaluate(async () => (await window.__wenguDb!.info()).counts.knowledgePoints)).toBe(notesAfterDelete + 1);

  // export everything with progress (from the home page's Decks section)
  await page.goto("./#/");
  await page.getByRole("button", { name: "Export", exact: true }).click();
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
  await expect(exp.getByTestId("export-deck")).toHaveAttribute("data-value", /^[1-9]\d*$/);
  await exp.getByTestId("export-progress").uncheck();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-go").click()]);
  expect(download.suggestedFilename()).toMatch(/^Wengu Test - Languages \d{4}-\d{2}-\d{2}\.apkg$/);
  const pkg = await readAnkiPackage(new Uint8Array(readFileSync((await download.path())!)));
  expect(pkg.revlog.length).toBe(0);
  expect(pkg.cards.every((c) => c.type === 0)).toBe(true);
  const names = new Set(pkg.cards.map((c) => pkg.decks.find((d) => d.id === c.deckId)!.name));
  for (const n of names) expect(n.startsWith("Wengu Test::Languages")).toBe(true);
});

test("delete a deck from its detail page and undo", async ({ page }) => {
  await openApp(page);
  await importFixture(page, "full-latest.apkg");
  await page.goto("./#/");
  await page.getByRole("link", { name: /Wengu Test/ }).first().click();
  await expect(page.getByTestId("deck-page")).toBeVisible();
  await page.getByRole("link", { name: /Languages/ }).click();
  await expect(page.getByRole("heading", { name: "Languages" })).toBeVisible();

  // Delete subdeck from the bottom of its detail page
  await page.getByTestId("delete-deck").click();
  await expect(page.getByText(/Wengu Test::Languages/)).toBeVisible();
  await page.getByTestId("confirm-delete-deck").click();

  // Navigates back to the home page (replacing the deleted deck's history entry) with an Undo toast
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByText('Deleted "Languages"')).toBeVisible();
  await expect(page.getByTestId("deck-row").filter({ hasText: "Languages" })).toHaveCount(0);

  // Undo restores the deck and its subdecks
  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByRole("button", { name: "Expand Wengu Test" }).click();
  await expect(page.getByTestId("deck-row").filter({ hasText: "Languages" })).toHaveCount(1);

  // The Default deck cannot be deleted
  await page.goto("./#/deck/1");
  await expect(page.getByTestId("deck-page")).toBeVisible();
  await expect(page.getByTestId("delete-deck")).toHaveCount(0);
});

test("make screen shows an unsupported notice for Anki Image Occlusion and lets users pin note types", async ({ page }) => {
  await openApp(page);
  await importFixture(page, "full-latest.colpkg");
  await page.goto("./#/make");
  await expect(page.getByTestId("make-more-types")).toBeVisible();

  // Image Occlusion is kept out of the default pinned pills and lives under More
  await expect(page.getByTestId("make-note-types").getByRole("tab", { name: "Image Occlusion", exact: true })).toHaveCount(0);
  await page.getByTestId("make-more-types").click();
  await page.getByTestId("make-more-pop").getByRole("option", { name: /Image Occlusion/ }).click();
  await expect(page.getByTestId("make-unsupported")).toBeVisible();
  await expect(page.getByTestId("add-note-submit")).toHaveCount(0);
  await page.getByRole("button", { name: /Switch to/ }).click();
  await expect(page.getByTestId("make-unsupported")).toHaveCount(0);
  await expect(page.getByTestId("add-note-submit")).toBeVisible();

  // Pinning a type from More adds it to the outer capsule bar and persists across reloads
  await page.getByTestId("make-more-types").click();
  await page.getByRole("button", { name: "Pin to bar Basic (type in the answer)" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("make-note-types").getByRole("tab", { name: "Basic (type in the answer)", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("make-note-types").getByRole("tab", { name: "Basic (type in the answer)", exact: true })).toBeVisible();
});
