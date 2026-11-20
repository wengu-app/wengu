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

import { buildMcp, hostTarget } from "./build-mcp.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (!args.some((a) => a.startsWith("--publish") || a === "-p")) args.push("--publish", "never");

function mcpTargets(cliArgs) {
  const oses = [];
  if (cliArgs.some((a) => a === "--mac" || a === "-m")) oses.push("mac");
  if (cliArgs.some((a) => a === "--linux" || a === "-l")) oses.push("linux");
  if (cliArgs.some((a) => a === "--win" || a === "-w")) oses.push("win");
  if (oses.length === 0) {
    if (cliArgs.includes("--dir")) return [hostTarget()];
    oses.push(process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : process.platform);
  }

  const arches = [];
  if (cliArgs.includes("--arm64")) arches.push("arm64");
  if (cliArgs.includes("--x64")) arches.push("x64");
  if (cliArgs.includes("--ia32")) arches.push("ia32");

  const targets = [];
  for (const osKey of oses) {
    if (arches.length > 0) {
      for (const a of arches) targets.push(`${osKey}-${a}`);
    } else if (osKey === "mac") {
      // electron-builder.yml builds both arm64 and x64 for macOS
      targets.push("mac-arm64", "mac-x64");
    } else if (osKey === "win") {
      targets.push("win-x64");
    } else {
      targets.push(`linux-${process.arch}`);
    }
  }
  return targets;
}

await buildMcp(mcpTargets(args));

const env = { ...process.env };
env.WENGU_UPDATE_URL ||= "https://github.com/wengu-app/downloads/releases/latest/download/";
if (!env.WENGU_UPDATE_URL.startsWith("https://")) throw new Error("WENGU_UPDATE_URL must use HTTPS");
if (process.platform === "darwin") {
  const hasSigning = Boolean(env.CSC_LINK || env.CSC_NAME);
  if (hasSigning) args.push("-c.forceCodeSigning=true");
  else args.push("-c.mac.identity=-");
  // Notarization is off in electron-builder.yml; CI and local releases turn it on with WENGU_NOTARIZE=1.
  if (env.WENGU_NOTARIZE === "1") {
    if (!hasSigning) throw new Error("WENGU_NOTARIZE=1 needs CSC_LINK or CSC_NAME");
    if (!env.APPLE_KEYCHAIN_PROFILE) {
      for (const name of ["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"]) {
        if (!env[name]) throw new Error(`WENGU_NOTARIZE=1 needs ${name} (or APPLE_KEYCHAIN_PROFILE)`);
      }
      if (!path.isAbsolute(env.APPLE_API_KEY)) throw new Error("APPLE_API_KEY must be an absolute path to the .p8 key");
    }
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
