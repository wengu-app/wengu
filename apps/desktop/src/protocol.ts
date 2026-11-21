/**
 * The app scheme. The web build is served from `wengu://app/…`, a standard, secure, fetch-capable scheme: the page is a
 * secure context with its own origin, so OPFS, Web Locks and module workers work as on https, and `'self'` in the
 * page's CSP means exactly the app's files.
 *
 * Every HTML response carries its Content-Security-Policy as a response header (the same policies the web build puts
 * in its <meta> tags, imported from the web app's source so they cannot drift). Only files inside the web build are
 * served; nothing else on disk is reachable.
 */
import { protocol } from "electron";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { FRAME_CSP, HOST_CSP, VISUAL_FRAME_CSP } from "../../web/src/frame/csp.ts";

export const SCHEME = "wengu";
export const HOST = "app";
export const APP_ORIGIN = `${SCHEME}://${HOST}`;
export const APP_URL = `${APP_ORIGIN}/index.html`;

/**
 * Workers (the database worker, SQLite's helpers) get their CSP from their own response. They need WebAssembly
 * compilation and nothing from outside the app.
 */
export const WORKER_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "connect-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
].join("; ");

const PERMISSIONS_POLICY = [
  "camera=()",
  "microphone=()",
  "geolocation=()",
  "payment=()",
  "usb=()",
  "serial=()",
  "hid=()",
  "display-capture=()",
  "screen-wake-lock=()",
  "publickey-credentials-get=()",
].join(", ");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".map": "application/json",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

/** Must run before `app` is ready. */
export function registerSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true },
    },
  ]);
}

/** Response headers for a file of the web build; exported for tests. */
export function headersFor(file: string): Record<string, string> {
  const ext = path.extname(file).toLowerCase();
  const h: Record<string, string> = {
    "content-type": MIME[ext] ?? "application/octet-stream",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "cache-control": "no-cache",
  };
  const base = path.basename(file);
  if (base === "card-frame.html") h["content-security-policy"] = FRAME_CSP;
  else if (base === "visual-frame.html") h["content-security-policy"] = VISUAL_FRAME_CSP;
  else if (ext === ".html") {
    h["content-security-policy"] = HOST_CSP;
    h["permissions-policy"] = PERMISSIONS_POLICY;
  } else if (ext === ".js" || ext === ".mjs") h["content-security-policy"] = WORKER_CSP;
  return h;
}

/** Serves `webRoot` at wengu://app/. Must run after `app` is ready. */
export function handleAppScheme(webRoot: string): void {
  const root = path.resolve(webRoot);
  protocol.handle(SCHEME, async (request) => {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return new Response("bad request", { status: 400 });
    }
    if (url.host !== HOST || (request.method !== "GET" && request.method !== "HEAD")) return new Response("not found", { status: 404 });
    let rel: string;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch {
      return new Response("bad request", { status: 400 });
    }
    if (rel === "/" || rel === "") rel = "/index.html";
    const file = path.resolve(root, "." + rel);
    if (file !== root && !file.startsWith(root + path.sep)) return new Response("forbidden", { status: 403 });
    try {
      const body = await readFile(file);
      return new Response(request.method === "HEAD" ? null : body, { status: 200, headers: headersFor(file) });
    } catch {
      return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
    }
  });
}
