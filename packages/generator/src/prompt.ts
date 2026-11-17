/**
 * The generation prompt. The system part is identical for every call (contract, libraries, sandbox rules, tokens,
 * teaching guidance, output format) so the provider can cache it; the knowledge point goes in the user message.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { darkTokens, lightTokens, tokensToCssVariables, type Mode } from '@wengu/runtime';
import { loadLibraries, RUNTIME_ROOT } from './libraries.ts';
import type { Message } from './provider/types.ts';
import type { Finding, KnowledgePoint, ModelOutput } from './types.ts';

/** The runtime's contract file, verbatim. It is written to be pasted into a prompt. */
export function contractText(): string {
  return readFileSync(path.join(RUNTIME_ROOT, 'src/component-api.ts'), 'utf8');
}

function librariesText(): string {
  const libs = loadLibraries();
  const three = libs.three!;
  const addons = Object.keys(three.modules)
    .filter((s) => s !== 'three')
    .sort();
  return [
    `- three ${three.version}: \`import * as THREE from 'three'\`. WebGL2. Addons, each importable by exactly this specifier:`,
    ...addons.map((a) => `    '${a}'`),
    `- d3 ${libs.d3!.version}: \`import * as d3 from 'd3'\` (the full d3 namespace: selection, scales, shapes, transitions, force, hierarchy, drag, zoom, ...).`,
    `- katex ${libs.katex!.version}: \`import katex from 'katex'\`; \`katex.render(tex, element, { throwOnError: false })\` or \`katex.renderToString(...)\`. Its CSS and fonts are injected for you.`,
    '- No library at all: plain DOM, SVG, Canvas 2D and Web Animations are always available and often the best choice.',
    'Nothing else can be imported: no other packages, no URLs, no relative paths. Import specifiers must match exactly.',
  ].join('\n');
}

function tokensText(): string {
  const light = tokensToCssVariables(lightTokens);
  const dark = tokensToCssVariables(darkTokens);
  const rows = Object.keys(light).map((k) => (light[k] === dark[k] ? `${k}: ${light[k]}` : `${k}: ${light[k]}  (dark: ${dark[k]})`));
  return rows.join('\n');
}

export function systemPrompt(): string {
  return `You write interactive visualizations that teach, for Wengu (温故), a learning app with spaced repetition.
Each visualization is a "component": ONE self-contained ES module in plain JavaScript that runs in a sandboxed iframe.
You get a knowledge point; you return the component. Its form is entirely up to you: 3D scene, SVG diagram,
animated canvas, simulation with sliders, draggable construction, step-through animation, anything that teaches it best.

# 1. The contract (the runtime's component-api.ts, verbatim)

\`\`\`ts
${contractText()}
\`\`\`

The host passes \`ctx.props\` = { "knowledgePointId", "title", "subject", "language" }. Everything else the component
needs (data, coordinates, wording, questions) must be embedded in the module itself.

# 2. Libraries the host can inject

${librariesText()}

The manifest's \`libraries\` list is derived from your import statements; you do not write the manifest.

# 3. Sandbox constraints (violations are detected and fail the self-check)

- iframe sandbox="allow-scripts", opaque origin, strict CSP. No network of any kind (fetch, XHR, WebSocket, external
  images/fonts/stylesheets/scripts, CDN imports). Use data: URLs or draw things yourself.
- No storage (localStorage/sessionStorage/IndexedDB/cookies throw). No alert/confirm/prompt (modals are blocked), no
  window.open, no navigation, no <form> submission (use buttons with click handlers; never rely on form submit).
- Width: the frame is as wide as the card it sits in, typically 640-760 px, but it must also work from 360 px to 1000 px.
  Size things from root.clientWidth and react to resizes (ResizeObserver on root). Never assume window.innerWidth.
- Height: the frame grows to fit root's content (min 120 px, max 2000 px). Give canvases/SVGs an explicit height
  (typically 320-520 px). Avoid layouts whose height changes every frame (it floods the host with resize messages,
  which kills the component) and avoid height that depends on itself (feedback loops).
- The host pings the frame every 500 ms; a main thread blocked for 3 s gets the component killed. No long synchronous
  loops; animate with requestAnimationFrame.
- WebGL runs on a software renderer in the self-check: keep scenes modest (no huge geometry, no heavy post-processing).
- Clean up: the returned cleanup must stop animation loops/timers, disconnect observers and dispose three.js renderers.
  Use \`ctx.signal\` for event listeners.
- Errors thrown anywhere are reported and fail the self-check. So are console.error calls. Code defensively.

# 4. Recommended style (design tokens — recommended, not required)

The frame sets these CSS custom properties on :root and updates them when the theme changes; the same values are in
\`ctx.theme.tokens\` (camelCase: ctx.theme.tokens.color.accent, .fontSize.md, .space.lg, .color.categorical[0] ...):

${tokensText()}

The body already has background var(--wg-color-surface), color var(--wg-color-text) and the sans font.
Whatever palette you use, the component MUST be legible in both the light and the dark theme, and a theme switch while
mounted must update it: CSS variables update by themselves; anything painted with baked-in colours (canvas 2D, WebGL,
d3 attributes set from ctx.theme) must be repainted in ctx.onThemeChange. The look should be calm and clean: generous
spacing, one accent colour, no gratuitous gradients/shadows/emoji.
Contrast: structural lines that carry meaning (circles, axes, edges of a graph, outlines) must stay clearly visible in
BOTH themes: draw them with --wg-color-text-muted (or text), not --wg-color-border, which is only for subtle dividers.
Interactive drawings (drag targets, SVG/canvas you can drag on) need \`user-select: none\` so dragging does not
highlight labels.

# 5. What makes a visualization teach

- The visual carries the idea. Cover the text: the picture alone should still show the mechanism, relationship or
  structure. Text labels support the picture; they do not replace it. A paragraph next to a decorative picture fails.
- Show the causal/structural core of the knowledge point, the thing a learner usually gets wrong or cannot picture.
  Where a variable drives the effect, let the learner change it directly (slider, drag, step, play/pause) and see the
  consequence immediately, with the relevant quantities visible.
- Be correct. Compute positions/values from the real formulas or real data; label units; keep proportions honest or say
  "not to scale". Do not add claims beyond the given content unless they are standard textbook facts.
- The learner's language is given (\`language\`); ALL visible text must be in it. Keep text short: a title, short labels,
  a one- or two-sentence takeaway. Never let labels overlap each other or the drawing; text >= 12 px.
- First impression matters: about 1.5 s after mount, without any interaction, the component must already show the key
  idea (screenshots are taken then). Do not start on an empty stage or behind a "start" button.
- learn mode: explain and let the learner explore.
- review mode: pose ONE genuine recall question about this knowledge point that the learner answers by acting on the
  visualization where possible (predict and place, pick the part, set the slider, order the steps, choose among a few
  options). The answer must NOT be visible before answering (hide the labels/values that give it away). Never call
  submitResult before the learner has acted. When they answer: show whether it was right, reveal the correct answer
  with a one-sentence explanation in the visual, and call ctx.submitResult exactly once:
  { outcome: 'correct' | 'incorrect', score?: 0..1, detail: '<what they answered, in words>', response: <small JSON> }.
  Disable further answering afterwards.
- If only learn mode is requested, still handle ctx.mode === 'review' gracefully (render learn mode).

# 6. The self-check your component goes through

1. Static checks: parses as an ES module, exports mount, imports only the specifiers above, no network/storage APIs.
2. It is mounted in headless Chromium through the real sandbox, once per requested mode: first in the light theme, then
   switched to dark while mounted. Load errors, runtime errors, console errors, CSP violations, watchdog kills and blank
   renders fail it. Screenshots are taken in each mode and theme. In learn mode, buttons, sliders and the canvas are then
   poked at to make sure nothing breaks.
3. Review mode: your \`reviewTest\` steps are executed: the \`correct\` steps on a fresh mount must lead to
   submitResult({outcome:'correct'}), the \`incorrect\` steps on another fresh mount to outcome 'incorrect'.
4. A reviewer looks at the screenshots against the knowledge point: blank or broken rendering, overlapping or
   unreadable text, factual errors, and whether the visual actually conveys the idea.
Failures come back to you as concrete findings to fix.

# 7. Output (JSON, matching the schema)

- title: short title in the learner's language.
- design: 2-4 sentences: what the learner sees and does, and why that makes the idea stick.
- source: the complete ES module. It must \`export function mount(root, ctx)\` (may be async).
- reviewTest: null if review mode is not requested. Otherwise { correct: Step[], incorrect: Step[] }, where each Step is
  { action, selector, x, y, x2, y2, value } with unused fields null:
    click   selector: CSS selector of an element inside the component (give answer elements stable ids or data-*
            attributes so this is unambiguous; the selector must match exactly one visible element)
    clickAt x, y: fractions 0..1 of the root element's box (for canvas/WebGL targets)
    drag    x, y -> x2, y2: fractions of the root box
    fill    selector + value (text inputs; also works on <input type=range> with a numeric string)
    press   value: key name such as "Enter" (selector optional, focuses it first)
    wait    value: milliseconds as a string
  The steps run about 1.5 s after mount. Make them deterministic: don't randomise the question or the option order
  (or seed the randomness so the steps stay valid).
`;
}

export function userPrompt(kp: KnowledgePoint, modes: Mode[]): string {
  const data = {
    id: kp.id,
    title: kp.title,
    subject: kp.subject,
    language: kp.language ?? 'zh-CN',
    content: kp.content,
    sources: kp.sources ?? [],
  };
  return `Knowledge point:
\`\`\`json
${JSON.stringify(data, null, 2)}
\`\`\`

Modes to implement: ${modes.map((m) => `"${m}"`).join(', ')}.
Write the component.`;
}

export function repairPrompt(findings: Finding[], attempt: number): string {
  const lines = findings.map((f) => `- [${f.stage}${f.where ? ` · ${f.where}` : ''}] ${f.code}: ${f.message}`);
  return `The self-check of attempt ${attempt} failed with these findings:
${lines.join('\n')}

Fix every finding. Keep what works; change what is needed (a different approach is fine if the current one cannot be
made to work). Return the complete output again, with the full module source.`;
}

/** Conversation for an attempt: the task, plus (for a repair) the previous output and its findings. */
export function buildMessages(
  kp: KnowledgePoint,
  modes: Mode[],
  previous?: { output: ModelOutput | string; findings: Finding[]; attempt: number; earlier?: Finding[] },
): Message[] {
  const msgs: Message[] = [{ role: 'user', content: userPrompt(kp, modes) }];
  if (previous) {
    const prevText = typeof previous.output === 'string' ? previous.output : JSON.stringify(previous.output);
    msgs.push({ role: 'assistant', content: prevText });
    let text = repairPrompt(previous.findings, previous.attempt);
    if (previous.earlier?.length) {
      text += `\n\nEarlier attempts also failed on: ${[...new Set(previous.earlier.map((f) => f.code))].join(', ')}. Don't reintroduce those.`;
    }
    msgs.push({ role: 'user', content: text });
  }
  return msgs;
}

const nullable = (t: string) => ({ type: [t, 'null'] });

const STEP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['action', 'selector', 'x', 'y', 'x2', 'y2', 'value'],
  properties: {
    action: { type: 'string', enum: ['click', 'clickAt', 'fill', 'press', 'drag', 'wait'] },
    selector: nullable('string'),
    x: nullable('number'),
    y: nullable('number'),
    x2: nullable('number'),
    y2: nullable('number'),
    value: nullable('string'),
  },
};

export const OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'design', 'source', 'reviewTest'],
  properties: {
    title: { type: 'string' },
    design: { type: 'string' },
    source: { type: 'string' },
    reviewTest: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['correct', 'incorrect'],
          properties: {
            correct: { type: 'array', items: STEP_SCHEMA },
            incorrect: { type: 'array', items: STEP_SCHEMA },
          },
        },
        { type: 'null' },
      ],
    },
  },
};
