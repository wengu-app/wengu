/**
 * macOS, packaged app only: Launch Services registers each `Wengu --mcp` process as the app itself, so opening Wengu
 * from Finder while only MCP processes run reopens one of them. They must start the desktop app instead:
 * one desktop process, which the agents that were already connected can use.
 *
 * Run with WENGU_APP_EXECUTABLE=<…/Wengu.app/Contents/MacOS/Wengu>.
 */
import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { launch, useTestSettings } from "./launch.ts";
import { agentCommand, startMcp, type McpClient } from "./mcp-client.ts";

const exe = process.env.WENGU_APP_EXECUTABLE ?? "";
const bundle = path.resolve(exe, "../../..");
test.skip(process.platform !== "darwin" || !exe.endsWith(".app/Contents/MacOS/Wengu"), "macOS packaged app only");

/** pids of this bundle's main processes, split into desktop and `--mcp` ones (helpers have their own executables). */
function processes(): { desktop: number[]; mcp: number[] } {
  const desktop: number[] = [];
  const mcp: number[] = [];
  for (const line of execFileSync("ps", ["-axo", "pid=,args="], { encoding: "utf8" }).split("\n")) {
    const m = /^\s*(\d+) (.*)$/.exec(line);
    if (!m || !(m[2] === exe || m[2]!.startsWith(exe + " "))) continue;
    (m[2]!.split(" ").includes("--mcp") ? mcp : desktop).push(Number(m[1]));
  }
  return { desktop, mcp };
}

/** Launch Services' application type per pid ("Foreground", "UIElement", …). */
function appTypes(): Map<number, string> {
  const types = new Map<number, string>();
  for (const m of execFileSync("lsappinfo", ["list"], { encoding: "utf8" }).matchAll(/pid = (\d+) .*?type="(\w+)"/g)) types.set(Number(m[1]), m[2]!);
  return types;
}

/** The agents connected in the current test. */
let clients: McpClient[] = [];

/** Total cards per list_decks, or null when the app is not reachable. */
async function cards(c: McpClient): Promise<number | null> {
  const r = await c.call("list_decks", {});
  return r.isError ? null : (JSON.parse(r.text) as { cards: number }[]).reduce((n, d) => n + d.cards, 0);
}

/**
 * The app with agent access on and `n` agents connected; then the user closes the last window, which quits the app,
 * and only the MCP processes are left.
 */
async function onlyMcpLeft(n: number): Promise<void> {
  const app = await launch();
  const { page } = app;
  await useTestSettings(page);
  await page.evaluate(() => (location.hash = "#/settings"));
  await page.getByTestId("agent-access").check();
  const command = await agentCommand(page);
  await expect.poll(() => existsSync(path.join(app.userDataDir, "agent.sock"))).toBe(true);
  for (let i = 0; i < n; i++) clients.push(await startMcp(command));
  for (const c of clients) expect(await cards(c)).not.toBeNull();
  await app.close();
  expect(processes()).toEqual({ desktop: [], mcp: expect.arrayContaining(clients.map((c) => c.proc.pid)) });
  for (const c of clients) expect(await cards(c)).toBeNull();
}

async function oneDesktop(): Promise<number> {
  await expect.poll(() => processes().desktop.length, { timeout: 30_000 }).toBe(1);
  return processes().desktop[0]!;
}

test.afterEach(async () => {
  for (const pid of processes().desktop) process.kill(pid, "SIGTERM");
  await expect.poll(() => processes().desktop, { timeout: 20_000 }).toEqual([]);
  for (const c of clients) expect(await c.close()).toBe(0);
  clients = [];
});

for (const n of [1, 2]) {
  test(`opening the app while only ${n} MCP process(es) run starts one desktop window`, async () => {
    await onlyMcpLeft(n);

    // what a double-click in Finder does
    execFileSync("open", [bundle]);
    const desktop = await oneDesktop();
    // the window has loaded (agent calls need its page), and every agent uses it
    for (const c of clients) await expect.poll(() => cards(c), { timeout: 60_000, intervals: [500] }).not.toBeNull();
    await expect.poll(() => appTypes().get(desktop), { timeout: 10_000 }).toBe("Foreground");
    // the MCP processes stay in the background (no Dock icon)
    await expect.poll(() => clients.map((c) => appTypes().get(c.proc.pid!)), { timeout: 10_000 }).toEqual(clients.map(() => "UIElement"));

    // opening it again reaches the same desktop process instead of starting a second one
    execFileSync("open", [bundle]);
    await new Promise((r) => setTimeout(r, 5000));
    expect(processes().desktop).toEqual([desktop]);
    for (const c of clients) expect(await cards(c)).not.toBeNull();
  });
}
