#!/usr/bin/env node
/**
 * Development shell.
 *   pnpm dev          bundles main/preload and runs Electron against the web build (apps/web/dist, built if missing)
 *   pnpm dev:vite     runs the web app's Vite dev server too and points the shell at it (hot reload; no CSP header)
 * Extra arguments go to Electron, e.g. `pnpm dev -- --no-sandbox` on hosts without a usable Chromium sandbox, or a
 * path to an .apkg to import it. VITE_PORT picks the dev server port (default 5173, the web app's own).
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const web = path.resolve(root, "../web");
const args = process.argv.slice(2).filter((a) => a !== "--" );
const vite = args.includes("--vite");
const extra = args.filter((a) => a !== "--vite");

const run = (cmd, argv, opts = {}) => {
  const r = spawnSync(cmd, argv, { stdio: "inherit", ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run(process.execPath, [path.join(root, "scripts/build.mjs")]);
const env = { ...process.env };
let server = null;
if (vite) {
  const port = process.env.VITE_PORT ?? "5173";
  server = spawn("corepack", ["pnpm", "exec", "vite", "--port", port, "--strictPort"], { cwd: web, stdio: "inherit" });
  env.WENGU_DEV_URL = `http://127.0.0.1:${port}/`;
  // wait for the server
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(env.WENGU_DEV_URL);
      if (r.ok) break;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
} else if (!existsSync(path.join(web, "dist/index.html"))) {
  run("corepack", ["pnpm", "--filter", "@wengu/web", "build"], { cwd: root });
}

const electron = createRequire(import.meta.url)("electron");
const child = spawn(electron, [root, ...extra], { stdio: "inherit", env });
child.on("exit", (code) => {
  server?.kill();
  process.exit(code ?? 0);
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
