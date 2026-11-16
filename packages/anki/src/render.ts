/**
 * Card rendering: Anki template language → question/answer HTML.
 *
 * Written from Anki's user manual (templates, field replacements,
 * conditionals, cloze, hint/type/furigana filters) and checked against the
 * output of the official `anki` library on the fixtures. The goal is the
 * same HTML Anki's library returns *before* the desktop reviewer
 * post-processes it (so `{{type:…}}` stays as `[[type:…]]` and sounds become
 * `[anki:play:q:N]` references plus an `avTags` list).
 */
import type { AnkiPackage, Card, Note, Notetype } from "./model.js";
import { sha1Hex } from "./sha1.js";

export type AvTag =
  | { kind: "sound"; filename: string }
  | { kind: "tts"; lang: string; voices: string[]; speed: number | null; text: string; other: Record<string, string> };

export interface RenderedCard {
  question: string;
  answer: string;
  questionAvTags: AvTag[];
  answerAvTags: AvTag[];
  css: string;
  /** Template problems (unknown fields, unbalanced conditionals, …). Rendering continues past them. */
  errors: string[];
}

export interface RenderInput {
  notetype: Notetype;
  note: Pick<Note, "fields" | "tags">;
  /** Card ordinal: template index for normal notetypes, cloze number − 1 for cloze. */
  cardOrd: number;
  /** Full deck name ("A::B"), for {{Deck}} / {{Subdeck}}. */
  deckName?: string;
  /** Card flags column, for {{CardFlag}}. */
  flags?: number;
  cardId?: number;
}

// ---------------------------------------------------------------------------
// template parsing
// ---------------------------------------------------------------------------

type TNode =
  | { t: "text"; s: string }
  | { t: "repl"; key: string; filters: string[]; raw: string }
  | { t: "cond"; key: string; negated: boolean; children: TNode[] };

function parseTemplate(src: string, errors: string[]): TNode[] {
  const root: TNode[] = [];
  const stack: { key: string; node: TNode & { t: "cond" } }[] = [];
  const out = () => (stack.length ? stack[stack.length - 1]!.node.children : root);
  let pos = 0;
  while (pos < src.length) {
    const open = src.indexOf("{{", pos);
    if (open < 0) {
      out().push({ t: "text", s: src.slice(pos) });
      break;
    }
    const close = src.indexOf("}}", open + 2);
    if (close < 0) {
      out().push({ t: "text", s: src.slice(pos) });
      break;
    }
    if (open > pos) out().push({ t: "text", s: src.slice(pos, open) });
    const inner = src.slice(open + 2, close).trim();
    pos = close + 2;
    const c0 = inner[0];
    if (c0 === "#" || c0 === "^") {
      const node: TNode & { t: "cond" } = { t: "cond", key: inner.slice(1).trim(), negated: c0 === "^", children: [] };
      out().push(node);
      stack.push({ key: node.key, node });
    } else if (c0 === "/") {
      const key = inner.slice(1).trim();
      const top = stack[stack.length - 1];
      if (!top || top.key !== key) {
        errors.push(`unexpected closing tag {{/${key}}}`);
        continue;
      }
      stack.pop();
    } else {
      const parts = inner.split(":");
      const key = parts.pop()!.trim();
      out().push({ t: "repl", key, filters: parts.map((p) => p.trim()), raw: inner });
    }
  }
  for (const s of stack) errors.push(`missing {{/${s.key}}}`);
  return root;
}

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------

interface SideCtx {
  fields: Map<string, string>;
  fieldsLower: Map<string, string>;
  special: Map<string, string>;
  clozeOrd: number | null; // 1-based
  side: "q" | "a";
  frontSide: string;
  errors: string[];
  /** Set when a {{cloze:…}} field contained the card's cloze number. */
  clozeFound: { value: boolean };
}

const EMPTY_FIELD = /^(?:\s|<\/?(?:br|div)\s*\/?>)*$/i;

export function isFieldEmpty(html: string): boolean {
  return EMPTY_FIELD.test(html);
}

function lookup(ctx: SideCtx, key: string): string | undefined {
  if (key === "FrontSide") return ctx.side === "a" ? ctx.frontSide : "";
  const sp = ctx.special.get(key);
  if (sp !== undefined) return sp;
  return ctx.fields.get(key) ?? ctx.fieldsLower.get(key.toLowerCase());
}

function nonEmpty(ctx: SideCtx, key: string): boolean {
  const m = /^c(\d+)$/i.exec(key);
  if (m && ctx.clozeOrd !== null && !ctx.fields.has(key)) return Number(m[1]) === ctx.clozeOrd;
  const v = lookup(ctx, key);
  if (v === undefined) {
    ctx.errors.push(`conditional on unknown field {{#${key}}}`);
    return false;
  }
  return !isFieldEmpty(v);
}

function renderNodes(nodes: TNode[], ctx: SideCtx): string {
  let out = "";
  for (const n of nodes) {
    if (n.t === "text") out += n.s;
    else if (n.t === "cond") {
      if (nonEmpty(ctx, n.key) !== n.negated) out += renderNodes(n.children, ctx);
    } else out += renderReplacement(n, ctx);
  }
  return out;
}

function renderReplacement(n: TNode & { t: "repl" }, ctx: SideCtx): string {
  // {{type:…}} is left for the reviewer to turn into an input box.
  if (n.filters[0] === "type") return `[[${n.raw}]]`;
  let value = lookup(ctx, n.key);
  if (value === undefined) {
    ctx.errors.push(`unknown field {{${n.key}}}`);
    return `{{${n.raw}}}`;
  }
  for (let i = n.filters.length - 1; i >= 0; i--) value = applyFilter(n.filters[i]!, value, n.key, ctx);
  return value;
}

function applyFilter(filter: string, text: string, fieldName: string, ctx: SideCtx): string {
  if (filter === "") return text;
  if (filter === "text") return htmlToText(text);
  if (filter === "hint") return hint(text, fieldName);
  if (filter === "cloze") {
    if (ctx.clozeOrd === null) return text;
    // A field without the card's cloze number renders empty (multi-field cloze notetypes rely on this).
    if (!clozeNumbers(text).includes(ctx.clozeOrd)) return "";
    ctx.clozeFound.value = true;
    return renderCloze(text, ctx.clozeOrd, ctx.side);
  }
  if (filter === "cloze-only") return ctx.clozeOrd === null ? "" : clozeOnly(text, ctx.clozeOrd, ctx.side);
  if (filter === "furigana") return furigana(text, "furigana");
  if (filter === "kana") return furigana(text, "kana");
  if (filter === "kanji") return furigana(text, "kanji");
  if (filter === "tts" || filter.startsWith("tts ")) return ttsTag(filter, text);
  // Unknown filters (typically from add-ons) are ignored, as in Anki.
  return text;
}

function hint(text: string, fieldName: string): string {
  if (isFieldEmpty(text)) return "";
  // Anki uses a hash of the content for the element id; any stable unique id works.
  const id = "hint" + sha1Hex(fieldName + "\x1f" + text).slice(0, 16);
  return (
    `\n<a class=hint href="#"\nonclick="this.style.display='none';\n` +
    `document.getElementById('${id}').style.display='block';\nreturn false;" draggable=false>\n` +
    `${fieldName}</a>\n<div id="${id}" class=hint style="display: none">${text}</div>\n`
  );
}

function ttsTag(filter: string, text: string): string {
  const args = filter.slice(3).trim();
  return `[anki:tts lang=${args.split(/\s+/)[0] ?? ""}${args.includes(" ") ? " " + args.split(/\s+/).slice(1).join(" ") : ""}]${text}[/anki:tts]`;
}

// ---------------------------------------------------------------------------
// furigana: "日本[にほん] 語[ご]"
// ---------------------------------------------------------------------------

const FURIGANA = / ?([^ >]+?)\[(.+?)\]/g;

function furigana(text: string, mode: "furigana" | "kana" | "kanji"): string {
  return text.replace(FURIGANA, (whole, base: string, reading: string) => {
    if (reading.startsWith("sound:")) return whole;
    if (mode === "kanji") return base;
    if (mode === "kana") return reading;
    return `<ruby><rb>${base}</rb><rt>${reading}</rt></ruby>`;
  });
}

// ---------------------------------------------------------------------------
// cloze
// ---------------------------------------------------------------------------

type CNode = string | { ord: number; children: CNode[] };

function parseCloze(text: string): CNode[] {
  const root: CNode[] = [];
  const stack: { ord: number; children: CNode[] }[] = [];
  const out = () => (stack.length ? stack[stack.length - 1]!.children : root);
  const re = /\{\{c(\d+)::|\}\}/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[0] === "}}" && !stack.length) continue; // stray "}}": keep as text
    if (m.index > last) out().push(text.slice(last, m.index));
    last = re.lastIndex;
    if (m[0] === "}}") {
      const node = stack.pop()!;
      out().push(node);
    } else {
      stack.push({ ord: Number(m[1]), children: [] });
    }
  }
  if (last < text.length) out().push(text.slice(last));
  // unterminated clozes: flatten back to text
  while (stack.length) {
    const node = stack.pop()!;
    out().push(`{{c${node.ord}::`, ...node.children);
  }
  return root;
}

/** Split a cloze's children at the first top-level "::" into content and hint. */
function splitHint(children: CNode[]): { content: CNode[]; hint: string | null } {
  for (let i = 0; i < children.length; i++) {
    const c = children[i]!;
    if (typeof c !== "string") continue;
    const at = c.indexOf("::");
    if (at < 0) continue;
    const content = [...children.slice(0, i), c.slice(0, at)];
    const rest = [c.slice(at + 2), ...children.slice(i + 1)];
    return { content, hint: rest.map((r) => (typeof r === "string" ? r : flatten([r]))).join("") };
  }
  return { content: children, hint: null };
}

function flatten(nodes: CNode[]): string {
  return nodes.map((n) => (typeof n === "string" ? n : `{{c${n.ord}::${flatten(n.children)}}}`)).join("");
}

/**
 * Track whether we are inside MathJax (\(..\) or \[..\]). Clozes inside
 * MathJax are rendered without <span> wrappers, since HTML is not valid there
 * (observed in Anki's output).
 */
function updateMath(text: string, inMath: boolean): boolean {
  for (const m of text.matchAll(/\\[()[\]]/g)) inMath = m[0] === "\\(" || m[0] === "\\[";
  return inMath;
}

function renderClozeNodes(nodes: CNode[], ord: number, side: "q" | "a", state = { inMath: false }): string {
  let out = "";
  for (const n of nodes) {
    if (typeof n === "string") {
      out += n;
      state.inMath = updateMath(n, state.inMath);
      continue;
    }
    const { content, hint } = splitHint(n.children);
    const inner = renderClozeNodes(content, ord, side, state);
    if (state.inMath) {
      out += n.ord === ord && side === "q" ? `[${hint ?? "..."}]` : inner;
    } else if (n.ord !== ord) {
      out += `<span class="cloze-inactive" data-ordinal="${n.ord}">${inner}</span>`;
    } else if (side === "q") {
      out += `<span class="cloze" data-cloze="${encodeAttribute(inner)}" data-ordinal="${n.ord}">[${hint ?? "..."}]</span>`;
    } else {
      out += `<span class="cloze" data-ordinal="${n.ord}">${inner}</span>`;
    }
  }
  return out;
}

export function renderCloze(text: string, ord: number, side: "q" | "a"): string {
  return renderClozeNodes(parseCloze(text), ord, side);
}

/** `cloze-only:` (meant for TTS): the active clozes only, as the reader would see them on this side. */
function clozeOnly(text: string, ord: number, side: "q" | "a"): string {
  const found: string[] = [];
  const walk = (nodes: CNode[]) => {
    for (const n of nodes) {
      if (typeof n === "string") continue;
      const { content, hint } = splitHint(n.children);
      if (n.ord === ord) found.push(side === "q" ? (hint ?? "...") : renderClozeNodes(content, ord, "a"));
      else walk(content);
    }
  };
  walk(parseCloze(text));
  return found.join(", ");
}

/** Cloze numbers (1-based) used in a field. */
export function clozeNumbers(text: string): number[] {
  const set = new Set<number>();
  for (const m of text.matchAll(/\{\{c(\d+)::/g)) set.add(Number(m[1]));
  return [...set].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

/** Attribute encoding as observed in Anki output: ASCII alphanumerics and non-ASCII kept, everything else as an entity. */
export function encodeAttribute(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c > 0x7f || (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)) out += ch;
    else if (ch === "<") out += "&lt;";
    else if (ch === ">") out += "&gt;";
    else if (ch === '"') out += "&quot;";
    else if (ch === "&") out += "&amp;";
    else out += `&#x${c.toString(16).toUpperCase().padStart(2, "0")};`;
  }
  return out;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[e.toLowerCase()] ?? whole;
  });
}

/** `text:` filter: strip tags, decode entities; non-breaking spaces become plain spaces (as Anki does). */
export function htmlToText(html: string): string {
  return decodeEntities(html.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, "")).replace(/\u00a0/g, " ");
}

// ---------------------------------------------------------------------------
// LaTeX → <img>, sounds → av tags
// ---------------------------------------------------------------------------

const LATEX = /\[latex\]([\s\S]+?)\[\/latex\]|\[\$\]([\s\S]+?)\[\/\$\]|\[\$\$\]([\s\S]+?)\[\/\$\$\]/gi;

function latexToImg(html: string, svg: boolean): string {
  return html.replace(LATEX, (_w, full?: string, inline?: string, display?: string) => {
    let src: string;
    if (full !== undefined) src = full;
    else if (inline !== undefined) src = `$${inline}$`;
    else src = `\\begin{displaymath}${display}\\end{displaymath}`;
    // HTML in LaTeX: line breaks become newlines, other tags are dropped.
    const latex = decodeEntities(src.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, ""));
    const fname = `latex-${sha1Hex(latex)}.${svg ? "svg" : "png"}`;
    return `<img class=latex alt="${encodeAttribute(latex)}" src="${fname}">`;
  });
}

const AV = /\[sound:(.+?)\]|\[anki:tts([^\]]*)\]([\s\S]*?)\[\/anki:tts\]/g;

function extractAv(html: string, side: "q" | "a"): { html: string; tags: AvTag[] } {
  const tags: AvTag[] = [];
  const out = html.replace(AV, (_w, sound?: string, ttsArgs?: string, ttsText?: string) => {
    if (sound !== undefined) tags.push({ kind: "sound", filename: decodeEntities(sound) });
    else {
      const other: Record<string, string> = {};
      for (const kv of (ttsArgs ?? "").trim().split(/\s+/)) {
        const [k, v] = kv.split("=");
        if (k) other[k] = v ?? "";
      }
      const { lang = "", voices = "", speed, ...rest } = other;
      tags.push({
        kind: "tts",
        lang,
        voices: voices ? voices.split(",") : [],
        speed: speed ? Number(speed) : null,
        text: htmlToText(ttsText ?? ""),
        other: rest,
      });
    }
    return `[anki:play:${side}:${tags.length - 1}]`;
  });
  return { html: out, tags };
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

export function renderCard(input: RenderInput): RenderedCard {
  const { notetype, note, cardOrd } = input;
  const errors: string[] = [];
  const isCloze = notetype.kind === "cloze";
  const template = isCloze ? notetype.templates[0] : notetype.templates.find((t) => t.ord === cardOrd);
  if (!template) {
    return { question: "", answer: "", questionAvTags: [], answerAvTags: [], css: notetype.css, errors: [`no template for ord ${cardOrd}`] };
  }
  const fields = new Map<string, string>();
  const fieldsLower = new Map<string, string>();
  notetype.fields.forEach((f, i) => {
    const v = note.fields[i] ?? "";
    fields.set(f.name, v);
    fieldsLower.set(f.name.toLowerCase(), v);
  });
  const deckName = input.deckName ?? "";
  const flag = (input.flags ?? 0) & 7;
  const special = new Map<string, string>([
    ["Tags", note.tags.join(" ").trim()],
    ["Type", notetype.name],
    ["Deck", deckName],
    ["Subdeck", deckName.split("::").pop() ?? ""],
    ["Card", template.name],
    ["CardFlag", `flag${flag}`],
  ]);
  if (input.cardId !== undefined) special.set("CardID", String(input.cardId));

  const clozeFound = { value: false };
  const base = { fields, fieldsLower, special, clozeOrd: isCloze ? cardOrd + 1 : null, errors, clozeFound };
  const qNodes = parseTemplate(template.qfmt, errors);
  const aNodes = parseTemplate(template.afmt, errors);

  const qRaw = latexToImg(renderNodes(qNodes, { ...base, side: "q", frontSide: "" }), notetype.latexSvg);
  // Anki shows "No cloze N found on card" when the note has no such cloze at all.
  if (isCloze && !clozeFound.value && !note.fields.some((f) => clozeNumbers(f).includes(cardOrd + 1))) {
    errors.push(`no cloze ${cardOrd + 1} found on card`);
  }
  const q = extractAv(qRaw, "q");
  const aRaw = latexToImg(renderNodes(aNodes, { ...base, side: "a", frontSide: q.html }), notetype.latexSvg);
  const a = extractAv(aRaw, "a");
  return { question: q.html, answer: a.html, questionAvTags: q.tags, answerAvTags: a.tags, css: notetype.css, errors };
}

/** Render a card from a package (looks up note, notetype and deck). */
export function renderPackageCard(pkg: AnkiPackage, card: Card): RenderedCard {
  const note = pkg.notes.find((n) => n.id === card.noteId);
  if (!note) throw new Error(`card ${card.id}: note ${card.noteId} not found`);
  const notetype = pkg.notetypes.find((n) => n.id === note.notetypeId);
  if (!notetype) throw new Error(`note ${note.id}: notetype ${note.notetypeId} not found`);
  const deck = pkg.decks.find((d) => d.id === (card.originalDeckId || card.deckId));
  return renderCard({ notetype, note, cardOrd: card.ord, deckName: deck?.name ?? "", flags: card.flags, cardId: card.id });
}
