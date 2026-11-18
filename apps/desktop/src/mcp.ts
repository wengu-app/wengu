/**
 * `Wengu --mcp`: a Model Context Protocol server on stdin/stdout for local agents (Claude Code, Codex, Cursor, …).
 *
 * It holds no data. `tools/list` is answered from the shared tool list; each `tools/call` is relayed over the profile's
 * agent socket (agentBridge.ts) to the running app, which must be open with agent access turned on. The protocol is
 * JSON-RPC 2.0, one message per line (MCP's stdio transport). Nothing but protocol messages may go to stdout.
 */
import net from "node:net";

import { AGENT_INSTRUCTIONS, AGENT_TOOL_NAMES, AGENT_TOOLS, type AgentClient, type AgentReply } from "../../web/src/agent/tools.ts";
import { agentSocketPath, lineReader } from "./agentBridge.ts";

const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
interface RpcMessage {
  jsonrpc: "2.0";
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export const NOT_REACHABLE =
  "Wengu (温故) is not reachable. Ask the user to open the Wengu desktop app and turn on Settings → Agents → “Allow local agents” (设置 → Agent → 允许本机 agent 访问), then try again.";

/** Sends one call to the app and waits for its reply. */
export function callApp(socketPath: string, tool: string, args: unknown, client: AgentClient, timeoutMs = 120_000): Promise<AgentReply> {
  return new Promise((resolve) => {
    const id = 1;
    const sock = net.createConnection(socketPath);
    let done = false;
    const finish = (r: AgentReply) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sock.destroy();
      resolve(r);
    };
    const timer = setTimeout(() => finish({ id, ok: false, error: "Wengu did not answer in time." }), timeoutMs);
    sock.on("connect", () => sock.write(JSON.stringify({ id, tool, args, client }) + "\n"));
    const feed = lineReader((line) => {
      try {
        finish(JSON.parse(line) as AgentReply);
      } catch {
        finish({ id, ok: false, error: "Wengu sent an invalid reply." });
      }
    });
    sock.on("data", (c: Buffer) => {
      if (!feed(c)) finish({ id, ok: false, error: "Wengu reply exceeds the size limit." });
    });
    sock.on("error", () => finish({ id, ok: false, error: NOT_REACHABLE }));
    sock.on("close", () => finish({ id, ok: false, error: NOT_REACHABLE }));
  });
}

export function runMcpServer(opts: { userData: string; version: string; exit(code: number): void }): void {
  const socketPath = agentSocketPath(opts.userData);
  let client: AgentClient = { name: "unknown" };
  const out = (msg: object): void => void process.stdout.write(JSON.stringify(msg) + "\n");
  const result = (id: RpcMessage["id"], value: Json | object) => out({ jsonrpc: "2.0", id, result: value });
  const error = (id: RpcMessage["id"], code: number, message: string) => out({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

  async function handle(msg: RpcMessage): Promise<void> {
    const { id, method, params = {} } = msg;
    const isRequest = id !== undefined && id !== null;
    switch (method) {
      case "initialize": {
        const info = params["clientInfo"] as Partial<AgentClient> | undefined;
        if (info && typeof info.name === "string" && info.name.trim()) {
          client = {
            name: info.name.trim().slice(0, 80),
            ...(typeof info.title === "string" ? { title: info.title.slice(0, 80) } : {}),
            ...(typeof info.version === "string" ? { version: info.version.slice(0, 40) } : {}),
          };
        }
        const asked = typeof params["protocolVersion"] === "string" ? (params["protocolVersion"] as string) : "";
        return result(id, {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0]!,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "wengu", title: "温故 Wengu", version: opts.version },
          instructions: AGENT_INSTRUCTIONS,
        });
      }
      case "ping":
        return result(id, {});
      case "tools/list":
        return result(id, { tools: AGENT_TOOLS });
      case "tools/call": {
        const name = params["name"];
        if (typeof name !== "string" || !AGENT_TOOL_NAMES.has(name)) return error(id, -32602, `Unknown tool: ${String(name)}`);
        const r = await callApp(socketPath, name, params["arguments"] ?? {}, client);
        if (r.ok) {
          const value = r.result as Json;
          return result(id, {
            content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
            ...(value && typeof value === "object" && !Array.isArray(value) ? { structuredContent: value } : {}),
          });
        }
        return result(id, { content: [{ type: "text", text: r.error }], isError: true });
      }
      default:
        if (isRequest) error(id, -32601, `Method not found: ${String(method)}`);
      // notifications (initialized, cancelled, …) need no answer
    }
  }

  // Requests run one after another, in order (the app serialises writes anyway).
  let chain = Promise.resolve();
  const feed = lineReader((line) => {
    let msg: RpcMessage;
    try {
      msg = JSON.parse(line) as RpcMessage;
    } catch {
      error(null, -32700, "Parse error");
      return;
    }
    if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
      error(null, -32600, "Invalid request");
      return;
    }
    chain = chain.then(() => handle(msg)).catch((e: unknown) => error(msg.id, -32603, e instanceof Error ? e.message : String(e)));
  });
  process.stdin.on("data", (c: Buffer) => {
    if (!feed(c)) opts.exit(1);
  });
  // the agent went away (EPIPE): nobody is left to answer. Unhandled, this error keeps the process running for good.
  process.stdout.on("error", () => opts.exit(0));
  process.stdin.on("error", () => opts.exit(0));
  // exit once the answers are written (stdout to a pipe is asynchronous on macOS and Windows)
  process.stdin.on("end", () => void chain.then(() => process.stdout.write("", () => opts.exit(0))));
  process.stdin.resume();
}
