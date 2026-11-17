#!/usr/bin/env node
/**
 * Minimal static server for the built app, mounted under a non-root path on purpose (default /wengu/), with no
 * rewrites and no special headers: the build must work as a plain directory of files.
 *   node scripts/serve.mjs [dir=dist] [port=5176] [prefix=/wengu/]
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

const dir = resolve(process.argv[2] ?? "dist");
const port = Number(process.argv[3] ?? 5176);
const prefix = process.argv[4] ?? "/wengu/";
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm",
  ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".map": "application/json",
};

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  if (!path.startsWith(prefix)) return res.writeHead(404).end();
  let file = resolve(join(dir, path.slice(prefix.length)));
  if (!file.startsWith(dir)) return res.writeHead(403).end();
  try {
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
    const body = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(port, "127.0.0.1", () => console.log(`serving ${dir} at http://localhost:${port}${prefix}`));
