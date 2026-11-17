/**
 * Turns an Anki-template presentation into what the card frame shows: reviewer markers become elements
 * (`[anki:play:…]` → replay buttons, `[[type:…]]` → an input on the question and a comparison slot on the answer),
 * and the rendering mode is decided. Pure (unit tested).
 */
import type { AnkiTemplatePresentation, NoteType } from "@wengu/core";

type AvTag = AnkiTemplatePresentation["questionAvTags"][number];

import { PLAY_ICON } from "../frame/styles.ts";
import { decideMode, emphasisMap, type ModeDecision, type NoteTypeAnalysis } from "./renderMode.ts";
import type { NoteTypeMode, RenderDefault } from "./settings.ts";
import { expectedAnswer, findTypeSpec, TYPE_MARKER, type TypeSpec } from "./typeans.ts";

export interface PreparedCard {
  decision: ModeDecision;
  question: string;
  answer: string;
  css: string;
  cardClass: string;
  media: string[];
  questionAv: AvTag[];
  answerAv: AvTag[];
  typeSpec: TypeSpec | null;
  /** Expected typed answer (null when there is no type box or the field is missing). */
  expected: string | null;
  hasMath: boolean;
  errors: string[];
  emphasis: Record<string, string[]>;
}

const PLAY_MARKER = /\[anki:play:(q|a):(\d+)\]/g;

export function playButtons(html: string, label: string): string {
  return html.replace(
    PLAY_MARKER,
    (_w, side: string, n: string) =>
      `<button type="button" class="replay-button soundLink" data-wg-play="${side}:${n}" aria-label="${label}" title="${label}">${PLAY_ICON}</button>`,
  );
}

export function typeInput(html: string, placeholder: string): string {
  let first = true;
  return html.replace(TYPE_MARKER, () => {
    if (!first) return "";
    first = false;
    return `<div class="wg-typeans"><input id="typeans" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="${placeholder}" placeholder="${placeholder}"></div>`;
  });
}

export function typeResultSlot(html: string): string {
  return html.replace(TYPE_MARKER, () => `<div class="wg-typeans-result"></div>`);
}

export function hasMath(html: string): boolean {
  return /\\\(|\\\[|<img[^>]*\bclass=["']?latex/i.test(html);
}

export function fieldMap(nt: Pick<NoteType, "fields">, fields: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of nt.fields) out[f.name] = fields[f.ord] ?? "";
  return out;
}

export interface PrepareInput {
  presentation: AnkiTemplatePresentation;
  noteType: NoteType | undefined;
  analysis: NoteTypeAnalysis;
  fields: readonly string[];
  ord: number;
  modeSetting: NoteTypeMode | undefined;
  renderDefault: RenderDefault;
  labels: { replay: string; typePlaceholder: string };
}

export function prepareCard(input: PrepareInput): PreparedCard {
  const p = input.presentation;
  const decision = decideMode(input.analysis, input.modeSetting, input.renderDefault, p.question + p.answer);
  const typeSpec = findTypeSpec(p.question) ?? findTypeSpec(p.answer);
  const expected = typeSpec && input.noteType ? expectedAnswer(typeSpec, fieldMap(input.noteType, input.fields), input.ord) : null;
  const question = typeInput(playButtons(p.question, input.labels.replay), input.labels.typePlaceholder);
  const answer = typeResultSlot(playButtons(p.answer, input.labels.replay));
  return {
    decision,
    question,
    answer,
    css: p.css,
    cardClass: `card card${input.ord + 1}`,
    media: p.media,
    questionAv: p.questionAvTags,
    answerAv: p.answerAvTags,
    typeSpec,
    expected,
    hasMath: hasMath(p.question) || hasMath(p.answer),
    errors: p.errors,
    emphasis: decision.mode === "wengu" ? emphasisMap(p.css) : {},
  };
}
