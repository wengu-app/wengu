/**
 * Local servers for the self-check and the viewer:
 *  - app server on http://localhost:<port>: host page (/host.html) and viewer (/viewer.html), both served with the
 *    runtime's hostPageCsp() as a response header; library bundles; generated components (read-only).
 *  - sandbox server on http://127.0.0.1:<port>/sandbox.html: the runtime's sandbox document with the frame CSP,
 *    `sandbox allow-scripts` and `frame-ancestors` = the app server. localhost and 127.0.0.1 are different sites, so
 *    the component frame gets its own renderer process (as in production `url` delivery).
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { buildFrameDocument, FRAME_CSP, hostPageCsp } from '@wengu/runtime';
import { LIBS_DIR, PKG_ROOT } from '../libraries.ts';

export interface Servers {
  appUrl: string;
  sandboxUrl: string;
  close(): Promise<void>;
}

const bundles = new Map<string, Promise<string>>();
function bundle(entry: string): Promise<string> {
  let p = bundles.get(entry);
  if (!p) {
    p = esbuild
      .build({
        entryPoints: [path.join(PKG_ROOT, 'src/sandbox', entry)],
        bundle: true,
        format: 'esm',
        target: 'es2022',
        write: false,
        minify: false,
        logLevel: 'silent',
      })
      .then((r) => r.outputFiles[0]!.text);
    bundles.set(entry, p);
  }
  return p;
}

const HOST_HTML = (sandboxUrl: string) => `<!doctype html>
<html><head><meta charset="utf-8"><title>wengu generator self-check</title>
<style>html,body{margin:0;background:#fff}#slot{width:720px;padding:0}</style>
<script>window.WG_CONFIG=${JSON.stringify({ sandboxUrl })}</script>
<script type="module" src="/host.js"></script></head>
<body><div id="slot"></div></body></html>`;

const VIEWER_HTML = (sandboxUrl: string) => `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Wengu generated components</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:var(--wg-color-background);color:var(--wg-color-text);font:14px/1.5 var(--wg-font-sans)}
.wrap{display:grid;grid-template-columns:280px 1fr;min-height:100vh}
nav{border-right:1px solid var(--wg-color-border);padding:16px;display:flex;flex-direction:column;gap:6px;overflow:auto}
nav h1{font-size:15px;margin:0 0 8px}
.item{all:unset;cursor:pointer;display:grid;grid-template-columns:18px 1fr;gap:0 6px;padding:8px 10px;border-radius:8px}
.item:hover{background:var(--wg-color-surface)}
.item.active{background:var(--wg-color-surface);box-shadow:0 0 0 1px var(--wg-color-border)}
.item small{grid-column:2;color:var(--wg-color-text-muted);font-size:12px}
.st.ok{color:var(--wg-color-success)}.st.bad{color:var(--wg-color-danger)}
main{padding:24px;max-width:860px}
header{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
header h2{margin:0;font-size:18px;flex:1}
button.ctl{font:inherit;padding:6px 12px;border-radius:8px;border:1px solid var(--wg-color-border);background:var(--wg-color-surface);color:var(--wg-color-text);cursor:pointer}
#meta{color:var(--wg-color-text-muted);font-size:12px;margin-bottom:12px}#meta a{color:var(--wg-color-accent)}
#slot{max-width:760px;border-radius:12px;overflow:hidden;box-shadow:0 0 0 1px var(--wg-color-border);background:var(--wg-color-surface)}
#log{list-style:none;padding:0;font:12px/1.6 var(--wg-font-mono);color:var(--wg-color-text-muted)}
#log .ok{color:var(--wg-color-success)}#log .bad{color:var(--wg-color-danger)}#log .warn{color:var(--wg-color-warning)}
#result{font:12px var(--wg-font-mono);white-space:pre-wrap;color:var(--wg-color-text)}
</style>
<script>window.WG_CONFIG=${JSON.stringify({ sandboxUrl })}</script>
<script type="module" src="/viewer.js"></script></head>
<body><div class="wrap"><nav id="list"><h1>温故 · generated components</h1></nav>
<main><header><h2 id="title">…</h2><button class="ctl" id="mode">mode</button><button class="ctl" id="theme">theme</button><button class="ctl" id="remount">重新加载 remount</button></header>
<div id="meta"></div><div id="slot"></div><pre id="result"></pre><ul id="log"></ul></main></div></body></html>`;

interface ListedComponent {
  name: string;
  manifest: unknown;
  accepted: boolean | null;
  attempts: number | null;
  costUsd: number | null;
  model: string | null;
}

/** Component directories: any directory (up to two levels deep) with component.js + manifest.json. */
function listComponents(root: string): Array<{ name: string; dir: string }> {
  const out: Array<{ name: string; dir: string }> = [];
  const visit = (dir: string, rel: string, depth: number) => {
    if (existsSync(path.join(dir, 'component.js')) && existsSync(path.join(dir, 'manifest.json'))) out.push({ name: rel || '.', dir });
    if (depth >= 2) return;
    for (const d of readdirSync(dir).sort()) {
      if (d.startsWith('.') || d === 'attempts' || d === 'node_modules') continue;
      const p = path.join(dir, d);
      if (statSync(p).isDirectory()) visit(p, rel ? `${rel}/${d}` : d, depth + 1);
    }
  };
  if (existsSync(root)) visit(root, '', 0);
  return out;
}

const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.html': 'text/html; charset=utf-8',
};

export async function startServers(opts: { componentsDir?: string; appPort?: number; sandboxPort?: number } = {}): Promise<Servers> {
  const sandbox = http.createServer();
  await new Promise<void>((r) => sandbox.listen(opts.sandboxPort ?? 0, '127.0.0.1', r));
  const sandboxPort = (sandbox.address() as AddressInfo).port;
  const sandboxUrl = `http://127.0.0.1:${sandboxPort}/sandbox.html`;

  const app = http.createServer();
  await new Promise<void>((r) => app.listen(opts.appPort ?? 0, '127.0.0.1', r));
  const appPort = (app.address() as AddressInfo).port;
  const appOrigin = `http://localhost:${appPort}`;
  const csp = hostPageCsp({ sandboxOrigin: `http://127.0.0.1:${sandboxPort}` });
  const frameDoc = buildFrameDocument();

  sandbox.on('request', (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname !== '/sandbox.html') return void res.writeHead(404).end();
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': `${FRAME_CSP}; sandbox allow-scripts; frame-ancestors ${appOrigin}`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    });
    res.end(frameDoc);
  });

  const componentsDir = opts.componentsDir ? path.resolve(opts.componentsDir) : null;
  app.on('request', (req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://x');
      const p = decodeURIComponent(url.pathname);
      const send = (status: number, type: string, body: string | Buffer, extra: Record<string, string> = {}) => {
        res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...extra });
        res.end(body);
      };
      try {
        if (p === '/favicon.ico') return send(204, 'text/plain', '');
        if (p === '/host.html') return send(200, TYPES['.html']!, HOST_HTML(sandboxUrl), { 'content-security-policy': csp });
        if (p === '/' || p === '/viewer.html') return send(200, TYPES['.html']!, VIEWER_HTML(sandboxUrl), { 'content-security-policy': csp });
        if (p === '/host.js') return send(200, TYPES['.js']!, await bundle('host-page.ts'));
        if (p === '/viewer.js') return send(200, TYPES['.js']!, await bundle('viewer-page.ts'));
        const lib = /^\/libs\/(three|d3|katex)\.json$/.exec(p);
        if (lib) return send(200, TYPES['.json']!, readFileSync(path.join(LIBS_DIR, `${lib[1]}.json`)));
        if (componentsDir && p === '/api/components') {
          const list: ListedComponent[] = listComponents(componentsDir).map(({ name, dir }) => {
            const reportPath = path.join(dir, 'report.json');
            const report = existsSync(reportPath)
              ? (JSON.parse(readFileSync(reportPath, 'utf8')) as { accepted?: boolean; attempts?: unknown[]; totals?: { costUsd?: number }; generatorModel?: string })
              : null;
            return {
              name,
              manifest: JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as unknown,
              accepted: report ? !!report.accepted : null,
              attempts: report?.attempts?.length ?? null,
              costUsd: report?.totals?.costUsd ?? null,
              model: report?.generatorModel ?? null,
            };
          });
          return send(200, TYPES['.json']!, JSON.stringify(list));
        }
        const comp = /^\/components\/(.+)$/.exec(p);
        if (componentsDir && comp) {
          const file = path.resolve(componentsDir, comp[1]!);
          if (!file.startsWith(componentsDir + path.sep) || !existsSync(file) || !statSync(file).isFile()) return send(404, 'text/plain', 'not found');
          // Component source is served as plain text: it is only ever executed inside the sandbox, never by this page.
          const ext = path.extname(file);
          const type = ext === '.js' ? 'text/plain; charset=utf-8' : (TYPES[ext] ?? 'application/octet-stream');
          return send(200, type, readFileSync(file), { 'x-content-type-options': 'nosniff' });
        }
        send(404, 'text/plain', 'not found');
      } catch (e) {
        send(500, 'text/plain', String(e));
      }
    })();
  });

  return {
    appUrl: appOrigin,
    sandboxUrl,
    async close() {
      app.closeAllConnections();
      sandbox.closeAllConnections();
      await Promise.all([new Promise((r) => app.close(r)), new Promise((r) => sandbox.close(r))]);
    },
  };
}
