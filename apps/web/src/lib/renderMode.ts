/**
 * When can a card be set in Wengu's typography instead of the deck's own look?
 *
 * Wengu mode drops the note type's CSS and scripts and keeps only the content. That is safe when the template's
 * look is cosmetic (fonts, sizes, colours, alignment, spacing). It is not safe when the template relies on code or
 * on CSS that changes what is visible or where (scripts, hidden elements, positioning, flex/grid layouts, generated
 * content, custom fonts): dropping those can reveal the answer early, scramble a layout, or lose content. Those note
 * types fall back to original mode. Pure functions (unit tested).
 */
import type { NoteType } from "@wengu/core";

import type { NoteTypeMode, RenderDefault } from "./settings.ts";

export type UnsafeReason =
  | { kind: "script" }
  | { kind: "handlers" }
  | { kind: "embed" }
  | { kind: "css"; props: string[] }
  | { kind: "fontFace" }
  | { kind: "import" };

export interface NoteTypeAnalysis {
  safe: boolean;
  reasons: UnsafeReason[];
}

/** Declarations that only change how text looks, not what is shown or where. */
const COSMETIC = new Set([
  "font", "font-family", "font-size", "font-weight", "font-style", "font-variant", "font-stretch", "font-feature-settings",
  "line-height", "letter-spacing", "word-spacing", "text-align", "text-indent", "text-transform", "text-decoration",
  "text-decoration-line", "text-decoration-color", "text-decoration-style", "text-underline-offset", "text-shadow",
  "color", "background-color", "background", "border", "border-top", "border-bottom", "border-left", "border-right",
  "border-color", "border-width", "border-style", "border-radius", "border-collapse", "border-spacing",
  "margin", "margin-top", "margin-bottom", "margin-left", "margin-right", "margin-inline", "margin-block",
  "padding", "padding-top", "padding-bottom", "padding-left", "padding-right", "padding-inline", "padding-block",
  "outline", "box-shadow", "cursor", "user-select", "-webkit-user-select", "white-space", "word-break", "overflow-wrap",
  "word-wrap", "hyphens", "vertical-align", "list-style", "list-style-type", "list-style-position", "caret-color",
  "max-width", "width", "height", "max-height", "min-height", "min-width", "box-sizing", "direction", "unicode-bidi",
  "-webkit-font-smoothing", "-moz-osx-font-smoothing", "text-rendering", "font-kerning", "tab-size", "quotes",
  "accent-color", "color-scheme", "transition", "zoom",
]);

/** Values of `display` that only switch between ordinary flow boxes. */
const FLOW_DISPLAY = /^(block|inline|inline-block|list-item|table|table-row|table-cell|inline-table|ruby|ruby-text)$/i;

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

export function analyseCss(css: string): UnsafeReason[] {
  const reasons: UnsafeReason[] = [];
  const src = stripComments(css);
  if (/@font-face/i.test(src)) reasons.push({ kind: "fontFace" });
  if (/@import/i.test(src)) reasons.push({ kind: "import" });
  const bad = new Set<string>();
  // Declarations: everything between { and } that looks like "prop: value".
  for (const block of src.matchAll(/\{([^{}]*)\}/g)) {
    for (const decl of block[1]!.split(";")) {
      const i = decl.indexOf(":");
      if (i < 0) continue;
      const prop = decl.slice(0, i).trim().toLowerCase();
      const value = decl.slice(i + 1).trim().replace(/\s*!important$/i, "");
      if (!prop || prop.startsWith("--")) continue;
      if (prop === "display") {
        if (!FLOW_DISPLAY.test(value)) bad.add(`display: ${value}`);
        continue;
      }
      if (prop === "background" || prop === "background-color") {
        if (/url\s*\(|gradient\s*\(/i.test(value)) bad.add("background-image");
        continue;
      }
      if (!COSMETIC.has(prop)) bad.add(prop);
    }
  }
  if (bad.size) reasons.push({ kind: "css", props: [...bad].slice(0, 4) });
  return reasons;
}

/** Template HTML: anything that runs code or embeds active content. */
export function analyseTemplateHtml(html: string): UnsafeReason[] {
  const reasons: UnsafeReason[] = [];
  if (/<script\b/i.test(html)) reasons.push({ kind: "script" });
  if (/<[a-z][^>]*\son[a-z]+\s*=/i.test(html)) reasons.push({ kind: "handlers" });
  if (/<(iframe|canvas|object|embed|video)\b/i.test(html)) reasons.push({ kind: "embed" });
  return reasons;
}

/** Template text of a note type plus its CSS. */
export function analyseNoteType(nt: Pick<NoteType, "templates" | "css">): NoteTypeAnalysis {
  const reasons: UnsafeReason[] = [];
  const seen = new Set<string>();
  const add = (r: UnsafeReason) => {
    const k = r.kind;
    if (!seen.has(k)) {
      seen.add(k);
      reasons.push(r);
    }
  };
  for (const t of nt.templates) for (const r of analyseTemplateHtml(t.questionFormat + "\n" + t.answerFormat)) add(r);
  for (const r of analyseCss(nt.css)) add(r);
  return { safe: reasons.length === 0, reasons };
}

/** Field content with active parts (the renderer's own hint links are fine: the frame handles them). */
export function renderedHasScript(html: string): boolean {
  return /<script\b/i.test(html);
}

export type ModeDecision =
  | { mode: "wengu"; reason: null }
  | { mode: "original"; reason: UnsafeReason | { kind: "forced" } | { kind: "fieldScript" } | { kind: "default" } };

export function decideMode(
  analysis: NoteTypeAnalysis,
  setting: NoteTypeMode | undefined,
  def: RenderDefault,
  renderedHtml: string,
): ModeDecision {
  if (setting === "original") return { mode: "original", reason: { kind: "forced" } };
  if (setting === "wengu") return { mode: "wengu", reason: null };
  if (def === "original") return { mode: "original", reason: { kind: "default" } };
  if (!analysis.safe) return { mode: "original", reason: analysis.reasons[0]! };
  if (renderedHasScript(renderedHtml)) return { mode: "original", reason: { kind: "fieldScript" } };
  return { mode: "wengu", reason: null };
}

/**
 * Wengu mode drops the deck's CSS, but some of it carries hierarchy the content needs: a `.word` set at 40 px is the
 * prompt, a `.tags` line at 12 px in grey is a footnote, `.ex` in italics is an example. This maps the deck's simple
 * class rules onto Wengu's own few emphasis classes, so the hierarchy survives without the deck's look.
 */
export type EmphasisClass = "wg-large" | "wg-small" | "wg-muted" | "wg-italic";

function px(value: string, base: number): number | null {
  const m = /^([\d.]+)\s*(px|em|rem|%)?$/i.exec(value.trim());
  if (!m) return null;
  const n = Number(m[1]);
  switch ((m[2] ?? "px").toLowerCase()) {
    case "px":
      return n;
    case "em":
    case "rem":
      return n * base;
    case "%":
      return (n / 100) * base;
  }
  return null;
}

function isGrey(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (/^(gray|grey|darkgray|darkgrey|dimgray|dimgrey|silver|lightgray|lightgrey)$/.test(v)) return true;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
  if (!hex) return false;
  let h = hex[1]!;
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  const max = Math.max(r, g, b);
  return max - Math.min(r, g, b) < 24 && max >= 0x55 && max <= 0xbb;
}

export function emphasisMap(css: string): Record<string, EmphasisClass[]> {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  let base = 20;
  const card = /(^|[\s,}])\.card\s*\{([^}]*)\}/.exec(src);
  const baseSize = card && /font-size\s*:\s*([^;]+)/i.exec(card[2]!);
  if (baseSize) base = px(baseSize[1]!, 16) ?? base;
  const out: Record<string, EmphasisClass[]> = {};
  for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1]!.split(",").map((s) => s.trim());
    const body = m[2]!;
    const classes: EmphasisClass[] = [];
    const size = /font-size\s*:\s*([^;]+)/i.exec(body);
    const sz = size ? px(size[1]!, base) : null;
    if (sz !== null && sz >= base * 1.35) classes.push("wg-large");
    if (sz !== null && sz <= base * 0.8) classes.push("wg-small");
    const color = /(?:^|;|\s)color\s*:\s*([^;]+)/i.exec(body);
    if (color && isGrey(color[1]!)) classes.push("wg-muted");
    if (/font-style\s*:\s*italic/i.test(body)) classes.push("wg-italic");
    if (!classes.length) continue;
    for (const sel of selectors) {
      // only plain class selectors (".word", "div.ex"); anything contextual is left alone
      const c = /^(?:[a-z]+)?\.([A-Za-z_][\w-]*)$/.exec(sel);
      if (c && c[1] !== "card" && c[1] !== "cloze") out[c[1]!] = [...new Set([...(out[c[1]!] ?? []), ...classes])];
    }
  }
  return out;
}
