/** Pure helpers for the card-making screen: Image Occlusion detection, front/back split, card count, and draft transfer. */
import type { Id, NoteType } from "@wengu/core";

export const DEFAULT_PIN_COUNT = 3;

/**
 * Picks up to `limit` default pinned note types, preferring the most-used supported types in the collection.
 * Ties favour standard everyday types (Basic, Cloze, …) before longer/custom ones.
 */
export function defaultPinnedIds(
  noteTypes: readonly NoteType[],
  usageCounts: ReadonlyMap<Id, number>,
  limit = DEFAULT_PIN_COUNT,
): Id[] {
  const supported = noteTypes.filter((nt) => !isImageOcclusion(nt));
  const pool = supported.length ? supported : [...noteTypes];
  if (pool.length <= limit) return pool.map((nt) => nt.id);
  const rank = (name: string) => {
    const n = name.trim().toLowerCase();
    if (n === "basic" || n === "基础") return 0;
    if (n === "cloze" || n === "填空") return 1;
    if (n.startsWith("basic")) return 2;
    return 3;
  };
  return [...pool]
    .sort((a, b) => {
      const diff = (usageCounts.get(b.id) ?? 0) - (usageCounts.get(a.id) ?? 0);
      if (diff !== 0) return diff;
      const rd = rank(a.name) - rank(b.name);
      if (rd !== 0) return rd;
      return a.name.length - b.name.length;
    })
    .slice(0, limit)
    .map((nt) => nt.id);
}

/**
 * Splits note types into the outer capsule row (`visible`) and whether a "More" popover trigger should be shown.
 * Pinned types stay in collection order; if the active type isn't pinned, it is shown temporarily at the end.
 */
export function partitionNoteTypes(
  noteTypes: readonly NoteType[],
  pinnedIds: readonly Id[],
  activeId: Id | null,
): { visible: NoteType[]; pinnedSet: Set<Id>; hasMore: boolean } {
  const byId = new Map(noteTypes.map((nt) => [nt.id, nt]));
  const pinnedSet = new Set(pinnedIds.filter((id) => byId.has(id)));
  const visible: NoteType[] = [];
  for (const nt of noteTypes) {
    if (pinnedSet.has(nt.id)) visible.push(nt);
  }
  const active = activeId !== null ? byId.get(activeId) : undefined;
  if (active && !pinnedSet.has(active.id)) visible.push(active);
  if (!visible.length && noteTypes[0]) visible.push(noteTypes[0]);
  const hasMore = noteTypes.length > DEFAULT_PIN_COUNT || pinnedSet.size < noteTypes.length;
  return { visible, pinnedSet, hasMore };
}

/** Detects Anki's built-in Image Occlusion note type, which requires a dedicated mask editor and canvas runtime. */
export function isImageOcclusion(nt: NoteType): boolean {
  return nt.templates.some((tpl) => /\banki\.imageOcclusion\b/i.test(tpl.questionFormat) || /\banki\.imageOcclusion\b/i.test(tpl.answerFormat));
}

/** Field names a template refers to, ignoring conditionals' markers and filters such as `type:` or `cloze:`. */
export function fieldRefs(format: string): Set<string> {
  const out = new Set<string>();
  for (const m of format.matchAll(/\{\{([^{}]+)\}\}/g)) {
    const s = m[1]!.trim().replace(/^[#^/]/, "");
    out.add(s.split(":").pop()!.trim());
  }
  return out;
}

/** Fields shown on the first template's question go on the front; the rest on the back. */
export function sides(nt: NoteType): { front: number[]; back: number[] } {
  const refs = fieldRefs(nt.templates[0]?.questionFormat ?? "");
  const front: number[] = [];
  const back: number[] = [];
  nt.fields.forEach((f, i) => (refs.has(f.name) ? front : back).push(i));
  if (!front.length && back.length) front.push(back.shift()!);
  return { front, back };
}

/** True when a field has neither text nor embedded media (images/audio/video/svg). */
export function isBlank(html: string | undefined): boolean {
  if (!html) return true;
  if (/<(?:img|svg|audio|video)\b/i.test(html) || /\[sound:[^\]]+\]/i.test(html)) return false;
  return !html.replace(/<[^>]*>|&nbsp;|\s/g, "");
}

/** Resolves Mustache conditional blocks `{{#Field}}…{{/Field}}` and `{{^Field}}…{{/Field}}` for card-count estimation. */
function evalConditionals(format: string, filled: ReadonlySet<string>): string {
  let out = format;
  const re = /\{\{([#^])([^{}]+)\}\}([\s\S]*?)\{\{\/\2\}\}/g;
  for (let pass = 0; pass < 8; pass++) {
    const next = out.replace(re, (_, kind: string, raw: string, inner: string) => {
      const name = raw.trim();
      const has = filled.has(name);
      return (kind === "#" ? has : !has) ? inner : "";
    });
    if (next === out) break;
    out = next;
  }
  return out;
}

/** How many review cards the note would make (matching Anki's cloze and conditional-template rules). */
export function cardCount(nt: NoteType, fields: readonly string[]): number {
  if (nt.kind === "cloze") {
    const ns = new Set<string>();
    for (const f of fields) for (const m of f.matchAll(/\{\{c(\d+)::/g)) ns.add(m[1]!);
    return ns.size;
  }
  const filled = new Set<string>();
  nt.fields.forEach((f, i) => {
    if (!isBlank(fields[i])) filled.add(f.name);
  });
  return nt.templates.filter((tpl) => {
    const active = evalConditionals(tpl.questionFormat, filled);
    for (const ref of fieldRefs(active)) if (filled.has(ref)) return true;
    return false;
  }).length;
}

/** Carries non-empty draft text across note types by field name first, then position, so switching types does not lose work. */
export function transferFields(prevNt: NoteType | undefined, prevFields: readonly string[], nextNt: NoteType): string[] {
  if (!prevNt || prevFields.every((f) => isBlank(f))) return nextNt.fields.map(() => "");
  const byName = new Map<string, string>();
  const used = new Set<number>();
  prevNt.fields.forEach((f, i) => {
    const v = prevFields[i] ?? "";
    if (!isBlank(v)) byName.set(f.name.trim().toLowerCase(), v);
  });
  const out = nextNt.fields.map((f) => {
    const key = f.name.trim().toLowerCase();
    const hit = byName.get(key);
    if (hit !== undefined) {
      const prevIdx = prevNt.fields.findIndex((pf) => pf.name.trim().toLowerCase() === key);
      if (prevIdx >= 0) used.add(prevIdx);
      return hit;
    }
    return "";
  });
  const remaining = prevFields.map((v, i) => ({ v, i })).filter((x) => !used.has(x.i) && !isBlank(x.v));
  let ri = 0;
  for (let i = 0; i < out.length && ri < remaining.length; i++) {
    if (isBlank(out[i])) out[i] = remaining[ri++]!.v;
  }
  return out;
}
