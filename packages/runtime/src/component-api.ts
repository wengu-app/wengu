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
 *
 * export function mount(root, ctx) {
 *   // root: an empty <div> that fills the frame's width. Build everything inside it.
 *   // ctx:  see ComponentContext below.
 *   const t = ctx.theme.tokens;                     // or use CSS: var(--wg-color-accent)
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
 *  - In `review` mode, call `ctx.submitResult` exactly once when the learner has answered.
 *  - Errors thrown from `mount` or later are reported to the host; the learner sees a fallback.
 */

import type { JsonObject, JsonValue } from './json.ts';
import type { Theme } from './tokens.ts';

export type Mode = 'learn' | 'review';

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
  /** Knowledge-point data supplied by the app. Plain JSON. */
  readonly props: Readonly<JsonObject>;
  /** Current theme. Same values as the CSS variables. Updated before onThemeChange listeners run. */
  readonly theme: Theme;
  /** Subscribe to theme changes (light/dark). Returns an unsubscribe function. */
  onThemeChange(listener: (theme: Theme) => void): () => void;
  /** Report the learner's answer (review mode). Only the first call per mount counts. */
  submitResult(result: ReviewResult): void;
  /** Aborted when the component is unmounted. Handy for `addEventListener(type, fn, { signal: ctx.signal })`. */
  readonly signal: AbortSignal;
}

export type Cleanup = () => void;

/** What the module must export as `mount`. */
export type MountFunction = (root: HTMLElement, ctx: ComponentContext) => void | Cleanup | Promise<void | Cleanup>;
