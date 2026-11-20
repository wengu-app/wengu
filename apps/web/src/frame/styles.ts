/** Stylesheets inside the card frame. */

/** Always present: frame chrome that both modes need (replay buttons, type-in box, comparison, hints). */
export const BASE_CSS = `
html { -webkit-text-size-adjust: 100%; }
html, body { margin: 0; min-height: 100%; }
body { overflow-wrap: break-word; }
img { max-width: 100%; height: auto; }
.replay-button { display: inline-flex; align-items: center; justify-content: center; vertical-align: middle;
  width: 1.6em; height: 1.6em; margin: 0 .15em; padding: 0; border-radius: 50%; cursor: pointer;
  border: 1px solid var(--wg-line, rgba(0,0,0,.2)); background: var(--wg-surface, transparent); color: var(--wg-accent, currentColor); }
.replay-button svg { width: 55%; height: 55%; margin-left: 8%; fill: currentColor; }
.replay-button:focus-visible { outline: 2px solid var(--wg-accent, #3a5fcd); outline-offset: 2px; }
#typeans { font: inherit; font-size: .9em; width: min(100%, 22em); box-sizing: border-box; padding: .35em .6em;
  border: 1px solid var(--wg-line, #ccc); border-radius: 8px; background: var(--wg-surface, #fff); color: inherit; text-align: center; }
#typeans:focus { outline: 2px solid var(--wg-accent, #3a5fcd); outline-offset: 1px; }
.wg-typeans-result { font-family: var(--wg-mono, ui-monospace, monospace); font-size: .9em; line-height: 1.6; }
.wg-typeans-result .typeGood { color: var(--wg-good, #1f8a5b); }
.wg-typeans-result .typeBad { color: var(--wg-again, #c9412f); text-decoration: line-through; text-decoration-thickness: 1px; }
.wg-typeans-result .typeMissed { color: var(--wg-muted, #777); text-decoration: underline dotted; }
.wg-typeans-result .typeArrow { display: block; color: var(--wg-muted, #777); font-size: .8em; line-height: 1.2; }
.wg-latex-fallback { display: inline-block; }
mjx-container[display="true"] { margin: .6em 0 !important; }
mjx-container { max-width: 100%; overflow-x: auto; overflow-y: hidden; }
`;

/** Original mode: Anki's own reviewer defaults, under the deck's CSS. */
export const ORIGINAL_CSS = `
body { margin: 20px; }
body.nightMode.card, body.night_mode.card { background-color: #1b1b1c; color: #ecebe7; }
body.nightMode a, body.night_mode a { color: #8aa6ff; }
`;

/** Wengu mode: the content set in Wengu's typography; the deck's CSS and scripts are not used. */
export const WENGU_CSS = `
:root { color-scheme: light; }
:root.dark { color-scheme: dark; }
body.wg { min-height: 100vh; display: flex; flex-direction: column;
  background: var(--wg-bg); color: var(--wg-ink); font-family: var(--wg-sans);
  font-size: var(--wg-card-size, 18.5px); line-height: 1.7; -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility; font-kerning: normal; }
@media (max-width: 560px) { body.wg { --wg-card-size: 16.5px; } }
.wg-card { box-sizing: border-box; width: 100%; max-width: 40em; margin: 0 auto;
  padding: clamp(28px, 6.5vh, 56px) clamp(24px, 5vw, 52px) 48px; text-align: start; }
body.wg-center .wg-card { margin: auto;
  padding: clamp(28px, 6vh, 48px) clamp(24px, 5vw, 48px) clamp(40px, 8vh, 68px); text-align: center; }
body.wg:not(.wg-center) #typeans { text-align: start; }
.wg-card p { margin: 0 0 .75em; }
.wg-card p:last-child { margin-bottom: 0; }
.wg-card :is(ul, ol) { display: block; text-align: start; margin: .4em 0 .85em; padding-inline-start: 1.4em; }
.wg-card li + li { margin-top: .25em; }
body.wg-center .wg-card :is(ul, ol) { display: inline-block; }
.wg-card :is(pre, table, blockquote) { text-align: start; }
.wg-card table { display: table; max-width: 100%; border-collapse: collapse; margin: .6em 0; font-size: .9em; }
body.wg-center .wg-card table { margin-inline: auto; }
.wg-card :is(td, th) { border-bottom: 1px solid var(--wg-line); padding: .35em .75em; vertical-align: top; }
.wg-card th { font-weight: 600; }
.wg-card pre, .wg-card code { font-family: var(--wg-mono); }
.wg-card code { font-size: .85em; background: var(--wg-sunken); padding: .12em .38em; border-radius: 5px; }
.wg-card pre { background: var(--wg-sunken); padding: .85em 1.05em; border-radius: 10px; border: 1px solid var(--wg-line);
  overflow-x: auto; font-size: .82em; line-height: 1.55; }
.wg-card pre code { background: none; padding: 0; border-radius: 0; font-size: inherit; }
.wg-card blockquote { margin: .7em 0; padding-inline-start: 1em; border-inline-start: 3px solid var(--wg-line); color: var(--wg-muted); }
.wg-card img { max-height: 62vh; border-radius: 8px; vertical-align: middle; }
.wg-card a { color: var(--wg-accent); }
.wg-card b, .wg-card strong { font-weight: 650; }
.wg-card hr { border: 0; border-top: 1px solid var(--wg-line); margin: 1.2em 0; }
.wg-card hr#answer { border-top: 1.5px solid var(--wg-line); margin: 1.35em 0 1.25em; }
body.wg-center .wg-card hr#answer { width: min(100%, 8em); margin: 1.35em auto 1.25em; }
.wg-card ruby rt { font-size: .55em; font-weight: 500; color: var(--wg-muted); letter-spacing: .02em; }
.wg-card .cloze { color: var(--wg-accent); font-weight: 650; }
.wg-q .wg-card .cloze, .wg-card .cloze[data-cloze] { font-weight: 600; background: var(--wg-accent-soft);
  border-radius: 6px; padding: 0 .3em; }
.wg-card .cloze-inactive { color: inherit; }
.wg-card a.hint { display: inline-block; font-size: .78em; font-weight: 500; color: var(--wg-muted);
  text-decoration: none; border: 1px dashed var(--wg-line); border-radius: 999px; padding: .15em .85em; margin: .4em 0; }
.wg-card a.hint:hover { color: var(--wg-ink); border-color: var(--wg-muted); }
.wg-card div.hint { color: var(--wg-muted); font-size: .92em; margin-top: .3em; }
.wg-card ::selection { background: var(--wg-accent-soft); }
.wg-card .wg-large { font-size: 1.75em; line-height: 1.3; font-weight: 650; }
.wg-card .wg-small { font-size: .74em; color: var(--wg-muted); line-height: 1.5; margin-top: 1em; }
.wg-card .wg-muted { color: var(--wg-muted); }
.wg-card .wg-italic { font-style: italic; }
body.wg-qa .wg-front { font-size: 1.12em; font-weight: 600; line-height: 1.5; letter-spacing: -0.005em; }
body.wg-qa .wg-front :is(.wg-typeans, .wg-typeans-result, a.hint) { font-size: .88em; font-weight: 400; letter-spacing: normal; }
body.wg-short .wg-front { font-size: 2.05em; font-weight: 700; line-height: 1.25; letter-spacing: -0.015em; }
body.wg-short .wg-front :is(.wg-typeans, .wg-typeans-result, a.hint) { font-size: .48em; font-weight: 400; line-height: 1.6; letter-spacing: normal; }
body.wg-short .wg-front .wg-typeans { margin-top: .6em; }
.wg-typeans { margin-top: .6em; }
.wg-reveal { animation: wg-in 140ms cubic-bezier(.2,0,0,1); }
@keyframes wg-in { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .wg-reveal { animation: none; } }
`;

export const PLAY_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9-5.5z"/></svg>';
