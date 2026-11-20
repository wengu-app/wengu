import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { readAnkiPackage, writeAnkiPackage } from "@wengu/anki";
import { fixture, importFixture, openApp, openNote, pick, previewFrame } from "./helpers.ts";

test("Wengu mode: stock note types in Wengu typography; images, MathJax, furigana, cloze, audio", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __plays: string[] }).__plays = [];
    const orig = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      (window as unknown as { __plays: string[] }).__plays.push(this.currentSrc || this.src);
      return orig.call(this).catch(() => undefined);
    };
  });
  await openApp(page);
  await importFixture(page, "full-latest.apkg");

  await openNote(page, "capital", "France");
  const f = previewFrame(page);
  await expect(f.locator("body")).toHaveClass(/\bwg\b/);
  await expect(f.locator("#qa")).toContainText("What is the capital of France?");
  await expect(f.locator("#qa")).not.toHaveCSS("font-family", /arial/i);
  await page.getByRole("tab", { name: "Answer" }).click();
  await expect(f.locator("#qa hr#answer")).toHaveCount(1);
  await expect(f.locator("#qa")).toContainText("Paris");

  // image from the collection, as a blob: URL made inside the frame
  await openNote(page, "Which animal");
  const img = previewFrame(page).locator("#qa img");
  await expect(img).toHaveAttribute("src", /^blob:null\//);
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

  // MathJax (bundled) on a cloze card
  await openNote(page, "Euler");
  await expect(previewFrame(page).locator("#qa mjx-container").first()).toBeVisible({ timeout: 15_000 });
  await expect(previewFrame(page).locator("#qa .cloze")).toHaveCount(1);

  // [latex] without generated images: typeset by MathJax instead of a broken image
  await openNote(page, "LaTeX:");
  await expect(previewFrame(page).locator("#qa .wg-latex-fallback mjx-container").first()).toBeVisible({ timeout: 15_000 });

  // furigana and audio (vocab note type: Recognition / Production / Listening)
  const editor = await openNote(page, "好き", "猫");
  await page.getByRole("tab", { name: "Answer" }).click();
  await expect(previewFrame(page).locator("#qa ruby rt")).toHaveText("ねこ");
  await pick(editor.getByLabel("Cards").last(), "Listening");
  await page.getByRole("tab", { name: "Question" }).click();
  const play = previewFrame(page).locator("#qa button.replay-button");
  await expect(play).toHaveCount(1);
  await play.click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __plays: string[] }).__plays.length)).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as unknown as { __plays: string[] }).__plays[0])).toMatch(/^blob:http/);
});

test("Original mode: per-note-type switch, dark mode", async ({ page }) => {
  await openApp(page);
  await importFixture(page, "full-latest.apkg");
  await page.goto("./#/settings");
  const row = page.getByTestId("nt-row").filter({ hasText: /^Basic(?! \()/ });
  await expect(row).toContainText("Wengu typography is safe");
  await row.getByRole("radio", { name: "Deck’s own" }).click();
  await openNote(page, "capital", "France");
  const f = previewFrame(page);
  await expect(f.locator("body")).toHaveClass("card card1");
  await expect(f.locator("#qa")).toHaveCSS("font-family", /arial/i);

  await page.goto("./#/settings");
  await page.getByTestId("theme-setting").getByRole("radio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await openNote(page, "capital", "France");
  await expect(previewFrame(page).locator("body")).toHaveClass(/nightMode/);
  await expect(previewFrame(page).locator("body")).toHaveCSS("background-color", "rgb(27, 27, 28)");
});

test("Untrusted templates: scripts fall back to original mode and stay inside the sandbox", async ({ page }) => {
  // A shared deck whose Basic template runs a script that tries to get out.
  const pkg = await readAnkiPackage(new Uint8Array(readFileSync(fixture("shared-latest.apkg"))));
  const basic = pkg.notetypes.find((n) => n.name === "Basic")!;
  basic.templates[0]!.qfmt = `<div class="front">{{Front}}</div><div class="secret">SECRET</div>
<script>
var d = document.body.dataset; d.ran = "1";
try { d.parent = parent.document.title ? "reachable" : "reachable"; } catch (e) { d.parent = "blocked"; }
try { localStorage.setItem("x", "1"); d.storage = "reachable"; } catch (e) { d.storage = "blocked"; }
try { indexedDB.open("x").onerror = function () { d.idb = "blocked"; }; d.idb = d.idb || "pending"; } catch (e) { d.idb = "blocked"; }
fetch(location.origin === "null" ? "http://localhost:5177/wengu/index.html" : "/wengu/index.html").then(function () { d.net = "reachable"; }, function () { d.net = "blocked"; });
var i = new Image(); i.onload = function () { d.img = "loaded"; }; i.onerror = function () { d.img = "blocked"; }; i.src = "http://localhost:5177/wengu/favicon.svg";
</script>`;
  basic.css += "\n.secret { display: none; }";
  const bytes = await writeAnkiPackage(pkg);
  await openApp(page);
  await importFixture(page, { name: "scripted.apkg", mimeType: "application/octet-stream", buffer: Buffer.from(bytes) });

  await page.goto("./#/settings");
  await expect(page.getByTestId("nt-row").filter({ hasText: /^Basic(?! \()/ })).toContainText("the template runs scripts");

  await openNote(page, "capital", "France");
  const body = previewFrame(page).locator("body");
  await expect(body).toHaveClass("card card1");
  await expect(body).toHaveAttribute("data-ran", "1");
  await expect(body).toHaveAttribute("data-parent", "blocked");
  await expect(body).toHaveAttribute("data-storage", "blocked");
  await expect(body).toHaveAttribute("data-net", "blocked");
  await expect(body).toHaveAttribute("data-img", "blocked");
  // the deck's own CSS still hides what it hides
  await expect(previewFrame(page).locator(".secret")).toBeHidden();

  // in the reviewer the card says why it keeps its own style
  await page.goto("./#/review");
  for (let i = 0; i < 30; i++) {
    await expect(page.getByTestId("review")).toHaveAttribute("data-phase", "question");
    if ((await page.getByTestId("mode-chip").getAttribute("data-mode")) === "original") break;
    await page.keyboard.press("Space");
    await page.keyboard.press("4");
    await page.waitForTimeout(50);
  }
  await expect(page.getByTestId("mode-note")).toContainText("the template runs scripts");
});

test("Wengu typography: sans-serif body, short words centered, prose/cloze left-aligned without reveal jump", async ({ page }) => {
  await openApp(page);
  await importFixture(page, "full-latest.apkg");

  // Short vocabulary card (猫) stays centered on both sides in sans-serif typography.
  await openNote(page, "好き", "猫");
  const f = previewFrame(page);
  await expect(f.locator("body")).toHaveClass(/\bwg-center\b/);
  await expect(f.locator("#qa")).toHaveCSS("text-align", "center");
  await expect(f.locator("body")).not.toHaveCSS("font-family", /georgia|songti/i);
  await page.getByRole("tab", { name: "Answer" }).click();
  await expect(f.locator("body")).toHaveClass(/\bwg-center\b/);
  await expect(f.locator("#qa .wg-back")).toHaveCount(1);

  // Cloze sentence card stays left-aligned on both sides.
  await openNote(page, "Euler");
  await expect(f.locator("body")).not.toHaveClass(/\bwg-center\b/);
  await expect(f.locator("#qa")).toHaveCSS("text-align", "start");
  await page.getByRole("tab", { name: "Answer" }).click();
  await expect(f.locator("body")).not.toHaveClass(/\bwg-center\b/);
});
