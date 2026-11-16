/**
 * JSON.parse that keeps integers outside the safe range exact.
 *
 * Schema 11 collections store random 64-bit ids (field and template ids) as
 * bare JSON numbers, e.g. -5234731884072841852. Plain JSON.parse silently
 * rounds them. We quote such literals before parsing so they come back as
 * decimal strings.
 */
export function parseJsonExact(text: string): unknown {
  return JSON.parse(quoteUnsafeIntegers(text));
}

const DIGIT0 = 48;
const DIGIT9 = 57;

function quoteUnsafeIntegers(text: string): string {
  let out: string[] | null = null;
  let last = 0;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text.charCodeAt(i);
    if (c === 34 /* " */) {
      // skip string literal
      i++;
      while (i < n) {
        const d = text.charCodeAt(i);
        if (d === 92 /* \ */) i += 2;
        else if (d === 34) {
          i++;
          break;
        } else i++;
      }
      continue;
    }
    if (c === 45 /* - */ || (c >= DIGIT0 && c <= DIGIT9)) {
      const start = i;
      i++;
      while (i < n) {
        const d = text.charCodeAt(i);
        if ((d >= DIGIT0 && d <= DIGIT9) || d === 46 || d === 101 || d === 69 || d === 43 || d === 45) i++;
        else break;
      }
      const tok = text.slice(start, i);
      if (/^-?\d{16,}$/.test(tok) && !Number.isSafeInteger(Number(tok))) {
        out ??= [];
        out.push(text.slice(last, start), `"${tok}"`);
        last = i;
      }
      continue;
    }
    i++;
  }
  if (!out) return text;
  out.push(text.slice(last));
  return out.join("");
}

/** Accept a JSON value that may be a number or an exact-integer string; return a decimal string or null. */
export function idString(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : null;
  if (typeof v === "bigint") return v.toString();
  return null;
}

/** A JSON integer given as exact decimal text (for 64-bit ids that a JS number cannot hold). */
export class JsonInt {
  constructor(readonly text: string) {
    if (!/^-?\d+$/.test(text)) throw new Error(`not an integer: ${text}`);
  }
}

/**
 * Compact JSON.stringify that writes `JsonInt` values as bare integers and
 * `bigint`s exactly. Non-finite numbers become null (as JSON.stringify does);
 * `undefined` object members are skipped.
 */
export function stringifyJson(value: unknown): string {
  if (value instanceof JsonInt) return value.text;
  if (typeof value === "bigint") return value.toString();
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : stringifyJson(v))).join(",")}]`;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined || typeof v === "function") continue;
    parts.push(`${JSON.stringify(k)}:${stringifyJson(v)}`);
  }
  return `{${parts.join(",")}}`;
}
