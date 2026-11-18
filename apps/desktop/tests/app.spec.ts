/**
 * The desktop app end to end: open an .apkg from the command line, review, quit, relaunch (data and progress still
 * there), export through the File menu and read the file back with @wengu/anki. Also: answer→next-card latency,
 * cold start, single instance, window state, external links, permissions.
 *
 * Runs against the dev shell, or a packaged build with WENGU_APP_EXECUTABLE=… (see playwright.config.ts).
 */
import { expect, test, type Page } from "@playwright/test";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readAnkiPackage } from "@wengu/anki";

import { closeImportDialog, fixture, launch, newProfile, reveal, SCRATCH, target, useTestSettings, waitSide } from "./launch.ts";

const out = path.join(SCRATCH, "wengu-app");
mkdirSync(out, { recursive: true });

type Counts = { knowledgePoints: number; reviewItems: number; reviewLog: number; decks: number; media: number };
const counts = (page: Page) => page.evaluate(async () => (await window.__wenguDb!.info()).counts as unknown as Counts);

declare global {
  interface Window {
    __wenguDb?: { info(): Promise<{ counts: unknown; storage: string }> };
    __wenguPerf?: { answerToNext: number[]; answerRpc: number[] };
  }
}

/** A fake `xdg-open` (what shell.openExternal runs on Linux) that only records its argument. */
function fakeOpener(): { env: Record<string, string>; opened(): string[] } {
  const bin = mkdtempSync(path.join(SCRATCH, "wengu-fakebin-"));
  const logFile = path.join(bin, "opened.log");
  writeFileSync(path.join(bin, "xdg-open"), `#!/bin/sh\necho "$1" >> "${logFile}"\n`);
  chmodSync(path.join(bin, "xdg-open"), 0o755);
  return {
    env: { PATH: `${bin}:${process.env.PATH ?? ""}` },
    opened: () => (existsSync(logFile) ? readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean) : []),
  };
}

const summary = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]!);
  return { n: s.length, median: q(0.5), p95: q(0.95), max: Math.round(s[s.length - 1] ?? 0) };
};

test("import from the OS, review, quit, relaunch with data intact, export via the File menu", async () => {
  const profile = newProfile();
  const downloads = mkdtempSync(path.join(SCRATCH, "wengu-downloads-"));
  const env = { WENGU_DOWNLOAD_DIR: downloads };
  const report: Record<string, unknown> = { target: target(), profile, downloads };
  const t0 = Date.now();
  const step = (m: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

  // 1. first run: test settings (English UI, debug hook); quit
  let app = await launch({ userDataDir: profile, env });
  await useTestSettings(app.page);
  await expect(app.page.getByTestId("welcome")).toBeVisible();
  report.storage = await app.page.evaluate(async () => (await window.__wenguDb!.info()).storage);
  await app.close();

  step('first run done');
  // 2. open the .apkg with the app (as a file manager or `wengu file.apkg` would): it is imported
  app = await launch({ userDataDir: profile, env, args: [fixture("full-latest.apkg")] });
  let page = app.page;
  await expect(page.getByTestId("import-summary")).toBeVisible({ timeout: 60_000 });
  await closeImportDialog(page);
  const afterImport = await counts(page);
  report.afterImport = afterImport;
  expect(afterImport.knowledgePoints).toBe(14);
  expect(afterImport.reviewLog).toBe(61);

  step('imported from the command line');
  // review until the day is done, measuring answer → next card painted
  await page.evaluate(() => (location.hash = "#/review"));
  const ratings = ["1", "3", "3", "2", "1", "3"];
  let reviewed = 0;
  for (let i = 0; i < 80; i++) {
    if ((await page.getByTestId("done").isVisible()) || (await page.getByTestId("review").getAttribute("data-phase", { timeout: 5000 })) === "done") break;
    await reveal(page);
    if (i === 0) await page.screenshot({ path: path.join(out, "review-answer.png") });
    await page.keyboard.press(ratings[i % ratings.length]!);
    reviewed++;
    await expect(page.getByTestId("review")).not.toHaveAttribute("data-phase", "answer");
  }
  await page.waitForTimeout(300);
  const perf = await page.evaluate(() => window.__wenguPerf!);
  report.reviewed = reviewed;
  report.answerToNextMs = summary(perf.answerToNext);
  report.answerRpcMs = summary(perf.answerRpc);
  report.answerToNextAll = perf.answerToNext.map(Math.round);
  step('reviewed');
  report.endedWith = (await page.getByTestId("done").isVisible()) ? "done" : await page.getByTestId("review").getAttribute("data-phase", { timeout: 2000 }).catch(() => "?");
  step(`review ended with ${String(report.endedWith)}`);
  await page.evaluate(() => (location.hash = "#/"));
  await expect(page.getByTestId("deck-row").first()).toBeVisible();
  step("deck list");
  const decksBefore = await page.getByTestId("deck-row").allInnerTexts();
  const beforeQuit = await counts(page);
  report.beforeQuit = beforeQuit;
  expect(beforeQuit.reviewLog).toBe(61 + reviewed);
  await page.screenshot({ path: path.join(out, "decks-after-review.png") });
  step('screenshot taken');
  // quit from the File menu's accelerator, like a user (falls back to SIGTERM if the accelerator is not delivered)
  await page.keyboard.press("Control+Q");
  await Promise.race([app.exited, new Promise((r) => setTimeout(r, 5000))]);
  report.quitByCtrlQ = app.proc.exitCode !== null;
  await app.close();

  step('quit');
  // 3. relaunch: same collection, same progress
  app = await launch({ userDataDir: profile, env });
  page = app.page;
  await expect(page.getByTestId("deck-row").first()).toBeVisible({ timeout: 30_000 });
  const afterRestart = await counts(page);
  report.afterRestart = afterRestart;
  expect(afterRestart).toEqual(beforeQuit);
  // the deck list shows the same due counts as before quitting
  const decksAfter = await page.getByTestId("deck-row").allInnerTexts();
  report.deckRows = { before: decksBefore, after: decksAfter };
  expect(decksAfter).toEqual(decksBefore);
  await page.screenshot({ path: path.join(out, "decks-after-restart.png") });

  step('relaunched, data checked');
  // 4. export from the File menu (Ctrl+Shift+E), with progress
  await page.keyboard.press("Control+Shift+E");
  const viaMenu = await page.getByTestId("export-dialog").isVisible({ timeout: 3000 }).catch(() => false);
  report.exportDialogViaMenuAccelerator = viaMenu;
  if (!viaMenu) await page.getByRole("button", { name: "Export" }).click();
  await page.getByTestId("export-go").click();
  await expect(page.getByTestId("export-done")).toBeVisible({ timeout: 60_000 });
  let file = "";
  await expect
    .poll(() => {
      file = readdirSync(downloads).find((f) => f.endsWith(".apkg")) ?? "";
      return file && statSync(path.join(downloads, file)).size > 0 ? file : "";
    }, { timeout: 20_000 })
    .not.toBe("");
  await page.waitForTimeout(500);
  await app.close();

  step('exported');
  const bytes = new Uint8Array(readFileSync(path.join(downloads, file)));
  const pkg = await readAnkiPackage(bytes);
  report.exported = { file: path.join(downloads, file), bytes: bytes.length, notes: pkg.notes.length, cards: pkg.cards.length, revlog: pkg.revlog.length, media: Object.keys(pkg.media ?? {}).length, decks: pkg.decks.map((d) => d.name) };
  expect(pkg.notes.length).toBe(14);
  expect(pkg.revlog.length).toBe(61 + reviewed);

  // where the collection lives on disk
  report.profileFiles = listFiles(profile);
  writeFileSync(path.join(out, "app-report.json"), JSON.stringify(report, null, 2));
  console.log("APP REPORT", JSON.stringify(report, null, 2));
});

function listFiles(dir: string, base = dir, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(p, base, acc);
    else acc.push(`${path.relative(base, p)}  ${statSync(p).size}`);
  }
  return acc;
}

test("cold start to an interactive window", async () => {
  // a profile with the fixture imported
  const profile = newProfile();
  let app = await launch({ userDataDir: profile });
  await useTestSettings(app.page);
  await app.page.getByTestId("import-input").setInputFiles(fixture("full-latest.apkg"));
  await expect(app.page.getByTestId("import-summary")).toBeVisible({ timeout: 60_000 });
  await closeImportDialog(app.page);
  await app.close();

  const runs: { toDeckList: number; readyToShow: number | null }[] = [];
  for (let i = 0; i < 5; i++) {
    app = await launch({ userDataDir: profile, env: { WENGU_TIMING: "1" } });
    await app.page.getByTestId("deck-row").first().waitFor({ timeout: 30_000 });
    const toDeckList = Math.round(performance.now() - app.spawnedAt);
    const m = /ready-to-show (\d+) ms/.exec(app.log.join(""));
    runs.push({ toDeckList, readyToShow: m ? Number(m[1]) : null });
    await app.close();
  }
  const report = { runs, median: summary(runs.map((r) => r.toDeckList)) };
  writeFileSync(path.join(out, "cold-start.json"), JSON.stringify(report, null, 2));
  console.log("COLD START (process spawn → deck list rendered with the collection open)", JSON.stringify(report));
});

test("single instance: a second launch hands its file to the first window and exits", async () => {
  const profile = newProfile();
  const app = await launch({ userDataDir: profile });
  try {
    await useTestSettings(app.page);
    await expect(app.page.getByTestId("welcome")).toBeVisible();
    const t = target();
    const started = Date.now();
    const second = spawn(t.executable, [...t.args, ...(process.env.WENGU_TEST_NO_SANDBOX === "1" ? ["--no-sandbox"] : []), fixture("full-latest.apkg")], {
      env: { ...process.env, DISPLAY: process.env.DISPLAY ?? ":1", WENGU_USER_DATA_DIR: profile },
      stdio: "ignore",
    });
    const code = await new Promise<number | null>((r) => second.once("exit", r));
    const secondLived = Date.now() - started;
    await expect(app.page.getByTestId("import-summary")).toBeVisible({ timeout: 60_000 });
    console.log(`second instance exited with ${code} after ${secondLived} ms; the first window imported the file`);
    expect(code).toBe(0);
  } finally {
    await app.close();
  }
});

test("window size and position are remembered", async () => {
  const profile = newProfile();
  writeFileSync(path.join(profile, "window-state.json"), JSON.stringify({ bounds: { x: 30, y: 30, width: 720, height: 410 }, maximized: false, fullscreen: false }));
  const app = await launch({ userDataDir: profile });
  try {
    // Linux can include the compositor's shadow in outerWidth/outerHeight.
    // With overlay controls, the page fills the restored app window.
    const size = await app.page.evaluate((linux) => ({
      w: linux ? window.innerWidth : window.outerWidth,
      h: linux ? window.innerHeight : window.outerHeight,
    }), process.platform === "linux");
    console.log("restored window:", JSON.stringify(size));
    expect(size.w).toBe(720);
    expect(size.h).toBe(410);
  } finally {
    await app.close();
  }
  const saved = JSON.parse(readFileSync(path.join(profile, "window-state.json"), "utf8"));
  expect(saved.bounds).toMatchObject({ width: 720, height: 410 });
});

test("links leave for the system browser; the app never navigates away; permissions are denied", async () => {
  const opener = fakeOpener();
  const app = await launch({ env: opener.env });
  try {
    const page = app.page;
    await useTestSettings(page);
    await expect(page.getByTestId("welcome")).toBeVisible();
    // target=_blank / window.open from the app page → system browser, no Electron window
    await page.evaluate(() => window.open("https://wengu.dev/from-window-open"));
    // a plain link navigation of the app page → system browser, the app stays put
    await page.evaluate(() => {
      const a = document.createElement("a");
      a.href = "https://wengu.dev/from-link";
      document.body.append(a);
      a.click();
    });
    await expect.poll(() => opener.opened().length, { timeout: 10_000 }).toBe(2);
    expect(page.url()).toMatch(/^wengu:\/\/app\//);
    expect(app.browser.contexts().flatMap((c) => c.pages()).length).toBe(1);
    // non-web schemes are never handed to the OS
    await page.evaluate(() => window.open("file:///etc/passwd"));
    await page.waitForTimeout(500);
    expect(opener.opened()).toEqual(["https://wengu.dev/from-window-open", "https://wengu.dev/from-link"]);

    const perms = await page.evaluate(async () => {
      const q = async (name: string) => {
        try {
          return (await navigator.permissions.query({ name } as PermissionDescriptor)).state;
        } catch (e) {
          return `error ${(e as Error).name}`;
        }
      };
      const settle = async (p: Promise<unknown>) => p.then(() => "granted", (e: Error) => `rejected ${e.name}`);
      return {
        camera: await q("camera"),
        microphone: await q("microphone"),
        geolocation: await q("geolocation"),
        notifications: await q("notifications"),
        "Notification.requestPermission": await Notification.requestPermission(),
        "clipboard.readText": await settle(navigator.clipboard.readText()),
        getUserMedia: await settle(navigator.mediaDevices.getUserMedia({ video: true })),
        "fetch https": await settle(fetch("https://wengu.dev/")),
        "fetch http loopback": await settle(fetch("http://127.0.0.1:9/")),
      };
    });
    console.log("app page permissions/network:", JSON.stringify(perms, null, 1));
    expect(perms["Notification.requestPermission"]).toBe("denied");
    expect(perms["clipboard.readText"]).toMatch(/rejected/);
    expect(perms.getUserMedia).toMatch(/rejected/);
    expect(perms["fetch https"]).toMatch(/rejected/);
    writeFileSync(path.join(out, "links-permissions.json"), JSON.stringify({ opened: opener.opened(), perms }, null, 2));
  } finally {
    await app.close();
  }
});
