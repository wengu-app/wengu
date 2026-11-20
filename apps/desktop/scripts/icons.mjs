#!/usr/bin/env node
/**
 * Generates the app icons from the Leitner card-box master artwork (resources/icon-master.png) into resources/:
 *   icons/<n>x<n>.png  Linux (and the window icon), 16…1024
 *   icon.png           1024, full bleed squircle (electron-builder's generic icon)
 *   icon.ico           Windows (PNG-compressed entries 16…256)
 *   icon.icns          macOS (Apple's icon grid: 824 px continuous squircle + shadow on 1024 px canvas, 16…1024)
 *
 * Renders with Playwright's Chromium so the superellipse mask, inner bevel and macOS drop shadow match across
 * platforms. The outputs are committed; run this only when icon-master.png changes:  node scripts/icons.mjs
 */
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "resources");
const masterPath = path.join(out, "icon-master.png");
const masterDataUri = `data:image/png;base64,${readFileSync(masterPath).toString("base64")}`;
mkdirSync(path.join(out, "icons"), { recursive: true });

// Apple-style continuous superellipse (squircle) on a 0..256 coordinate box.
const SQUIRCLE =
  "M128,0 C196,0 222,0 239,17 C256,34 256,60 256,128 C256,196 256,222 239,239 C222,256 196,256 128,256 C60,256 34,256 17,239 C0,222 0,196 0,128 C0,60 0,34 17,17 C34,0 60,0 128,0 Z";
const SQUIRCLE_INSET =
  "M128,1.5 C195.2,1.5 220.8,1.5 237.6,18.4 C254.5,35.2 254.5,60.8 254.5,128 C254.5,195.2 254.5,220.8 237.6,237.6 C220.8,254.5 195.2,254.5 128,254.5 C60.8,254.5 35.2,254.5 18.4,237.6 C1.5,220.8 1.5,195.2 1.5,128 C1.5,60.8 1.5,35.2 18.4,18.4 C35.2,1.5 60.8,1.5 128,1.5 Z";

// Slightly zoom the full-bleed master so the Leitner card box carries balanced Dock weight (~72% width).
const IMG_SCALE = 1.09;
const IMG_SIZE = 256 * IMG_SCALE;
const IMG_X = (256 - IMG_SIZE) / 2;
const IMG_Y = (256 - IMG_SIZE) / 2 + 2;

function tileArtwork(prefix) {
  return `
    <defs>
      <clipPath id="${prefix}-sq"><path d="${SQUIRCLE}"/></clipPath>
      <linearGradient id="${prefix}-rim" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="rgba(255,255,255,0.88)"/>
        <stop offset="45%" stop-color="rgba(255,255,255,0.08)"/>
        <stop offset="100%" stop-color="rgba(110,82,48,0.2)"/>
      </linearGradient>
    </defs>
    <g clip-path="url(#${prefix}-sq)">
      <image href="${masterDataUri}" x="${IMG_X.toFixed(2)}" y="${IMG_Y.toFixed(2)}" width="${IMG_SIZE.toFixed(2)}" height="${IMG_SIZE.toFixed(2)}" preserveAspectRatio="xMidYMid slice"/>
      <path d="${SQUIRCLE_INSET}" fill="none" stroke="url(#${prefix}-rim)" stroke-width="3"/>
    </g>
  `;
}

// Full-bleed squircle (Linux / Windows / generic 1024px icon).
const fullSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">${tileArtwork("full")}</svg>`;

// macOS Apple Icon Grid: 824/1024 tile (206 on 256 grid) centered at (25, 25) with subtle studio drop shadow.
const macSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <defs>
    <filter id="mac-sh" x="-20%" y="-20%" width="140%" height="145%">
      <feDropShadow dx="0" dy="5" stdDeviation="6" flood-color="#2b1b0e" flood-opacity="0.22"/>
      <feDropShadow dx="0" dy="1.2" stdDeviation="1.5" flood-color="#2b1b0e" flood-opacity="0.12"/>
    </filter>
  </defs>
  <g filter="url(#mac-sh)" transform="translate(25 25) scale(0.8046875)">
    ${tileArtwork("mac")}
  </g>
</svg>`;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

async function render(svg, size) {
  const sized = svg.replace("<svg ", `<svg width="${size}" height="${size}" `);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block}</style></head><body>${sized}</body></html>`);
  await page.waitForTimeout(30);
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
