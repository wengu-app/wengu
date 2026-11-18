#!/usr/bin/env node
/**
 * Runs electron-builder with the given arguments (always `--publish never` unless overridden).
 * electron-builder shells out to `pnpm list`; where pnpm is only available through corepack (`corepack pnpm`),
 * a temporary `pnpm` shim is put on PATH for it.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (!args.some((a) => a.startsWith("--publish") || a === "-p")) args.push("--publish", "never");

const env = { ...process.env };
env.WENGU_UPDATE_URL ||= "https://github.com/wengu-app/downloads/releases/latest/download/";
if (!env.WENGU_UPDATE_URL.startsWith("https://")) throw new Error("WENGU_UPDATE_URL must use HTTPS");
if (process.platform === "darwin") {
  if (env.CSC_LINK) args.push("-c.forceCodeSigning=true");
  else args.push("-c.mac.identity=-");
  // Notarization is off in electron-builder.yml; the macOS CI job turns it on with WENGU_NOTARIZE=1.
  if (env.WENGU_NOTARIZE === "1") {
    for (const name of ["CSC_LINK", "APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"]) {
      if (!env[name]) throw new Error(`WENGU_NOTARIZE=1 needs ${name}`);
    }
    if (!path.isAbsolute(env.APPLE_API_KEY)) throw new Error("APPLE_API_KEY must be an absolute path to the .p8 key");
    args.push("-c.mac.notarize=true");
  }
}
const hasPnpm = spawnSync(process.platform === "win32" ? "where" : "which", ["pnpm"], { stdio: "ignore" }).status === 0;
if (!hasPnpm && process.platform !== "win32") {
  const dir = mkdtempSync(path.join(tmpdir(), "wengu-pnpm-shim-"));
  const shim = path.join(dir, "pnpm");
  writeFileSync(shim, '#!/bin/sh\nexec corepack pnpm "$@"\n');
  chmodSync(shim, 0o755);
  env.PATH = `${dir}${path.delimiter}${env.PATH ?? ""}`;
}

const cli = path.join(path.dirname(createRequire(import.meta.url).resolve("electron-builder/package.json")), "cli.js");
const r = spawnSync(process.execPath, [cli, ...args], { cwd: root, stdio: "inherit", env });
process.exit(r.status ?? 1);
