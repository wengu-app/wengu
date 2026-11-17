import { htmlToText } from "@wengu/anki";

/** Text helpers for search and tags. (Sort field, checksum and guids come from @wengu/anki.) */

/** Search text: plain text of all fields (tags removed, entities decoded), whitespace collapsed, lower-cased. */
export function searchText(fields: readonly string[]): string {
  return normaliseSearch(fields.map((f) => htmlToText(f.replace(/<br\s*\/?>|<\/?(?:div|p|li)\b[^>]*>/gi, " "))).join(" \u2003 "));
}

/** The normalisation applied to both stored search text and query terms. */
export function normaliseSearch(s: string): string {
  return s.normalize("NFC").toLowerCase().replace(/[ \t\r\n\u00a0]+/g, " ").trim();
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
