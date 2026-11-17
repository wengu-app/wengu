/**
 * Starts the app (the dev shell or a packaged binary) and attaches Playwright over the Chrome DevTools Protocol.
 * CDP rather than Playwright's `_electron.launch`: packaged builds have the Node inspector fuse turned off, which
 * `_electron.launch` relies on; `--remote-debugging-port` is a Chromium switch and works for both.
 */
import { chromium, type Browser, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const DESKTOP = path.resolve(here, "..");
export const FIXTURES = path.resolve(DESKTOP, "../../packages/anki/fixtures/apkg");
export const fixture = (name: string) => path.join(FIXTURES, name);
export const SCRATCH = process.env.WENGU_TEST_TMP ?? tmpdir();

/** What to run: WENGU_APP_EXECUTABLE=<packaged binary>, or the dev shell (electron + this package). */
export function target(): { executable: string; args: string[]; packaged: boolean } {
  const exe = process.env.WENGU_APP_EXECUTABLE;
  if (exe && /\.AppImage$/i.test(exe) && !existsSync("/usr/lib/x86_64-linux-gnu/libfuse.so.2") && !existsSync("/lib/x86_64-linux-gnu/libfuse.so.2")) {
    // No libfuse2 (Ubuntu 22.04+ default): the AppImage runtime can extract itself instead of mounting.
    process.env.APPIMAGE_EXTRACT_AND_RUN = "1";
    process.env.NO_CLEANUP = "1";
  }
  if (exe) return { executable: exe, args: [], packaged: true };
  const electron = createRequire(import.meta.url)("electron") as unknown as string;
  return { executable: electron, args: [DESKTOP], packaged: false };
}

/** Chromium cannot use its OS sandbox on hosts that forbid unprivileged user namespaces (Ubuntu 23.10+ without an
 * AppArmor profile for the binary). Set WENGU_TEST_NO_SANDBOX=1 there; it is never the app's default. */
const sandboxArgs = () => (process.env.WENGU_TEST_NO_SANDBOX === "1" ? ["--no-sandbox"] : []);

export interface Running {
  proc: ChildProcess;
  /** ws://127.0.0.1:<port>/devtools/browser/… */
  wsEndpoint: string;
  browser: Browser;
  page: Page;
  userDataDir: string;
  spawnedAt: number;
  log: string[];
  /** Quits the app (SIGTERM, i.e. a normal shutdown) or, with "none", waits for it to exit by itself. */
  close(how?: "SIGTERM" | "none"): Promise<void>;
  exited: Promise<void>;
}

export function newProfile(): string {
  return mkdtempSync(path.join(SCRATCH, "wengu-profile-"));
}

export async function launch(opts: { userDataDir?: string; args?: string[]; env?: Record<string, string> } = {}): Promise<Running> {
  const t = target();
  const userDataDir = opts.userDataDir ?? newProfile();
  const spawnedAt = performance.now();
  const proc = spawn(t.executable, [...t.args, ...sandboxArgs(), "--remote-debugging-port=0", ...(opts.args ?? [])], {
    env: { ...process.env, DISPLAY: process.env.DISPLAY ?? ":1", WENGU_USER_DATA_DIR: userDataDir, ...opts.env },
    stdio: ["ignore", "pipe", "pipe"],
    // its own process group: an AppImage runtime is the parent of the real app, and signals must reach both
    detached: true,
  });
  live.add(proc);
  proc.once("exit", () => live.delete(proc));
  const log: string[] = [];
  const ws = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no DevTools endpoint within 30 s:\n" + log.join(""))), 30_000);
    const on = (b: Buffer) => {
      const s = b.toString();
      log.push(s);
      if (process.env.WENGU_TEST_ECHO === "1") process.stdout.write(s.split("\n").filter((l) => l.includes("[wengu]")).map((l) => l + "\n").join(""));
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(s);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]!);
      }
    };
    proc.stdout!.on("data", on);
    proc.stderr!.on("data", on);
    proc.on("exit", (code) => reject(new Error(`app exited (${code}) before DevTools came up:\n${log.join("")}`)));
  });
  const browser = await chromium.connectOverCDP(ws);
  // Playwright redirects downloads into its own artifacts folder; give them back to the app (its will-download
  // handler decides where exports go).
  try {
    const cdp = await browser.newBrowserCDPSession();
    await cdp.send("Browser.setDownloadBehavior", { behavior: "default" });
  } catch {
    /* not supported: downloads stay with Playwright */
  }
  const page = await firstAppPage(browser);
  const exited = new Promise<void>((r) => (proc.exitCode !== null ? r() : proc.once("exit", () => r())));
  const close = async (how: "SIGTERM" | "none" = "SIGTERM") => {
    // SIGTERM makes Electron quit the normal way (windows close, storage flushes); SIGKILL only if that hangs.
    if (proc.exitCode === null && how === "SIGTERM") signalGroup(proc, "SIGTERM");
    const killer = setTimeout(() => signalGroup(proc, "SIGKILL"), 15_000);
    await exited;
    clearTimeout(killer);
    await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 2000))]);
  };
  return { proc, wsEndpoint: ws, browser, page, userDataDir, spawnedAt, log, close, exited };
}

const live = new Set<ChildProcess>();
function signalGroup(proc: ChildProcess, signal: NodeJS.Signals): void {
  try {
    process.kill(-proc.pid!, signal);
  } catch {
    proc.kill(signal);
  }
}
// never leave an app running behind a failed or timed-out test
process.on("exit", () => {
  for (const p of live) signalGroup(p, "SIGKILL");
});

async function firstAppPage(browser: Browser): Promise<Page> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    for (const ctx of browser.contexts()) for (const p of ctx.pages()) if (p.url().startsWith("wengu://app/") || p.url().startsWith("http://127.0.0.1")) return p;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("no app page");
}

/** Test settings: English UI, light theme, the debug hook (window.__wenguDb). Reloads the page to apply them. */
export async function useTestSettings(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await page.evaluate(() => {
    localStorage.setItem("wengu.debug", "1");
    if (!localStorage.getItem("wengu.settings.v1")) localStorage.setItem("wengu.settings.v1", JSON.stringify({ lang: "en", theme: "light" }));
  });
  await page.reload();
}

// ------------------------------------------------------------------------------------------ app helpers (as in apps/web)

export async function importFile(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }): Promise<void> {
  const { expect } = await import("@playwright/test");
  await page.getByTestId("import-input").setInputFiles(file);
  await expect(page.getByTestId("import-summary")).toBeVisible({ timeout: 120_000 });
  await closeImportDialog(page);
}

export async function closeImportDialog(page: Page): Promise<void> {
  const { expect } = await import("@playwright/test");
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

export async function openNote(page: Page, text: string, rowText = text): Promise<void> {
  const { expect } = await import("@playwright/test");
  // a fresh Browse screen (in a narrow window an open note hides the list)
  await page.evaluate(() => (location.hash = "#/stats"));
  await page.evaluate(() => (location.hash = "#/browse"));
  await page.getByTestId("browse-search").fill(text);
  await page.getByTestId("browse-row").filter({ hasText: rowText }).first().click();
  await expect(page.getByTestId("note-editor")).toBeVisible();
}

export async function waitSide(page: Page, side: "question" | "answer"): Promise<void> {
  const { expect } = await import("@playwright/test");
  await expect(page.getByTestId("review")).toHaveAttribute("data-phase", side);
  await expect(page.locator(".review-stage")).toHaveAttribute("data-shown-side", side);
}

export async function reveal(page: Page): Promise<void> {
  await waitSide(page, "question");
  const box = page.frameLocator('[data-testid="card-frame"]').locator("#qa input#typeans");
  if ((await box.count()) > 0) await box.press("Enter");
  else await page.keyboard.press("Space");
  await waitSide(page, "answer");
}

/**
 * A bare CDP connection to the app page, independent of Playwright. Playwright reports the whole page as crashed when
 * an out-of-process iframe's renderer dies; this keeps working, which is the point when testing exactly that.
 */
export async function rawAppPage(wsEndpoint: string): Promise<{ evaluate<T>(expr: string): Promise<T>; key(key: string, code?: string): Promise<void>; close(): void }> {
  const port = new URL(wsEndpoint).port;
  const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { type: string; url: string; webSocketDebuggerUrl: string }[];
  const target = list.find((t) => t.type === "page" && t.url.startsWith("wengu://app/")) ?? list.find((t) => t.type === "page")!;
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let id = 0;
  const waiting = new Map<number, (v: { result?: unknown; error?: { message: string } }) => void>();
  ws.onmessage = (m) => {
    const msg = JSON.parse(String(m.data)) as { id?: number; result?: unknown; error?: { message: string } };
    if (msg.id !== undefined) waiting.get(msg.id)?.(msg);
  };
  const send = (method: string, params: object) =>
    new Promise<{ result?: unknown; error?: { message: string } }>((r) => {
      const i = ++id;
      waiting.set(i, r);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  return {
    async evaluate<T>(expr: string): Promise<T> {
      const r = (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })) as { result?: { result?: { value?: T } }; error?: { message: string } };
      if (r.error) throw new Error(r.error.message);
      return r.result!.result!.value as T;
    },
    async key(key: string, code = key === " " ? "Space" : `Digit${key}`) {
      await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, text: key });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key, code });
    },
    close: () => ws.close(),
  };
}
