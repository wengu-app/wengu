import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const pkgRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(pkgRoot, 'demo'),
  plugins: [react()],
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
