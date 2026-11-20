/**
 * Decides how a card is laid out in Wengu mode (centered short-word flashcard vs left-aligned Q&A/prose,
 * display-sized short prompt, and Q&A prompt heading).
 *
 * Visual width counts CJK / full-width characters as 2 and Latin/narrow characters as 1, so Chinese and
 * English cards hit equivalent line-width thresholds. Both front and back are inspected up front so
 * revealing the answer never jumps between centered and left-aligned.
 */

const WIDE_CHAR = /[\u2E80-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF\u3000-\u30FF\uAC00-\uD7AF]/;
const LIST_LINE = /^(?:[-*•·▪▸–—]\s+|\d+[.)、]\s*|[（(]\d+[)）]\s*|[①-⑳])/;
const BLOCK_TAGS = new Set(["DIV", "P", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "DT", "DD", "TR", "HR", "BLOCKQUOTE", "PRE", "SECTION", "ARTICLE", "HEADER", "FOOTER"]);
const IGNORE_TAGS = new Set(["RT", "RP", "SCRIPT", "STYLE"]);

/** Approximate visual width of a single line (CJK/full-width = 2, other chars = 1). */
export function visualLength(text: string): number {
  const s = text.replace(/\s+/g, " ").trim();
  let width = 0;
  for (const ch of s) width += WIDE_CHAR.test(ch) ? 2 : 1;
  return width;
}

export function isListLikeLine(line: string): boolean {
  return LIST_LINE.test(line.trim());
}

export interface SideMetrics {
  lines: string[];
  maxLineVisual: number;
  totalVisual: number;
  listLikeLines: number;
  hasStructuredBlock: boolean;
  hasMedia: boolean;
  hasLarge: boolean;
  hasCloze: boolean;
}

export interface CardLayout {
  /** Center short word/flashcard content horizontally (and optically vertically). */
  centered: boolean;
  /** Enlarge very short single-line prompts (e.g. a kanji, vocabulary word, or short term). */
  shortPrompt: boolean;
  /** Give a Q&A question mild heading emphasis above the answer when it is not already a short display prompt. */
  promptHeading: boolean;
}

export function metricsFromLines(
  lines: readonly string[],
  flags: Partial<Pick<SideMetrics, "hasStructuredBlock" | "hasMedia" | "hasLarge" | "hasCloze">> = {},
): SideMetrics {
  const clean = lines.map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  let maxLineVisual = 0;
  let totalVisual = 0;
  let listLikeLines = 0;
  for (const line of clean) {
    const v = visualLength(line);
    if (v > maxLineVisual) maxLineVisual = v;
    totalVisual += v;
    if (isListLikeLine(line)) listLikeLines++;
  }
  return {
    lines: clean,
    maxLineVisual,
    totalVisual,
    listLikeLines,
    hasStructuredBlock: flags.hasStructuredBlock ?? false,
    hasMedia: flags.hasMedia ?? false,
    hasLarge: flags.hasLarge ?? false,
    hasCloze: flags.hasCloze ?? false,
  };
}

/**
 * Extracts layout metrics from a rendered DOM subtree (`.wg-front` or `.wg-back`), ignoring auxiliary chrome
 * like furigana (`<rt>`), muted deck footers (`.wg-small`), hints, replay buttons, and type-in inputs.
 */
export function extractSideMetrics(root: Element | null): SideMetrics {
  if (!root) return metricsFromLines([]);
  const lines: string[] = [];
  let buf = "";
  const flush = () => {
    const s = buf.replace(/\s+/g, " ").trim();
    if (s) lines.push(s);
    buf = "";
  };

  let hasStructuredBlock = false;
  let hasMedia = false;
  let hasLarge = false;
  let hasCloze = false;

  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      buf += node.nodeValue ?? "";
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.tagName.toUpperCase();
    if (IGNORE_TAGS.has(tag)) return;
    const cl = el.classList;
    if (cl.contains("wg-small") || cl.contains("wg-typeans") || cl.contains("wg-typeans-result") || cl.contains("replay-button") || cl.contains("hint")) {
      return;
    }
    if (tag === "UL" || tag === "OL" || tag === "PRE" || tag === "TABLE" || tag === "BLOCKQUOTE") hasStructuredBlock = true;
    if (tag === "IMG" || tag === "SVG" || tag === "VIDEO") hasMedia = true;
    if (cl.contains("wg-large")) hasLarge = true;
    if (cl.contains("cloze")) hasCloze = true;

    if (tag === "BR") {
      flush();
      return;
    }
    const isBlock = BLOCK_TAGS.has(tag);
    if (isBlock) flush();
    for (const child of Array.from(el.childNodes)) walk(child);
    if (isBlock) flush();
  };

  walk(root);
  flush();
  return metricsFromLines(lines, { hasStructuredBlock, hasMedia, hasLarge, hasCloze });
}

/**
 * Thresholds for centered short-word cards:
 *  - Front: at most 2 lines, single line <= 32 visual units (~16 CJK / 32 Latin chars), total <= 44, no lists/cloze.
 *  - Back (if present): at most 4 lines, no single line > 44 visual units (~22 CJK / 44 Latin chars),
 *    total <= 96 (~48 CJK / 96 Latin chars), no structured blocks or plain-text multi-item lists.
 */
export function decideCardLayout(front: SideMetrics, back: SideMetrics | null, hasAnswerSplit: boolean): CardLayout {
  const shortPrompt =
    front.lines.length === 1 &&
    front.totalVisual > 0 &&
    front.totalVisual <= 20 &&
    !front.hasStructuredBlock &&
    !front.hasMedia &&
    !front.hasLarge &&
    !front.hasCloze;

  const frontFitsCenter =
    !front.hasStructuredBlock &&
    !front.hasCloze &&
    front.listLikeLines === 0 &&
    front.lines.length <= 2 &&
    front.maxLineVisual <= 32 &&
    front.totalVisual <= 44;

  const backFitsCenter =
    !back ||
    (!back.hasStructuredBlock &&
      !back.hasCloze &&
      back.listLikeLines < 2 &&
      back.lines.length <= 4 &&
      back.maxLineVisual <= 44 &&
      back.totalVisual <= 96);

  const centered = frontFitsCenter && backFitsCenter;

  const promptHeading =
    hasAnswerSplit &&
    !shortPrompt &&
    !front.hasLarge &&
    !front.hasStructuredBlock &&
    !front.hasCloze &&
    front.totalVisual > 0 &&
    front.totalVisual <= 180;

  return { centered, shortPrompt, promptHeading };
}
