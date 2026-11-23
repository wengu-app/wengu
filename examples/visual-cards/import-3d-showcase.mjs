#!/usr/bin/env node
/**
 * Imports 4 "true-3D advantage" showcase visual cards (Geography, Physics, Computer Science)
 * into a running Wengu desktop app via `wengu-mcp`.
 *
 * Usage:
 *   node examples/visual-cards/import-3d-showcase.mjs [--wengu-profile=/path/to/profile]
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

const DECK_NAME = "3D 空间直觉 · 地理 / 物理 / 计算机";

const CARDS = [
  {
    id: "geo.contour-terrain",
    title: "等高线 ↔ 3D 山体隆起与通视判断",
    subject: "地理",
    tags: ["地理", "等高线", "3D空间直觉"],
    front: "在等高线地形图上，如何根据等高线疏密区分凸坡与凹坡？哪种坡形会遮挡山顶到山脚的视线？",
    back: "<b>上疏下密为凸坡</b>（坡顶缓、坡脚陡，坡面向外鼓出，<b>不可通视</b>）；<b>上密下疏为凹坡</b>（坡顶陡、坡脚缓，坡面向内凹陷，<b>可以通视</b>）。",
    libraries: ["three"],
    sources: [{ title: "普通高中教科书 · 地理（等高线地形图判读）" }],
    file: "geo-contour-terrain.js",
    defaultProps: {},
  },
  {
    id: "phy.polarization",
    title: "3D 偏振光与三片偏振片悖论（马吕斯定律）",
    subject: "物理",
    tags: ["物理", "光学", "偏振", "3D空间直觉"],
    front: "两片透振方向互相垂直（0° 与 90°）的偏振片完全挡光。若在它们中间插入一片 45° 偏振片，最终还能透出光吗？为什么？",
    back: "<b>能透出光</b>（相对自然光光强为 <b>I₀ / 8</b>，相对第一片后为 <b>1 / 4</b>）。偏振片是对光波电矢量做<b>方向投影</b>（马吕斯定律 I = I₁ cos²θ）：0° 光经 45° 片后振动面转为 45°，再经 90° 片时仍有 cos 45° 水平分量得以透出。",
    libraries: ["three"],
    sources: [{ title: "普通高中教科书 · 物理 选择性必修1（光的偏振）" }],
    file: "phy-polarization.js",
    defaultProps: { variant: "three" },
  },
  {
    id: "cs.cnn-conv3d",
    title: "CNN 3D 张量与多通道卷积（参数量与输出通道）",
    subject: "计算机科学",
    tags: ["计算机科学", "深度学习", "CNN", "3D空间直觉"],
    front: "对 5×5×3（RGB）输入张量使用 4 个 3×3 卷积核（stride=1, padding=0），单个卷积核包含多少权重（不含偏置）？输出特征图的形状是什么？",
    back: "<b>单核权重 = 3 × 3 × 3 = 27</b>（卷积核深度必须等于输入通道 C_in = 3，跨全通道乘加求和得到 1 个输出切片）；<b>输出形状 = 3 × 3 × 4</b>（4 个独立卷积核堆叠出 C_out = 4 层，总权重 108）。",
    libraries: ["three"],
    sources: [{ title: "CS231n: Convolutional Neural Networks for Visual Recognition" }],
    file: "cs-cnn-conv3d.js",
    defaultProps: {},
  },
  {
    id: "cs.mvp-frustum",
    title: "图形学透视投影：视锥体 → NDC 立方体与 Z-buffer 非线性精度",
    subject: "计算机科学",
    tags: ["计算机科学", "计算机图形学", "MVP", "3D空间直觉"],
    front: "在计算机图形学中，透视投影矩阵与透视除法将视锥体（Frustum）映射到 [-1, 1]³ NDC 立方体后，等大物体和等距深度平面会发生什么变化？为什么远处容易发生 Z-fighting？",
    back: "<b>近大远小</b>（透视除法除以深度 z，把大远平面压回 [-1,1]²）；同时深度映射含 <b>1/z 非线性项</b>，原本等距的深度平面被剧烈挤压向 Far 平面（z = +1），导致远处深度缓冲精度极低、容易出现 Z-fighting。",
    libraries: ["three"],
    sources: [{ title: "GAMES101 / Real-Time Rendering（Perspective Projection & Depth Buffer）" }],
    file: "cs-mvp-frustum.js",
    defaultProps: {},
  },
];

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
    clientInfo: { name: "3d-showcase-importer", title: "Wengu 3D Showcase", version: "1.0.0" },
  });
  mcp.notify("notifications/initialized", {});

  await mcp.call("create_deck", { name: DECK_NAME });

  const existing = await mcp.call("search_notes", { deck: DECK_NAME, limit: 200 });
  const existingByFront = new Map();
  for (const row of existing.notes ?? []) {
    existingByFront.set(row.first, row.id);
  }

  for (const card of CARDS) {
    const source = readFileSync(path.join(here, card.file), "utf8");
    const plainFront = card.front.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    let noteId = existingByFront.get(plainFront);
    if (!noteId) {
      const added = await mcp.call("add_notes", {
        deck: DECK_NAME,
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
      source,
      props: card.defaultProps,
    });
    console.log(
      `[OK] ${card.subject} | ${card.title} (noteId=${noteId}, libs=${JSON.stringify(res.libraries)}, metrics=${JSON.stringify(res.metrics ?? null)})`,
    );
  }
} finally {
  await mcp.close();
}
