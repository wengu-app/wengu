#!/usr/bin/env node
/**
 * Generates the MCP tool manifest from apps/web/src/agent/tools.ts (and apps/desktop/package.json's version) and
 * compiles the standalone Go MCP proxy (`apps/desktop/mcp`) into `out/mcp/<os>-<arch>/wengu-mcp[.exe]`.
 *
 * Usage:
 *   node scripts/build-mcp.mjs                        # host os-arch
 *   node scripts/build-mcp.mjs --targets=mac-arm64,mac-x64
 */
import { build as esbuild } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mcpDir = path.join(desktopRoot, "mcp");
const toolsTs = path.resolve(desktopRoot, "../web/src/agent/tools.ts");
const manifestOut = path.join(mcpDir, "cmd/wengu-mcp/tools_gen.json");

const OS_TO_GOOS = { mac: "darwin", linux: "linux", win: "windows" };
const ARCH_TO_GOARCH = { arm64: "arm64", x64: "amd64", ia32: "386" };

export function hostTarget() {
  const osKey = process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : process.platform;
  return `${osKey}-${process.arch}`;
}

export async function generateManifest() {
  const pkg = JSON.parse(readFileSync(path.join(desktopRoot, "package.json"), "utf8"));
  const bundled = await esbuild({
    entryPoints: [toolsTs],
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    target: "es2022",
  });
  const code = bundled.outputFiles[0].text;
  const mod = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
  const manifest = {
    version: pkg.version,
    instructions: mod.AGENT_INSTRUCTIONS,
    tools: mod.AGENT_TOOLS,
  };
  mkdirSync(path.dirname(manifestOut), { recursive: true });
  writeFileSync(manifestOut, JSON.stringify(manifest, null, 2) + "\n");
}

export async function buildMcp(targets = [hostTarget()]) {
  await generateManifest();
  const unique = [...new Set(targets)];
  for (const target of unique) {
    const [osKey, archKey] = target.split("-");
    const goos = OS_TO_GOOS[osKey];
    const goarch = ARCH_TO_GOARCH[archKey];
    if (!goos || !goarch) throw new Error(`Unsupported MCP build target: ${target}`);
    const outDir = path.join(desktopRoot, "out/mcp", target);
    mkdirSync(outDir, { recursive: true });
    const bin = osKey === "win" ? "wengu-mcp.exe" : "wengu-mcp";
    const outPath = path.join(outDir, bin);
    const r = spawnSync("go", ["build", "-trimpath", "-ldflags=-s -w", "-o", outPath, "./cmd/wengu-mcp"], {
      cwd: mcpDir,
      stdio: "inherit",
      env: { ...process.env, CGO_ENABLED: "0", GOOS: goos, GOARCH: goarch },
    });
    if (r.error) throw new Error(`Failed to run go build for ${target}: ${r.error.message}`);
    if (r.status !== 0) throw new Error(`go build failed for ${target} with exit code ${r.status}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = process.argv.find((a) => a.startsWith("--targets="));
  const targets = arg ? arg.slice("--targets=".length).split(",").filter(Boolean) : [hostTarget()];
  await buildMcp(targets);
}
