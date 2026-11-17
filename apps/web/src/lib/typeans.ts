/**
 * Type-in-the-answer (`{{type:Field}}`, `{{type:cloze:Field}}`, `{{type:nc:Field}}`): what the user should type and
 * how what they typed compares. Pure functions (unit tested).
 */

export const TYPE_MARKER = /\[\[type:(.+?)\]\]/g;

export interface TypeSpec {
  field: string;
  cloze: boolean;
  /** Ignore combining characters (diacritics) when comparing. */
  nc: boolean;
}

export function parseTypeSpec(raw: string): TypeSpec {
  let s = raw.trim();
  let cloze = false;
  let nc = false;
  for (;;) {
    if (s.startsWith("cloze:")) {
      cloze = true;
      s = s.slice(6);
    } else if (s.startsWith("nc:")) {
      nc = true;
      s = s.slice(3);
    } else break;
  }
  return { field: s.trim(), cloze, nc };
}

/** The first type marker in a template's rendered HTML, if any. */
export function findTypeSpec(html: string): TypeSpec | null {
  const m = /\[\[type:(.+?)\]\]/.exec(html);
  return m ? parseTypeSpec(m[1]!) : null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[e.toLowerCase()] ?? whole;
  });
}

/** Field HTML → the plain text a user would type (tags dropped, entities decoded, whitespace collapsed). */
export function htmlToPlain(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>|<\/(div|p|li)>/gi, " ")
      .replace(/<[^>]*>/g, "")
      .replace(/\[sound:[^\]]*\]/g, ""),
  )
    .replace(/[\s ]+/g, " ")
    .trim();
}

/** Contents of the clozes with number `n` (1-based), outermost first, nested clozes included as text. */
export function clozeAnswers(text: string, n: number): string[] {
  const out: string[] = [];
  // Small parser for {{cN::content::hint}} with nesting.
  const stack: { ord: number; start: number }[] = [];
  const re = /\{\{c(\d+)::|\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[0] !== "}}") {
      stack.push({ ord: Number(m[1]), start: m.index + m[0].length });
    } else if (stack.length) {
      const open = stack.pop()!;
      if (open.ord === n) {
        const inner = text.slice(open.start, m.index);
        out.push(stripClozeHint(inner));
      }
    }
  }
  return out;
}

/** "content::hint" → "content", respecting nested clozes; nested cloze syntax is reduced to its content. */
function stripClozeHint(inner: string): string {
  let depth = 0;
  for (let i = 0; i < inner.length - 1; i++) {
    if (inner.startsWith("{{", i)) depth++;
    else if (inner.startsWith("}}", i)) depth--;
    else if (depth === 0 && inner.startsWith("::", i)) return flattenClozes(inner.slice(0, i));
  }
  return flattenClozes(inner);
}

function flattenClozes(s: string): string {
  let prev = "";
  let cur = s;
  while (prev !== cur) {
    prev = cur;
    cur = cur.replace(/\{\{c\d+::((?:(?!\{\{c\d+::)[\s\S])*?)(?:::(?:(?!\{\{c\d+::)[\s\S])*?)?\}\}/g, "$1");
  }
  return cur;
}

/** What the user is expected to type for a spec, given the note's fields by name and the card's ordinal. */
export function expectedAnswer(spec: TypeSpec, fields: Record<string, string>, ord: number): string | null {
  const raw = fields[spec.field];
  if (raw === undefined) return null;
  if (spec.cloze) return clozeAnswers(raw, ord + 1).map(htmlToPlain).join(", ");
  return htmlToPlain(raw);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function normalise(s: string, nc: boolean): string {
  const n = s.normalize("NFC").trim();
  return nc ? n.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC") : n;
}

/** Longest common subsequence membership for two code-point arrays. */
function lcsMarks(a: string[], b: string[]): { inA: boolean[]; inB: boolean[] } {
  const n = a.length;
  const m = b.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const inA = new Array<boolean>(n).fill(false);
  const inB = new Array<boolean>(m).fill(false);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      inA[i] = inB[j] = true;
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  return { inA, inB };
}

function spans(chars: string[], marks: boolean[], good: string, bad: string): string {
  let out = "";
  let i = 0;
  while (i < chars.length) {
    const ok = marks[i]!;
    let j = i;
    while (j < chars.length && marks[j] === ok) j++;
    out += `<span class="${ok ? good : bad}">${escapeHtml(chars.slice(i, j).join(""))}</span>`;
    i = j;
  }
  return out;
}

export interface Comparison {
  correct: boolean;
  html: string;
}

/** Anki-style comparison: what was typed (right/wrong characters), an arrow, and the expected answer (missed characters). */
export function compareAnswer(typed: string, expected: string, nc = false): Comparison {
  const t = normalise(typed, nc);
  const e = normalise(expected, nc);
  if (!t) return { correct: false, html: `<span class="typeMissed">${escapeHtml(expected)}</span>` };
  if (t === e) return { correct: true, html: `<span class="typeGood">${escapeHtml(expected)}</span>` };
  const a = Array.from(t);
  const b = Array.from(e);
  if (a.length * b.length > 4_000_000) {
    return { correct: false, html: `<span class="typeBad">${escapeHtml(t)}</span><span class="typeArrow">↓</span><span class="typeMissed">${escapeHtml(e)}</span>` };
  }
  const { inA, inB } = lcsMarks(a, b);
  return {
    correct: false,
    html: `${spans(a, inA, "typeGood", "typeBad")}<span class="typeArrow" aria-hidden="true">↓</span>${spans(b, inB, "typeGood", "typeMissed")}`,
  };
}
