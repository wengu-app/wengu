import { htmlToText } from "@wengu/anki";

/**
 * Text helpers for derived columns. Sort field / checksum follow Anki's rules approximately (tags stripped,
 * media file names kept, entities decoded). @wengu/anki is gaining an exact implementation
 * (`noteSortFieldAndChecksum`); switch to it once it is exported.
 */

const MEDIA_SRC = /<(?:img|audio|video|source)\b[^>]*?src=(?:"([^"]+)"|'([^']+)'|([^ >]+))[^>]*>/gi;

export function stripHtmlPreservingMedia(html: string): string {
  const s = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(MEDIA_SRC, (_w, a?: string, b?: string, c?: string) => ` ${a ?? b ?? c ?? ""} `);
  return htmlToText(s);
}

/** Search text: plain text of all fields (tags removed, entities decoded), whitespace collapsed, lower-cased. */
export function searchText(fields: readonly string[]): string {
  return normaliseSearch(fields.map((f) => htmlToText(f.replace(/<br\s*\/?>|<\/?(?:div|p|li)\b[^>]*>/gi, " "))).join(" \u2003 "));
}

/** The normalisation applied to both stored search text and query terms. */
export function normaliseSearch(s: string): string {
  return s.normalize("NFC").toLowerCase().replace(/[ \t\r\n\u00a0]+/g, " ").trim();
}

export function sortFieldText(html: string): string {
  return stripHtmlPreservingMedia(html);
}

export function fieldChecksum(firstField: string): number {
  return parseInt(sha1Hex(stripHtmlPreservingMedia(firstField)).slice(0, 8), 16);
}

/** Tags as stored: space-separated, no empty entries. */
export function joinTags(tags: readonly string[]): string {
  return tags.join(" ");
}

export function splitTags(s: string): string[] {
  return s.split(/[ 　]+/).filter((t) => t.length > 0);
}

export function normaliseTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    for (const t of splitTags(raw.replace(/[\x00-\x1f]/g, ""))) {
      const k = t.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
  }
  return out;
}

export { mediaReferences, replaceMediaReferences } from "../media/refs.js";

// ------------------------------------------------------------------------------------------------
// SHA-1 (sync; for Anki's note checksum) and Anki-style guids
// ------------------------------------------------------------------------------------------------

export function sha1Hex(input: string): string {
  const msg = new TextEncoder().encode(input);
  const ml = msg.length;
  const withPad = ((ml + 9 + 63) >> 6) << 6;
  const buf = new Uint8Array(withPad);
  buf.set(msg);
  buf[ml] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(withPad - 8, Math.floor((ml * 8) / 0x100000000));
  dv.setUint32(withPad - 4, (ml * 8) >>> 0);
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let off = 0; off < withPad; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 80; i++) {
      const x = w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!;
      w[i] = (x << 1) | (x >>> 31);
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number, k: number;
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = b ^ c ^ d; k = 0xca62c1d6; }
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]!) >>> 0;
      e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = t;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  return [h0, h1, h2, h3, h4].map((h) => h.toString(16).padStart(8, "0")).join("");
}

const BASE91 = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&()*+,-./:;<=>?@[]^_`{|}~";

/** A random guid in Anki's style (64 random bits in base 91). */
export function newGuid(): string {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  let n = 0n;
  for (const x of b) n = (n << 8n) | BigInt(x);
  let s = "";
  while (n > 0n) {
    s = BASE91[Number(n % 91n)]! + s;
    n /= 91n;
  }
  return s || "a";
}
