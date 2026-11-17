/**
 * Real keyboard input through the OS (X11 XTest), for the native menu's accelerators: copy/paste, zoom, File →
 * Export… (Ctrl+Shift+E), Quit (Ctrl+Q). Needs an X display and WENGU_XKEY=/path/to/xkey.py (a tiny ctypes XTest
 * script); skipped otherwise.
 */
import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";

import { closeImportDialog, fixture, launch, useTestSettings } from "./launch.ts";

const xkey = process.env.WENGU_XKEY;
test.skip(!xkey, "set WENGU_XKEY to an XTest helper");
const press = (...combos: string[]) => execFileSync("python3", [xkey!, ...combos], { env: { ...process.env, DISPLAY: process.env.DISPLAY ?? ":1" } });

test("native accelerators: copy/paste, zoom, export, quit", async () => {
  const app = await launch();
  const page = app.page;
  try {
    await useTestSettings(page);
    await page.getByTestId("import-input").setInputFiles(fixture("full-latest.apkg"));
    await expect(page.getByTestId("import-summary")).toBeVisible({ timeout: 60_000 });
    await closeImportDialog(page);
    await page.bringToFront();
    // copy/paste through the Edit menu's roles
    await page.evaluate(() => (location.hash = "#/browse"));
    const search = page.getByTestId("browse-search");
    await search.fill("capital");
    await search.focus();
    press("ctrl+a", "ctrl+c", "Delete");
    await expect(search).toHaveValue("");
    press("ctrl+v");
    await expect(search).toHaveValue("capital");
    // zoom in / reset (View menu)
    const z0 = await page.evaluate(() => window.devicePixelRatio);
    press("ctrl+equal");
    await expect.poll(() => page.evaluate(() => window.devicePixelRatio)).toBeGreaterThan(z0);
    press("ctrl+0");
    await expect.poll(() => page.evaluate(() => window.devicePixelRatio)).toBe(z0);
    // File → Export…
    await page.evaluate(() => (location.hash = "#/"));
    press("ctrl+shift+e");
    await expect(page.getByTestId("export-dialog")).toBeVisible();
    press("Escape");
    // File → Quit
    press("ctrl+q");
    await Promise.race([app.exited, new Promise((r) => setTimeout(r, 8000))]);
    expect(app.proc.exitCode).not.toBeNull();
    console.log("native accelerators: copy, paste, zoom in/reset, export dialog, quit all worked");
  } finally {
    await app.close();
  }
});
