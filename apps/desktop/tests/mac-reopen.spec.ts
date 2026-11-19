/**
 * macOS, packaged app only: the standalone `wengu-mcp` Go proxy in `Contents/Resources/` must NOT register with
 * Launch Services as `dev.wengu.app`, so:
 *   1. Squirrel.Mac (`ShipIt`) sees zero running instances of `Wengu.app` after the desktop app quits for an update.
 *   2. Opening Wengu from Finder/Dock while MCP clients run starts one desktop window that those clients can use.
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
const mcpExe = path.join(bundle, "Contents/Resources/wengu-mcp");
test.skip(process.platform !== "darwin" || !exe.endsWith(".app/Contents/MacOS/Wengu"), "macOS packaged app only");

/** pids of this bundle's desktop main process and standalone `wengu-mcp` proxies. */
function processes(): { desktop: number[]; mcp: number[] } {
  const desktop: number[] = [];
  const mcp: number[] = [];
  for (const line of execFileSync("ps", ["-axo", "pid=,args="], { encoding: "utf8" }).split("\n")) {
    const m = /^\s*(\d+) (.*)$/.exec(line);
    if (!m) continue;
    const args = m[2]!;
    if (args === exe || args.startsWith(exe + " ")) desktop.push(Number(m[1]));
    else if (args === mcpExe || args.startsWith(mcpExe + " ")) mcp.push(Number(m[1]));
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
 * and only the standalone `wengu-mcp` processes are left.
 */
async function onlyMcpLeft(n: number): Promise<string> {
  const app = await launch();
  const { page } = app;
  await useTestSettings(page);
  await page.evaluate(() => (location.hash = "#/settings"));
  await page.getByTestId("agent-access").check();
  const command = await agentCommand(page);
  expect(command[0]).toBe(mcpExe);
  await expect.poll(() => existsSync(path.join(app.userDataDir, "agent.sock"))).toBe(true);
  for (let i = 0; i < n; i++) clients.push(await startMcp(command));
  for (const c of clients) expect(await cards(c)).not.toBeNull();
  await app.close();
  expect(processes()).toEqual({ desktop: [], mcp: expect.arrayContaining(clients.map((c) => c.proc.pid)) });
  // None of the MCP proxies may be registered with Launch Services (otherwise Squirrel.Mac ShipIt blocks updates).
  const registered = appTypes();
  for (const c of clients) expect(registered.has(c.proc.pid!)).toBe(false);
  for (const c of clients) expect(await cards(c)).toBeNull();
  return app.userDataDir;
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
    const userDataDir = await onlyMcpLeft(n);

    // what a double-click in Finder does (with --wengu-profile so the test stays isolated from the user's own profile)
    execFileSync("open", [bundle, "--args", `--wengu-profile=${userDataDir}`]);
    const desktop = await oneDesktop();
    // the window has loaded (agent calls need its page), and every agent uses it
    for (const c of clients) await expect.poll(() => cards(c), { timeout: 60_000, intervals: [500] }).not.toBeNull();
    await expect.poll(() => appTypes().get(desktop), { timeout: 10_000 }).toBe("Foreground");
    // the MCP proxies stay unregistered in Launch Services
    const registered = appTypes();
    for (const c of clients) expect(registered.has(c.proc.pid!)).toBe(false);

    // opening it again reaches the same desktop process instead of starting a second one
    execFileSync("open", [bundle]);
    await new Promise((r) => setTimeout(r, 5000));
    expect(processes().desktop).toEqual([desktop]);
    for (const c of clients) expect(await cards(c)).not.toBeNull();
  });
}
