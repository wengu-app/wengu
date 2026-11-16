// Serves the sandbox document from a separate origin, for the `url` delivery mode.
//   node scripts/sandbox-server.mjs [port]      (default 5174)
// Open the app at http://localhost:5173 and use http://127.0.0.1:5174/sandbox.html as the sandbox URL: localhost and
// 127.0.0.1 are different *sites*, which is what Chromium's site isolation keys processes on. (A different port on the
// same hostname is the same site.)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] ?? process.env.SANDBOX_PORT ?? 5174);
const ancestors = process.env.SANDBOX_ANCESTORS ?? 'http://localhost:5173 http://127.0.0.1:5173';
const { FRAME_CSP } = await import(pathToFileURL(path.join(pkgRoot, 'src/frame-document.ts')).href);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname !== '/sandbox.html') {
    res.writeHead(404).end();
    return;
  }
  // Re-read on each request so `npm run build:frame` takes effect without a restart.
  const html = await readFile(path.join(pkgRoot, 'generated/sandbox.html'));
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    // Same policy as the <meta> in the document, plus what only a header can do:
    //  - sandbox: the document is sandboxed even if opened top-level or framed without the sandbox attribute;
    //  - frame-ancestors: only the app may embed it.
    'content-security-policy': `${FRAME_CSP}; sandbox allow-scripts; frame-ancestors ${ancestors}`,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  res.end(html);
});
server.listen(port, () => console.log(`sandbox server: http://127.0.0.1:${port}/sandbox.html`));
