#!/usr/bin/env node
/**
 * Generates the app icons from the 温 mark (apps/web/public/favicon.svg) into resources/:
 *   icons/<n>x<n>.png  Linux (and the window icon), 16…1024
 *   icon.png           1024, full bleed (electron-builder's generic icon)
 *   icon.ico           Windows (PNG-compressed entries 16…256)
 *   icon.icns          macOS (on Apple's icon grid: 824 px tile with a margin, 16…1024)
 *
 * Renders with Playwright's Chromium so the glyph uses a real CJK serif font (needs "Noto Serif CJK SC" or similar
 * installed). The outputs are committed; run this only when the mark changes:  node scripts/icons.mjs
 */
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "resources");
const favicon = readFileSync(path.join(root, "../web/public/favicon.svg"), "utf8");
mkdirSync(path.join(out, "icons"), { recursive: true });

// The favicon's own geometry (64-unit square, rx 13). macOS: same artwork on an 824/1024 tile with Apple's corner.
const fullSvg = favicon;
const macSvg = favicon
  .replace('viewBox="0 0 64 64"', 'viewBox="-7.77 -7.77 79.54 79.54"')
  .replace('rx="13"', 'rx="14.4"');

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

async function render(svg, size) {
  const sized = svg.replace("<svg ", `<svg width="${size}" height="${size}" `);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block}</style></head><body>${sized}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const full = {};
for (const s of sizes) {
  full[s] = await render(fullSvg, s);
  writeFileSync(path.join(out, "icons", `${s}x${s}.png`), full[s]);
}
writeFileSync(path.join(out, "icon.png"), full[1024]);

// ICO: header + directory + PNG payloads.
{
  const entries = [16, 24, 32, 48, 64, 128, 256];
  const header = Buffer.alloc(6 + 16 * entries.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = header.length;
  entries.forEach((s, i) => {
    const png = full[s];
    const o = 6 + 16 * i;
    header.writeUInt8(s >= 256 ? 0 : s, o);
    header.writeUInt8(s >= 256 ? 0 : s, o + 1);
    header.writeUInt8(0, o + 2);
    header.writeUInt8(0, o + 3);
    header.writeUInt16LE(1, o + 4);
    header.writeUInt16LE(32, o + 6);
    header.writeUInt32LE(png.length, o + 8);
    header.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  writeFileSync(path.join(out, "icon.ico"), Buffer.concat([header, ...entries.map((s) => full[s])]));
}

// ICNS: PNG-encoded entries.
{
  const mac = {};
  for (const s of [16, 32, 64, 128, 256, 512, 1024]) mac[s] = await render(macSvg, s);
  writeFileSync(path.join(out, "icon-mac.png"), mac[1024]);
  const types = [
    ["icp4", 16], ["icp5", 32], ["icp6", 64], ["ic07", 128], ["ic08", 256], ["ic09", 512], ["ic10", 1024],
    ["ic11", 32], ["ic12", 64], ["ic13", 256], ["ic14", 512],
  ];
  const chunks = types.map(([type, s]) => {
    const h = Buffer.alloc(8);
    h.write(type, 0, "ascii");
    h.writeUInt32BE(8 + mac[s].length, 4);
    return Buffer.concat([h, mac[s]]);
  });
  const body = Buffer.concat(chunks);
  const h = Buffer.alloc(8);
  h.write("icns", 0, "ascii");
  h.writeUInt32BE(8 + body.length, 4);
  writeFileSync(path.join(out, "icon.icns"), Buffer.concat([h, body]));
}

await browser.close();
console.log(`icons written to ${out}`);
