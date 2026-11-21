/**
 * Memory-oriented 2D/card-shell builder primitives (`wengu/card`).
 *
 * Preloaded into every sandboxed component via the frame import map so authors can build
 * consistent two-phase in-place reveal cards, step-by-step process cards, and dynamic variants
 * without boilerplate CSS or lifecycle plumbing.
 */

import type { ComponentContext, Phase } from '../component-api.ts';

const STYLE_ID = 'wg-card-primitive-style';

const CARD_CSS = `
.wg-card {
  position: relative;
  overflow: hidden;
  user-select: none;
  -webkit-user-select: none;
  background-color: var(--wg-color-surface);
  background-image: radial-gradient(
    circle at 1px 1px,
    color-mix(in srgb, var(--wg-color-border) 62%, transparent) 1.1px,
    transparent 0
  );
  background-size: 22px 22px;
  color: var(--wg-color-text);
  font-family: var(--wg-font-sans);
  -webkit-font-smoothing: antialiased;
}
.wg-card-stage {
  position: relative;
  width: 100%;
  height: 100%;
}
.wg-card-prompt {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  z-index: 4;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 16px 24px 12px;
  text-align: center;
  pointer-events: none;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--wg-color-surface) 96%, transparent) 0%,
    color-mix(in srgb, var(--wg-color-surface) 88%, transparent) 72%,
    transparent 100%
  );
  transition: opacity var(--wg-motion-base) var(--wg-motion-easing),
    transform var(--wg-motion-base) var(--wg-motion-easing);
}
.wg-card-prompt[hidden] {
  display: none;
}
.wg-card-kicker {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 22px;
  padding: 0 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--wg-color-accent) 11%, var(--wg-color-surface));
  box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--wg-color-accent) 26%, transparent);
  color: var(--wg-color-accent);
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
}
.wg-card-kicker::before {
  content: "";
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--wg-color-accent);
}
.wg-card-kicker[hidden] {
  display: none;
}
.wg-card-prompt-title {
  max-width: min(640px, 100%);
  font-weight: 700;
  font-size: 16.5px;
  line-height: 1.38;
  letter-spacing: 0.01em;
  color: var(--wg-color-text);
}
.wg-card-prompt-sub {
  max-width: min(620px, 100%);
  font-size: 12.5px;
  font-weight: 500;
  line-height: 1.35;
  color: var(--wg-color-text-muted);
}
.wg-card-feedback {
  --fb-c: var(--wg-color-border);
  --fb-bg: var(--wg-color-surface-raised);
  position: absolute;
  left: 50%;
  bottom: 18px;
  transform: translate(-50%, 10px);
  opacity: 0;
  z-index: 5;
  pointer-events: none;
  display: flex;
  gap: 10px;
  align-items: flex-start;
  max-width: min(620px, calc(100% - 36px));
  padding: 11px 16px;
  border-radius: 16px;
  background: var(--fb-bg);
  color: var(--wg-color-text);
  font-size: 13.5px;
  line-height: 1.45;
  box-shadow:
    inset 0 0 0 2px var(--fb-c),
    0 3px 0 color-mix(in srgb, var(--fb-c) 82%, #000);
  transition: opacity var(--wg-motion-base) var(--wg-motion-easing),
    transform var(--wg-motion-base) var(--wg-motion-easing);
}
.wg-card-feedback[data-tone="success"] {
  --fb-c: var(--wg-color-success);
  --fb-bg: color-mix(in srgb, var(--wg-color-success) 10%, var(--wg-color-surface));
}
.wg-card-feedback[data-tone="danger"] {
  --fb-c: var(--wg-color-danger);
  --fb-bg: color-mix(in srgb, var(--wg-color-danger) 10%, var(--wg-color-surface));
}
.wg-card-feedback[data-tone="neutral"] {
  --fb-c: color-mix(in srgb, var(--wg-color-border) 85%, var(--wg-color-text));
  --fb-bg: color-mix(in srgb, var(--wg-color-background) 55%, var(--wg-color-surface));
}
.wg-card-feedback.show {
  opacity: 1;
  transform: translate(-50%, 0);
  pointer-events: auto;
}
.wg-card-feedback-badge {
  flex: none;
  width: 22px;
  height: 22px;
  margin-top: 1px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 800;
  color: var(--wg-color-on-accent);
  background: var(--wg-color-accent);
  box-shadow: 0 2px 0 color-mix(in srgb, var(--wg-color-accent) 72%, #000);
}
.wg-card-feedback[data-tone="success"] .wg-card-feedback-badge {
  background: var(--wg-color-success);
  color: #ffffff;
  box-shadow: 0 2px 0 color-mix(in srgb, var(--wg-color-success) 72%, #000);
}
.wg-card-feedback[data-tone="danger"] .wg-card-feedback-badge {
  background: var(--wg-color-danger);
  color: #ffffff;
  box-shadow: 0 2px 0 color-mix(in srgb, var(--wg-color-danger) 72%, #000);
}
.wg-card-feedback-title {
  font-weight: 700;
  color: var(--wg-color-text);
}
.wg-card-feedback-body {
  margin-top: 2px;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--wg-color-text-muted);
}
.wg-card-hint {
  position: absolute;
  right: 14px;
  bottom: 10px;
  z-index: 3;
  padding: 3px 9px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--wg-color-background) 86%, transparent);
  font-size: 11px;
  font-weight: 600;
  color: var(--wg-color-text-muted);
  pointer-events: none;
}
.wg-card-hint[hidden] {
  display: none;
}
.wg-choice-row {
  position: absolute;
  left: 50%;
  bottom: 20px;
  transform: translateX(-50%);
  z-index: 4;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: center;
  width: max-content;
  max-width: calc(100% - 32px);
}
.wg-choice-row[hidden] {
  display: none;
}
.wg-choice {
  --cb: var(--wg-color-surface);
  --cl: color-mix(in srgb, var(--wg-color-border) 82%, var(--wg-color-text));
  appearance: none;
  border: 0;
  border-radius: 13px;
  background: var(--cb);
  color: var(--wg-color-text);
  font: 700 13.5px/1.25 var(--wg-font-sans);
  padding: 9px 16px;
  white-space: nowrap;
  cursor: pointer;
  box-shadow:
    inset 0 0 0 2px var(--cl),
    0 3px 0 var(--cl);
  transform: translateY(0);
  transition: transform 70ms ease, box-shadow 70ms ease, background-color 120ms ease, color 120ms ease;
}
.wg-choice:hover {
  --cb: color-mix(in srgb, var(--wg-color-accent) 7%, var(--wg-color-surface));
  --cl: var(--wg-color-accent);
  color: var(--wg-color-accent);
}
.wg-choice:active {
  transform: translateY(3px);
  box-shadow: inset 0 0 0 2px var(--cl), 0 0 0 var(--cl);
}
.wg-pill-legend {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  padding: 6px 12px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--wg-color-background) 88%, var(--wg-color-surface));
  box-shadow: inset 0 0 0 1.5px var(--wg-color-border);
  font: 600 11.5px/1.2 var(--wg-font-sans);
  color: var(--wg-color-text-muted);
  pointer-events: none;
}
.wg-pill-legend span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}
.wg-pill-legend i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
  flex: none;
}
.wg-steps {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  border-radius: 13px;
  background: color-mix(in srgb, var(--wg-color-background) 92%, var(--wg-color-surface));
  box-shadow: inset 0 0 0 1.5px var(--wg-color-border);
  font-family: var(--wg-font-sans);
  font-size: 12px;
  color: var(--wg-color-text);
}
.wg-steps button {
  appearance: none;
  border: 0;
  border-radius: 9px;
  background: var(--wg-color-surface);
  color: var(--wg-color-text);
  padding: 5px 11px;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
  box-shadow:
    inset 0 0 0 1.5px var(--wg-color-border),
    0 2px 0 var(--wg-color-border);
  transform: translateY(0);
  transition: transform 70ms ease, box-shadow 70ms ease, color 120ms ease;
}
.wg-steps button:hover:not(:disabled) {
  color: var(--wg-color-accent);
  box-shadow:
    inset 0 0 0 1.5px var(--wg-color-accent),
    0 2px 0 var(--wg-color-accent);
}
.wg-steps button:active:not(:disabled) {
  transform: translateY(2px);
  box-shadow: inset 0 0 0 1.5px var(--wg-color-accent), 0 0 0 var(--wg-color-accent);
}
.wg-steps button:disabled {
  opacity: 0.38;
  cursor: default;
  box-shadow: none;
  background: transparent;
}
.wg-steps-counter {
  min-width: 44px;
  text-align: center;
  font-weight: 700;
  color: var(--wg-color-text-muted);
  font-variant-numeric: tabular-nums;
}
`;

function ensureCardStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CARD_CSS;
  document.head.append(style);
}

export interface CardShellOptions {
  /** Minimum height in px. Defaults to 440. */
  height?: number;
  /** Optional subject / category pill shown above the prompt title. */
  kicker?: string;
  prompt?: string;
  subtitle?: string;
  hint?: string;
}

export type FeedbackTone = 'neutral' | 'success' | 'danger';

export interface FeedbackOptions {
  title: string;
  body?: string;
  tone?: FeedbackTone;
}

export interface CardShellHandle {
  readonly root: HTMLDivElement;
  readonly stage: HTMLDivElement;
  setKicker(text: string): void;
  setPrompt(title: string, subtitle?: string): void;
  showFeedback(options: FeedbackOptions): void;
  hideFeedback(): void;
  setHint(text: string): void;
  dispose(): void;
}

/** Creates a themed, phase-aware card shell with prompt, stage, reveal feedback bar, and hint. */
export function createCardShell(
  root: HTMLElement,
  ctx: ComponentContext,
  options: CardShellOptions = {},
): CardShellHandle {
  ensureCardStyle();

  const height = options.height ?? 440;
  const cardEl = document.createElement('div');
  cardEl.className = 'wg-card';
  cardEl.dataset.phase = ctx.phase;
  cardEl.style.height = `${height}px`;
  cardEl.style.minHeight = `${height}px`;

  const stage = document.createElement('div');
  stage.className = 'wg-card-stage';

  const promptEl = document.createElement('div');
  promptEl.className = 'wg-card-prompt';
  const promptKicker = document.createElement('span');
  promptKicker.className = 'wg-card-kicker';
  promptKicker.hidden = true;
  const promptTitle = document.createElement('div');
  promptTitle.className = 'wg-card-prompt-title';
  const promptSub = document.createElement('div');
  promptSub.className = 'wg-card-prompt-sub';
  promptEl.append(promptKicker, promptTitle, promptSub);

  const feedbackEl = document.createElement('div');
  feedbackEl.className = 'wg-card-feedback';
  feedbackEl.dataset.tone = 'neutral';
  const feedbackBadge = document.createElement('span');
  feedbackBadge.className = 'wg-card-feedback-badge';
  const feedbackText = document.createElement('div');
  const feedbackTitle = document.createElement('div');
  feedbackTitle.className = 'wg-card-feedback-title';
  const feedbackBody = document.createElement('div');
  feedbackBody.className = 'wg-card-feedback-body';
  feedbackText.append(feedbackTitle, feedbackBody);
  feedbackEl.append(feedbackBadge, feedbackText);

  const hintEl = document.createElement('div');
  hintEl.className = 'wg-card-hint';

  cardEl.append(stage, promptEl, feedbackEl, hintEl);
  root.append(cardEl);

  const updatePromptVisibility = () => {
    promptEl.hidden =
      promptKicker.hidden && promptTitle.textContent === '' && promptSub.hidden;
  };

  const setKicker = (text: string) => {
    const clean = text.trim();
    promptKicker.textContent = clean;
    promptKicker.hidden = clean.length === 0;
    updatePromptVisibility();
  };

  const setPrompt = (title: string, subtitle?: string) => {
    const cleanTitle = title.trim();
    const cleanSub = subtitle?.trim() ?? '';
    promptTitle.textContent = cleanTitle;
    promptSub.textContent = cleanSub;
    promptSub.hidden = cleanSub.length === 0;
    updatePromptVisibility();
  };

  const showFeedback = ({ title, body, tone = 'neutral' }: FeedbackOptions) => {
    feedbackEl.dataset.tone = tone;
    feedbackBadge.textContent = tone === 'success' ? '✓' : tone === 'danger' ? '✕' : 'i';
    feedbackTitle.textContent = title;
    const cleanBody = body?.trim() ?? '';
    feedbackBody.textContent = cleanBody;
    feedbackBody.hidden = cleanBody.length === 0;
    requestAnimationFrame(() => feedbackEl.classList.add('show'));
  };

  const hideFeedback = () => {
    feedbackEl.classList.remove('show');
  };

  const setHint = (text: string) => {
    const clean = text.trim();
    hintEl.textContent = clean;
    hintEl.hidden = clean.length === 0;
  };

  setKicker(options.kicker ?? '');
  setPrompt(options.prompt ?? '', options.subtitle);
  setHint(options.hint ?? '');

  const unsubPhase = ctx.onPhaseChange((phase: Phase) => {
    cardEl.dataset.phase = phase;
  });

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    unsubPhase();
    cardEl.remove();
  };
  ctx.signal.addEventListener('abort', dispose, { once: true });

  return {
    root: cardEl,
    stage,
    setKicker,
    setPrompt,
    showFeedback,
    hideFeedback,
    setHint,
    dispose,
  };
}

export interface StepControllerOptions<T> {
  steps: readonly T[];
  questionStep: number;
  revealStep: number;
  onChange: (step: T, index: number) => void;
}

export interface StepControllerHandle {
  getIndex(): number;
  next(): void;
  prev(): void;
  goTo(index: number): void;
  mountControls(container: HTMLElement): () => void;
}

const clampIndex = (idx: number, len: number) => Math.max(0, Math.min(len - 1, Math.trunc(idx)));

/** Coordinates process-breakpoint cards cleanly across 'question' and 'reveal' phases. */
export function createStepController<T>(
  ctx: ComponentContext,
  options: StepControllerOptions<T>,
): StepControllerHandle {
  const { steps, onChange } = options;
  if (steps.length === 0) throw new Error('createStepController requires at least one step');

  const questionIdx = clampIndex(options.questionStep, steps.length);
  const revealIdx = clampIndex(options.revealStep, steps.length);
  let index = ctx.phase === 'reveal' ? revealIdx : questionIdx;

  const uiUpdaters = new Set<() => void>();

  const notify = () => {
    onChange(steps[index]!, index);
    for (const update of uiUpdaters) update();
  };

  const goTo = (target: number) => {
    const next = clampIndex(target, steps.length);
    if (next === index) return;
    index = next;
    notify();
  };

  const next = () => goTo(index + 1);
  const prev = () => goTo(index - 1);

  const unsubPhase = ctx.onPhaseChange((phase) => {
    goTo(phase === 'reveal' ? revealIdx : questionIdx);
  });

  ctx.signal.addEventListener(
    'abort',
    () => {
      unsubPhase();
      uiUpdaters.clear();
    },
    { once: true },
  );

  // Render initial state so callers do not have to duplicate step drawing at mount.
  notify();

  const mountControls = (container: HTMLElement) => {
    ensureCardStyle();
    const bar = document.createElement('div');
    bar.className = 'wg-steps';
    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.textContent = '上一步';
    const counter = document.createElement('span');
    counter.className = 'wg-steps-counter';
    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.textContent = '下一步';

    const update = () => {
      prevBtn.disabled = index <= 0;
      nextBtn.disabled = index >= steps.length - 1;
      counter.textContent = `${index + 1} / ${steps.length}`;
    };

    prevBtn.addEventListener('click', prev);
    nextBtn.addEventListener('click', next);
    bar.append(prevBtn, counter, nextBtn);
    container.append(bar);
    uiUpdaters.add(update);
    update();

    const cleanup = () => {
      uiUpdaters.delete(update);
      bar.remove();
    };
    ctx.signal.addEventListener('abort', cleanup, { once: true });
    return cleanup;
  };

  return {
    getIndex: () => index,
    next,
    prev,
    goTo,
    mountControls,
  };
}

function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Selects a card variant deterministically from a seed, or randomly when seed is omitted. */
export function pickVariant<T>(variants: readonly T[], seed?: string | number): T {
  if (variants.length === 0) throw new Error('pickVariant requires at least one variant');
  if (seed === undefined) {
    return variants[Math.floor(Math.random() * variants.length)]!;
  }
  const idx = hashString(String(seed)) % variants.length;
  return variants[idx]!;
}
