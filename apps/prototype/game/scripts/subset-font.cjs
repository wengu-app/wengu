// Rebuild public/fonts/oppo-sans-subset.woff2 from the full OPPO Sans 4.0 font, keeping only the characters
// public/index.html and public/app.js use (plus ASCII and common punctuation). Text users type into the
// prototype falls back to system fonts. See AGENTS.md for the command.
const fs = require('node:fs');
const path = require('node:path');
const subsetFont = require('subset-font');

const src = process.argv[2];
if (!src) { console.error('usage: node subset-font.cjs <OPPO Sans 4.0 .ttf>'); process.exit(1); }
const root = path.join(__dirname, '..');
let text = ['public/index.html', 'public/app.js'].map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('');
for (let c = 32; c < 127; c++) text += String.fromCharCode(c);
text += '·—–…“”‘’，。、：；！？（）《》【】「」［］%×→←↑↓⌘0123456789';
const chars = [...new Set(text)].join('');
subsetFont(fs.readFileSync(src), chars, { targetFormat: 'woff2' }).then(buf => {
  fs.mkdirSync(path.join(root, 'public/fonts'), { recursive: true });
  const out = path.join(root, 'public/fonts/oppo-sans-subset.woff2');
  fs.writeFileSync(out, buf);
  console.log(`${[...chars].length} chars, ${buf.length} bytes -> ${path.relative(process.cwd(), out)}`);
});
