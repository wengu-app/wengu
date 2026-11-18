/** A minimal MCP client over stdio, started with the command the app shows in Settings, as an agent would. */
import { expect, type Page } from "@playwright/test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export class McpClient {
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
export async function startMcp(command: string[]): Promise<McpClient> {
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

/** The MCP command from Settings (the page must be on #/settings with agent access on). */
export async function agentCommand(page: Page): Promise<string[]> {
  const config = JSON.parse((await page.getByTestId("agent-config").textContent())!) as { mcpServers: { wengu: { command: string; args: string[] } } };
  return [config.mcpServers.wengu.command, ...config.mcpServers.wengu.args];
}
