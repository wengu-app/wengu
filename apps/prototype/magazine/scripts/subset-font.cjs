// Rebuild public/fonts/oppo-sans-subset.woff2 from the full OPPO Sans 4.0 font,
// keeping only the characters public/index.html uses (plus ASCII and common punctuation).
// Run it after adding new text to the page; see AGENTS.md for the command.
const fs = require('node:fs');
const path = require('node:path');
const subsetFont = require('subset-font');

const src = process.argv[2];
if (!src) { console.error('usage: node subset-font.cjs <OPPO Sans 4.0 .ttf>'); process.exit(1); }
const root = path.join(__dirname, '..');
let text = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
for (let c = 32; c < 127; c++) text += String.fromCharCode(c);
text += '·—–…“”‘’，。、：；！？（）《》【】「」%×→←↑↓⌘0123456789';
const chars = [...new Set(text)].join('');
subsetFont(fs.readFileSync(src), chars, { targetFormat: 'woff2' }).then(buf => {
  const out = path.join(root, 'public/fonts/oppo-sans-subset.woff2');
  fs.writeFileSync(out, buf);
  console.log(`${[...chars].length} chars, ${buf.length} bytes -> ${path.relative(process.cwd(), out)}`);
});
