import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LibraryBundle, LibraryId } from '@wengu/runtime';

export const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LIBS_DIR = path.join(PKG_ROOT, 'generated/libs');
/** packages/runtime, resolved through the workspace dependency. */
export const RUNTIME_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.resolve('@wengu/runtime'))), '..');

export const LIBRARY_IDS: LibraryId[] = ['three', 'd3', 'katex'];

let cache: Record<string, LibraryBundle> | null = null;

/** The bundles built by scripts/build-libs.mjs. */
export function loadLibraries(): Record<string, LibraryBundle> {
  if (cache) return cache;
  const out: Record<string, LibraryBundle> = {};
  for (const id of LIBRARY_IDS) {
    const f = path.join(LIBS_DIR, `${id}.json`);
    if (!existsSync(f)) throw new Error(`missing ${f}: run \`corepack pnpm --filter @wengu/generator build:libs\``);
    out[id] = JSON.parse(readFileSync(f, 'utf8')) as LibraryBundle;
  }
  cache = out;
  return out;
}

/** Bare specifier -> library id, for every module a component may import. */
export function allowedSpecifiers(libs: Record<string, LibraryBundle> = loadLibraries()): Map<string, LibraryId> {
  const m = new Map<string, LibraryId>();
  for (const [id, bundle] of Object.entries(libs)) for (const spec of Object.keys(bundle.modules)) m.set(spec, id as LibraryId);
  return m;
}
