#!/usr/bin/env node
/** Bundles the main process and the preload (TypeScript) into out/*.cjs with esbuild, and builds the Go MCP proxy. `--watch` to rebuild on change. */
import { context, build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { buildMcp } from "./build-mcp.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = {
  absWorkingDir: root,
  entryPoints: { main: "src/main.ts", preload: "src/preload.ts" },
  outdir: "out",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron", "electron-updater", "builder-util-runtime"],
  sourcemap: "linked",
  legalComments: "none",
  logLevel: "info",
};

await buildMcp();
if (process.argv.includes("--watch")) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
