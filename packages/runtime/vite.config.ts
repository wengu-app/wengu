import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { hostPageCsp } from './src/host-csp.ts';

const pkgRoot = path.dirname(fileURLToPath(import.meta.url));

/** Sandbox origins of the `url` delivery mode (scripts/sandbox-server.mjs). localhost:5174 is the same-site variant. */
const SANDBOX_ORIGINS = ['http://127.0.0.1:5174', 'http://localhost:5174'];

/**
 * Every page gets the host-page CSP that blocks frame self-navigation, as the first element of <head>: the safe
 * configuration is the default one. The only way out is the test harness's `?hostcsp=0` (dev server only), which
 * exists solely for the tests that demonstrate the leak on an unprotected page.
 */
function hostCsp(): Plugin {
  return {
    name: 'wengu-host-csp',
    transformIndexHtml: {
      order: 'pre',
      handler(_html, ctx) {
        const url = new URL(ctx.originalUrl ?? ctx.path, 'http://x');
        if (url.pathname.endsWith('/harness.html') && url.searchParams.get('hostcsp') === '0') return [];
        return [
          {
            tag: 'meta',
            attrs: { 'http-equiv': 'Content-Security-Policy', content: hostPageCsp({ sandboxOrigin: SANDBOX_ORIGINS }) },
            injectTo: 'head-prepend',
          },
        ];
      },
    },
  };
}

export default defineConfig({
  root: path.join(pkgRoot, 'demo'),
  plugins: [hostCsp(), react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    fs: { allow: [pkgRoot] },
  },
  preview: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: {
    outDir: path.join(pkgRoot, 'dist/demo'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: path.join(pkgRoot, 'demo/index.html'),
        harness: path.join(pkgRoot, 'demo/harness.html'),
      },
    },
  },
});
