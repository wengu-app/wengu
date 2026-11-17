import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { build as esbuild } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { FRAME_CSP, HOST_CSP } from "./src/frame/csp.ts";

const root = path.dirname(fileURLToPath(import.meta.url));
const FRAME_ENTRY = path.join(root, "src/frame/frame.ts");
const FRAME_FILE = "card-frame.html";

/**
 * The card frame document: a static HTML page with its own strict CSP and the frame script inlined.
 * It is loaded by URL into `<iframe sandbox="allow-scripts">` (opaque origin). A URL-loaded document does not inherit
 * the app page's CSP (a srcdoc frame would), so the app can keep `script-src 'self'` while deck templates get the
 * inline scripts they need, inside the sandbox only.
 */
async function frameHtml(minify: boolean): Promise<string> {
  const out = await esbuild({
    entryPoints: [FRAME_ENTRY],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "chrome110",
    minify,
    legalComments: "none",
  });
  const js = out.outputFiles[0]!.text.replace(/<\/script/gi, "<\\/script");
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script>${js}</script>
</head><body></body></html>
`;
}

function cardFrame(): Plugin {
  let minify = false;
  return {
    name: "wengu-card-frame",
    configResolved(c) {
      minify = c.command === "build";
    },
    configureServer(server) {
      server.watcher.add(path.join(root, "src/frame"));
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.split("?")[0]!.endsWith("/" + FRAME_FILE)) return next();
        try {
          res.setHeader("content-type", "text/html; charset=utf-8");
          res.setHeader("cache-control", "no-store");
          res.end(await frameHtml(false));
        } catch (e) {
          next(e);
        }
      });
    },
    async generateBundle() {
      this.emitFile({ type: "asset", fileName: FRAME_FILE, source: await frameHtml(minify) });
    },
  };
}

/** The app page's CSP, in the built index.html only (the dev server needs inline scripts for React refresh). */
function hostCsp(): Plugin {
  return {
    name: "wengu-host-csp",
    apply: "build",
    transformIndexHtml: {
      order: "pre",
      handler() {
        return [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: HOST_CSP }, injectTo: "head-prepend" }];
      },
    },
  };
}

export default defineConfig({
  // Relative asset URLs: the build works from any directory and from a custom scheme (Electron).
  base: "./",
  plugins: [react(), cardFrame(), hostCsp()],
  optimizeDeps: { exclude: ["@sqlite.org/sqlite-wasm"] },
  worker: { format: "es" },
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  preview: { host: "127.0.0.1", port: 5176, strictPort: true },
  build: {
    target: "chrome110",
    outDir: "dist",
    emptyOutDir: true,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 3000,
  },
});
