// Builds the library bundles the generator offers to components, in the runtime's LibraryBundle format
// ({ id, version, modules: { specifier: source }, styles? }):
//
//   three  copied from @wengu/runtime (packages/runtime/generated/libs/three.json, built by its build:frame script)
//   d3     bundled here: one self-contained ES module, specifier 'd3'
//   katex  bundled here: specifier 'katex', CSS with the woff2 fonts inlined as data: URLs (the frame cannot fetch)
//
// Output: generated/libs/{three,d3,katex}.json. `--if-missing` skips the build when all three exist.
//
// NOTE: d3 and katex are allowed LibraryIds in the runtime's manifest contract, but the runtime only builds three.
// They are bundled here so the generator can offer them; in the app this belongs next to the runtime's three bundle.

import * as esbuild from 'esbuild';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, '..');
const require = createRequire(import.meta.url);
const outDir = path.join(pkgRoot, 'generated/libs');
const runtimeRoot = path.resolve(path.dirname(require.resolve('@wengu/runtime')), '..');
const runtimeThree = path.join(runtimeRoot, 'generated/libs/three.json');
const runtimeBootstrap = path.join(runtimeRoot, 'src/generated/frame-bootstrap.ts');

const targets = ['three', 'd3', 'katex'].map((id) => path.join(outDir, `${id}.json`));
if (process.argv.includes('--if-missing') && targets.every((t) => existsSync(t)) && existsSync(runtimeBootstrap)) process.exit(0);

await mkdir(outDir, { recursive: true });

// ------------------------------------------------------------------------------------------ runtime (three + bootstrap)
if (!existsSync(runtimeThree) || !existsSync(runtimeBootstrap)) {
  console.log('building @wengu/runtime frame + three bundle (its build:frame script) ...');
  execFileSync(process.execPath, [path.join(runtimeRoot, 'scripts/build-frame.mjs')], { stdio: 'inherit', cwd: runtimeRoot });
}
await copyFile(runtimeThree, path.join(outDir, 'three.json'));

// ------------------------------------------------------------------------------------------ d3
const d3Pkg = JSON.parse(await readFile(path.join(pkgRoot, 'node_modules/d3/package.json'), 'utf8'));
const d3 = await esbuild.build({
  stdin: { contents: "export * from 'd3';", resolveDir: pkgRoot, loader: 'js' },
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  write: false,
  legalComments: 'inline',
});
await writeFile(path.join(outDir, 'd3.json'), JSON.stringify({ id: 'd3', version: d3Pkg.version, modules: { d3: d3.outputFiles[0].text } }));

// ------------------------------------------------------------------------------------------ katex
const katexRoot = path.join(pkgRoot, 'node_modules/katex');
const katexPkg = JSON.parse(await readFile(path.join(katexRoot, 'package.json'), 'utf8'));
const katexJs = await esbuild.build({
  entryPoints: [path.join(katexRoot, 'dist/katex.mjs')],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  write: false,
  legalComments: 'inline',
});
let css = await readFile(path.join(katexRoot, 'dist/katex.min.css'), 'utf8');
const fontCache = new Map();
css = await replaceAsync(css, /src:url\(fonts\/([^)]+)\.woff2\) format\("woff2"\)[^;}]*/g, async (_m, name) => {
  if (!fontCache.has(name)) {
    const b = await readFile(path.join(katexRoot, 'dist/fonts', `${name}.woff2`));
    fontCache.set(name, `data:font/woff2;base64,${b.toString('base64')}`);
  }
  return `src:url(${fontCache.get(name)}) format("woff2")`;
});
if (/url\(fonts\//.test(css)) throw new Error('katex css: unreplaced font url');
await writeFile(
  path.join(outDir, 'katex.json'),
  JSON.stringify({ id: 'katex', version: katexPkg.version, modules: { katex: katexJs.outputFiles[0].text }, styles: [css] }),
);

const kb = (f) => (Buffer.byteLength(f) / 1024).toFixed(0) + ' KB';
console.log(
  `libs: three (from runtime), d3 ${d3Pkg.version} ${kb(d3.outputFiles[0].text)}, katex ${katexPkg.version} ${kb(katexJs.outputFiles[0].text)} + css ${kb(css)}`,
);

async function replaceAsync(str, re, fn) {
  const parts = [];
  let last = 0;
  for (const m of str.matchAll(re)) {
    parts.push(str.slice(last, m.index), await fn(...m));
    last = m.index + m[0].length;
  }
  parts.push(str.slice(last));
  return parts.join('');
}
