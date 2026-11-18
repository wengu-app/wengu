/**
 * Local agents over MCP: the command shown in Settings starts `--mcp`, which relays tool calls to the running app.
 * Covers access off (no socket), adding notes (visible in the app, with the agent's tag and an undo toast), errors
 * returned to the agent, and the agent list in Settings.
 */
import { expect, test } from "@playwright/test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { lineReader, MAX_LINE } from "../src/agentBridge.ts";
import { launch, useTestSettings, type Running } from "./launch.ts";

class McpClient {
  private next = 1;
  private buf = "";
  private readonly waiting = new Map<number, (msg: { result?: Record<string, unknown>; error?: { message: string } }) => void>();
  readonly stderr: string[] = [];
  constructor(readonly proc: ChildProcessWithoutNullStreams) {
    proc.stdout.on("data", (c: Buffer) => {
      this.buf += c.toString();
      let nl: number;
      while ((nl = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, nl);
        this.buf = this.buf.slice(nl + 1);
        const msg = JSON.parse(line) as { id: number; result?: Record<string, unknown>; error?: { message: string } };
        this.waiting.get(msg.id)?.(msg);
      }
    });
    proc.stderr.on("data", (c: Buffer) => this.stderr.push(c.toString()));
  }
  request(method: string, params: object = {}): Promise<{ result?: Record<string, unknown>; error?: { message: string } }> {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no answer to ${method}; stderr:\n${this.stderr.join("")}`)), 60_000);
      this.waiting.set(id, (m) => {
        clearTimeout(timer);
        resolve(m);
      });
      this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
  notify(method: string): void {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method }) + "\n");
  }
  async call(name: string, args: object): Promise<{ isError: boolean; text: string; data: unknown }> {
    const r = await this.request("tools/call", { name, arguments: args });
    const res = r.result as { content: { text: string }[]; isError?: boolean; structuredContent?: unknown };
    return { isError: !!res.isError, text: res.content[0]!.text, data: res.structuredContent };
  }
  close(): Promise<number | null> {
    this.proc.stdin.end();
    return new Promise((r) => (this.proc.exitCode !== null ? r(this.proc.exitCode) : this.proc.once("exit", (code) => r(code))));
  }
}

/** Starts the MCP server with the command the app shows in Settings, as an agent would. */
async function startMcp(command: string[]): Promise<McpClient> {
  const [exe, ...args] = command;
  const env = { ...process.env };
  delete env.WENGU_USER_DATA_DIR; // the command alone must name the profile
  if (process.env.APPIMAGE_EXTRACT_AND_RUN) env.APPIMAGE_EXTRACT_AND_RUN = "1";
  const client = new McpClient(spawn(exe!, args, { env, stdio: ["pipe", "pipe", "pipe"] }));
  const init = await client.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test-agent", title: "Test Agent", version: "9.9" } });
  expect(init.result).toMatchObject({ protocolVersion: "2025-06-18", serverInfo: { name: "wengu" }, capabilities: { tools: {} } });
  client.notify("notifications/initialized");
  return client;
}

test("agent messages preserve split UTF-8 characters and enforce the byte limit", () => {
  const lines: string[] = [];
  const read = lineReader((line) => lines.push(line));
  const message = Buffer.from("温故\nnext\n");
  expect(read(message.subarray(0, 2))).toBe(true);
  expect(read(message.subarray(2))).toBe(true);
  expect(read(Buffer.alloc(MAX_LINE + 1, 65))).toBe(false);
  const oversized = Buffer.alloc(MAX_LINE + 2, 65);
  oversized[oversized.length - 1] = 10;
  expect(lineReader((line) => lines.push(line))(oversized)).toBe(false);
  expect(lines).toEqual(["温故", "next"]);
});

let app: Running;
test.afterEach(async () => {
  await app?.close();
});

test("an agent adds notes through MCP while access is on", async () => {
  app = await launch();
  const { page } = app;
  await useTestSettings(page);
  await page.evaluate(() => (location.hash = "#/settings"));
  const access = page.getByTestId("agent-access");
  await expect(access).not.toBeChecked();
  await access.check();
  const config = JSON.parse((await page.getByTestId("agent-config").textContent())!) as { mcpServers: { wengu: { command: string; args: string[] } } };
  const command = [config.mcpServers.wengu.command, ...config.mcpServers.wengu.args];
  expect(command).toContain("--mcp");
  expect(command).toContain(`--wengu-profile=${app.userDataDir}`);
  expect(await page.getByTestId("agent-claude-command").textContent()).toMatch(/^claude mcp add --scope user wengu -- /);
  const socket = path.join(app.userDataDir, "agent.sock");
  await expect.poll(() => existsSync(socket)).toBe(true);

  const mcp = await startMcp(command);
  try {
    const tools = (await mcp.request("tools/list")).result!["tools"] as { name: string }[];
    expect(tools.map((t) => t.name)).toEqual(["list_decks", "list_note_types", "search_notes", "get_note", "create_deck", "add_notes", "update_note"]);

    const added = await mcp.call("add_notes", {
      deck: "Agent::Biology",
      notes: [{ fields: { Front: "What makes ATP?", Back: "Mitochondria" }, tags: ["bio"] }, { fields: { Front: "Where are proteins made?", Back: "Ribosomes" } }],
    });
    expect(added.isError).toBe(false);
    expect(added.data).toMatchObject({ deck: { name: "Agent::Biology" }, noteType: "Basic", tag: "agent::test-agent" });

    // the app shows it at once, and the batch can be undone from the toast
    await expect(page.locator(".toast").filter({ hasText: "Test Agent added 2 notes to Agent::Biology" })).toBeVisible();
    const found = await mcp.call("search_notes", { tags: ["agent::test-agent"] });
    expect(found.data).toMatchObject({ total: 2 });

    // input errors reach the agent; nothing is written
    const bad = await mcp.call("add_notes", { deck: "Agent::Biology", notes: [{ fields: { Question: "?" } }] });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain('"Basic" has no field "Question"; its fields are Front, Back');

    // the agent is listed in Settings
    await page.evaluate(() => (location.hash = "#/decks"));
    await page.evaluate(() => (location.hash = "#/settings"));
    const row = page.getByTestId("agent-row");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Test Agent");
    await expect(row).toContainText("9.9");
    await expect(row).toContainText("2 notes added");
    await expect(row).toContainText("agent::test-agent");

    // the deck is in the deck list
    await page.evaluate(() => (location.hash = "#/decks"));
    await expect(page.getByText("Biology", { exact: true }).first()).toBeVisible();

    // access off: the socket closes and the agent is told what to do
    await page.evaluate(() => (location.hash = "#/settings"));
    await page.getByTestId("agent-access").uncheck();
    await expect.poll(() => existsSync(socket)).toBe(false);
    const off = await mcp.call("list_decks", {});
    expect(off.isError).toBe(true);
    expect(off.text).toContain("Allow local agents");
  } finally {
    expect(await mcp.close()).toBe(0);
  }
});

test("undo from the toast removes the whole batch", async () => {
  app = await launch();
  const { page } = app;
  await useTestSettings(page);
  await page.evaluate(() => (location.hash = "#/settings"));
  await page.getByTestId("agent-access").check();
  const config = JSON.parse((await page.getByTestId("agent-config").textContent())!) as { mcpServers: { wengu: { command: string; args: string[] } } };
  const mcp = await startMcp([config.mcpServers.wengu.command, ...config.mcpServers.wengu.args]);
  try {
    const notes = Array.from({ length: 5 }, (_, i) => ({ fields: [`front ${i}`, `back ${i}`] }));
    expect((await mcp.call("add_notes", { deck: "Batch", notes })).isError).toBe(false);
    const toast = page.locator(".toast").filter({ hasText: "added 5 notes" });
    await toast.getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => ((await mcp.call("search_notes", { deck: "Batch" })).data as { total: number }).total).toBe(0);
  } finally {
    await mcp.close();
  }
});
