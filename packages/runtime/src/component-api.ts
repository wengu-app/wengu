/**
 * The contract a Wengu component is written against — API version 1.
 *
 * This file is written to be pasted into a generation prompt as-is.
 *
 * A component is one ES module (plain JavaScript) that exports `mount`:
 *
 * ```js
 * import * as THREE from 'three';                                       // only libraries listed in the manifest
 * import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
 * import { createCardShell, createStepController, pickVariant } from 'wengu/card'; // always available
 * import { createScene3D } from 'wengu/scene3d';                         // available when 'three' is in manifest.libraries
 *
 * export function mount(root, ctx) {
 *   // root: an empty <div> that fills the frame's width. Build everything inside it.
 *   // ctx:  see ComponentContext below.
 *   const t = ctx.theme.tokens;                     // or use CSS: var(--wg-color-accent)
 *   // Two-phase in-place reveal (review mode):
 *   //   ctx.phase starts as 'question' (or 'reveal'). Subscribe with ctx.onPhaseChange(phase => ...)
 *   //   to reveal labels/answers smoothly on the same canvas without losing WebGL state or camera orbit.
 *   //   Interactive visual checks may call ctx.requestReveal() (and optionally ctx.submitResult(...)).
 *   ...
 *   return () => { ... };                           // optional cleanup: stop loops, dispose GPU resources
 * }
 * ```
 *
 * Rules:
 *  - No network. fetch/XHR/WebSocket, external <img>/<script>/<link>/fonts and navigation are all blocked.
 *    Embed any data or assets in the module (data: URLs are fine).
 *  - No storage. localStorage, IndexedDB and cookies are unavailable. Keep state in memory.
 *  - Height: the frame grows to fit the content of `root`. Give 3D canvases an explicit height.
 *  - Theme: the frame's CSS variables update automatically. Code that bakes colours in (WebGL) should use
 *    `ctx.onThemeChange` to update them.
 *  - Two-phase reveal: in review cards, render the question state immediately at mount (`ctx.phase === 'question'`),
 *    and transition smoothly in-place when `ctx.onPhaseChange('reveal')` fires. Call `ctx.requestReveal()` when an
 *    in-canvas interaction should trigger the host reveal state.
 *  - In `review` mode, call `ctx.submitResult` at most once when the learner finishes an interactive check.
 *  - Errors thrown from `mount` or later are reported to the host; the learner sees a fallback.
 */

import type { JsonObject, JsonValue } from './json.ts';
import type { Theme } from './tokens.ts';

export type Mode = 'learn' | 'review';

export type Phase = 'question' | 'reveal';

export const SHORTCUT_KEYS = [
  'Space',
  'Enter',
  'Digit1',
  'Digit2',
  'Digit3',
  'Digit4',
  'KeyR',
  'KeyE',
  'KeyZ',
] as const;

export type ShortcutKey = (typeof SHORTCUT_KEYS)[number];

/** Outcome of one review interaction. Feeds the spaced-repetition scheduler. */
export interface ReviewResult {
  outcome: 'correct' | 'incorrect';
  /** Optional partial credit in [0, 1]. */
  score?: number;
  /** What the learner did, in words, for the review log. Max 500 chars. */
  detail?: string;
  /** Machine-readable response for later analysis. JSON only, small. */
  response?: JsonValue;
}

export interface ComponentContext {
  readonly apiVersion: 1;
  /** `learn`: explain/explore freely. `review`: pose a question and report the answer via submitResult. */
  readonly mode: Mode;
  /** Current review phase ('question' or 'reveal'). Updated before onPhaseChange listeners run. */
  readonly phase: Phase;
  /** Knowledge-point data supplied by the app. Plain JSON. */
  readonly props: Readonly<JsonObject>;
  /** Current theme. Same values as the CSS variables. Updated before onThemeChange listeners run. */
  readonly theme: Theme;
  /** Subscribe to theme changes (light/dark). Returns an unsubscribe function. */
  onThemeChange(listener: (theme: Theme) => void): () => void;
  /** Subscribe to in-place phase changes ('question' <-> 'reveal') without remounting. Returns an unsubscribe function. */
  onPhaseChange(listener: (phase: Phase) => void): () => void;
  /** Request the host to transition from 'question' to 'reveal' (e.g. after an in-canvas answer). */
  requestReveal(): void;
  /** Report the learner's answer (review mode). Only the first call per mount counts. */
  submitResult(result: ReviewResult): void;
  /** Aborted when the component is unmounted. Handy for `addEventListener(type, fn, { signal: ctx.signal })`. */
  readonly signal: AbortSignal;
}

export type Cleanup = () => void;

/** What the module must export as `mount`. */
export type MountFunction = (root: HTMLElement, ctx: ComponentContext) => void | Cleanup | Promise<void | Cleanup>;
