/**
 * The native menu's File → Import… / Export… wiring (dev shell only: it drives the main process through Playwright's
 * Electron support, which needs the Node inspector that packaged builds switch off with a fuse). Keyboard
 * accelerators themselves are delivered by the OS menu and cannot be synthesised over CDP.
 */
import { _electron as electron, expect, test } from "@playwright/test";

import { closeImportDialog, DESKTOP, fixture, newProfile } from "./launch.ts";

test.skip(!!process.env.WENGU_APP_EXECUTABLE, "dev shell only");

test("File → Import… opens the native dialog and imports the chosen file; File → Export… opens the export dialog", async () => {
  const app = await electron.launch({
    args: [DESKTOP, ...(process.env.WENGU_TEST_NO_SANDBOX === "1" ? ["--no-sandbox"] : [])],
    env: { ...process.env, DISPLAY: process.env.DISPLAY ?? ":1", WENGU_USER_DATA_DIR: newProfile() } as Record<string, string>,
  });
  try {
    const page = await app.firstWindow();
    await page.evaluate(() => {
      localStorage.setItem("wengu.settings.v1", JSON.stringify({ lang: "en", theme: "light" }));
    });
    await page.reload();
    await expect(page.getByTestId("welcome")).toBeVisible();
    const labels = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.map((i) => `${i.label}: ${i.submenu?.items.map((s) => s.label || s.role || "—").join(", ")}`));
    console.log("menu:\n  " + labels.join("\n  "));
    // the native open dialog answers with the fixture
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as typeof dialog.showOpenDialog;
    }, fixture("full-latest.apkg"));
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById("import")!.click());
    await expect(page.getByTestId("import-summary")).toBeVisible({ timeout: 60_000 });
    await closeImportDialog(page);
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById("export")!.click());
    await expect(page.getByTestId("export-dialog")).toBeVisible();
  } finally {
    await app.close();
  }
});
