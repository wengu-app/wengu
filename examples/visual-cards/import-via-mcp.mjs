#!/usr/bin/env node
/**
 * Imports the 4 high-school starter visual cards into a running Wengu desktop app via `wengu-mcp`.
 *
 * Prerequisites:
 *   1. Open Wengu Desktop and enable Settings -> Agents -> "Allow local agents".
 *   2. Make sure `wengu-mcp` has been built (`node apps/desktop/scripts/build-mcp.mjs`).
 *
 * Usage:
 *   node examples/visual-cards/import-via-mcp.mjs [--wengu-profile=/path/to/profile]
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

import { loadStarterCards, STARTER_DECK } from "./manifest.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

function resolveMcpBin() {
  if (process.env.WENGU_MCP_BIN) return process.env.WENGU_MCP_BIN;
  const osKey = process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : process.platform;
  const exe = process.platform === "win32" ? "wengu-mcp.exe" : "wengu-mcp";
  const bin = path.join(repoRoot, "apps/desktop/out/mcp", `${osKey}-${process.arch}`, exe);
  if (!existsSync(bin)) {
    throw new Error(`wengu-mcp binary not found at ${bin}. Run: node apps/desktop/scripts/build-mcp.mjs`);
  }
  return bin;
}

class McpClient {
  constructor(command, args) {
    this.proc = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    this.nextId = 1;
    this.pending = new Map();
    const rl = readline.createInterface({ input: this.proc.stdout });
    rl.on("line", (line) => {
      if (!line.trim()) return;
      const msg = JSON.parse(line);
      if (msg.id !== undefined) {
        const waiter = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        waiter?.(msg);
      }
    });
    this.proc.stderr.on("data", (chunk) => process.stderr.write(chunk));
  }

  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP timeout waiting for ${method}`));
      }, 30_000);
      this.pending.set(id, (msg) => {
        clearTimeout(timer);
        if (msg.error) reject(new Error(`${method} error: ${msg.error.message}`));
        else resolve(msg.result);
      });
      this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  notify(method, params) {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  async call(name, args) {
    const res = await this.request("tools/call", { name, arguments: args });
    if (res.isError) {
      const msg = res.content?.map((c) => c.text).join("\n") || "MCP tool call failed";
      throw new Error(`${name} failed:\n${msg}`);
    }
    return res.structuredContent ?? JSON.parse(res.content?.[0]?.text ?? "null");
  }

  async close() {
    this.proc.stdin.end();
    await new Promise((r) => this.proc.once("exit", r));
  }
}

const profileArgs = process.argv.slice(2).filter((a) => a.startsWith("--wengu-profile"));
const bin = resolveMcpBin();
const mcp = new McpClient(bin, profileArgs);

try {
  await mcp.request("initialize", {
    protocolVersion: "2025-11-25",
    clientInfo: { name: "starter-cards-importer", title: "Wengu Starter Cards", version: "1.0.0" },
  });
  mcp.notify("notifications/initialized", {});

  const cards = loadStarterCards();
  await mcp.call("create_deck", { name: STARTER_DECK });

  const existing = await mcp.call("search_notes", { deck: STARTER_DECK, limit: 200 });
  const existingByFront = new Map();
  for (const row of existing.notes ?? []) {
    existingByFront.set(row.first, row.id);
  }

  for (const card of cards) {
    const plainFront = card.front.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    let noteId = existingByFront.get(plainFront);
    if (!noteId) {
      const added = await mcp.call("add_notes", {
        deck: STARTER_DECK,
        notes: [{ fields: { Front: card.front, Back: card.back }, tags: card.tags }],
      });
      noteId = added.added[0].id;
    }

    const res = await mcp.call("set_visual_card", {
      noteId,
      id: card.id,
      title: card.title,
      libraries: card.libraries,
      sources: card.sources,
      source: card.source,
      props: card.defaultProps,
    });
    console.log(
      `[OK] ${card.subject} | ${card.title} (noteId=${noteId}, libs=${JSON.stringify(res.libraries)}, metrics=${JSON.stringify(res.metrics ?? null)})`,
    );
  }
} finally {
  await mcp.close();
}
