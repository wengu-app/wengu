/**
 * The local channel between `wengu-mcp` processes (started by agents such as Claude Code) and the running app.
 *
 * The app listens on a Unix socket in the profile directory (a named pipe on Windows) only while the user has turned
 * on agent access in Settings. No TCP port is opened, so the shell still has no network. Each connection carries
 * newline-delimited JSON: `AgentCall` in, `AgentReply` out. The main process relays calls to the page, which runs
 * them through the same database client as the UI (see apps/web/src/agent).
 */
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, unlinkSync } from "node:fs";
import net from "node:net";
import path from "node:path";

import type { AgentAnswer, AgentCall, AgentReply } from "../../web/src/agent/tools.ts";

/** Socket path for a profile directory (`wengu-mcp` computes the same from the same profile). */
export function agentSocketPath(userData: string): string {
  if (process.platform === "win32") return `\\\\.\\pipe\\wengu-agent-${createHash("sha256").update(path.resolve(userData)).digest("hex").slice(0, 16)}`;
  return path.join(userData, "agent.sock");
}

/** At most this much JSON per line (a batch of 500 long notes fits easily). */
export const MAX_LINE = 16 * 1024 * 1024;

/** Splits a stream into lines; calls `onLine` for each complete one. Returns false once the buffer limit is exceeded. */
export function lineReader(onLine: (line: string) => void): (chunk: Buffer) => boolean {
  let parts: Buffer[] = [];
  let size = 0;
  return (chunk) => {
    let start = 0;
    while (start < chunk.length) {
      const nl = chunk.indexOf(10, start);
      const part = chunk.subarray(start, nl < 0 ? chunk.length : nl);
      size += part.length;
      if (size > MAX_LINE) return false;
      parts.push(part);
      if (nl < 0) break;
      const line = Buffer.concat(parts, size).toString("utf8").trim();
      parts = [];
      size = 0;
      if (line) onLine(line);
      start = nl + 1;
    }
    return true;
  };
}

export class AgentBridge {
  private server: net.Server | null = null;
  private readonly sockets = new Set<net.Socket>();
  readonly path: string;

  constructor(
    userData: string,
    private readonly run: (call: Omit<AgentCall, "id">) => Promise<AgentAnswer>,
    private readonly log: (msg: string) => void = () => {},
  ) {
    this.path = agentSocketPath(userData);
  }

  get enabled(): boolean {
    return this.server !== null;
  }

  setEnabled(on: boolean): void {
    if (on && !this.server) this.start();
    else if (!on && this.server) this.stop();
  }

  private start(): void {
    const server = net.createServer((socket) => this.serve(socket));
    this.server = server;
    if (process.platform !== "win32") {
      mkdirSync(path.dirname(this.path), { recursive: true, mode: 0o700 });
      // a socket left by a crash (only one app instance runs per profile, so nobody else owns it)
      try {
        unlinkSync(this.path);
      } catch {
        /* none */
      }
    }
    server.on("error", (e) => {
      this.log(`agent socket error: ${String(e)}`);
      if (this.server === server) this.stop();
    });
    server.listen(this.path, () => {
      if (process.platform !== "win32") chmodSync(this.path, 0o600);
      this.log(`agent access on at ${this.path}`);
    });
  }

  private stop(): void {
    const server = this.server;
    this.server = null;
    if (!server) return;
    for (const s of this.sockets) s.destroy();
    this.sockets.clear();
    server.close();
    if (process.platform !== "win32") {
      try {
        unlinkSync(this.path);
      } catch {
        /* already gone */
      }
    }
    this.log("agent access off");
  }

  close(): void {
    this.stop();
  }

  private serve(socket: net.Socket): void {
    this.sockets.add(socket);
    socket.on("close", () => this.sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    const send = (r: AgentReply) => {
      if (!socket.destroyed) socket.write(JSON.stringify(r) + "\n");
    };
    const feed = lineReader((line) => {
      let call: AgentCall;
      try {
        call = JSON.parse(line) as AgentCall;
        if (typeof call.id !== "number" || typeof call.tool !== "string" || !call.client || typeof call.client.name !== "string") throw new Error("bad call");
      } catch {
        socket.destroy();
        return;
      }
      const { id, ...rest } = call;
      this.run(rest).then(
        (r) => send({ ...r, id } as AgentReply),
        (e: unknown) => send({ id, ok: false, error: e instanceof Error ? e.message : String(e) }),
      );
    });
    socket.on("data", (chunk: Buffer) => {
      if (!feed(chunk)) socket.destroy();
    });
  }
}
