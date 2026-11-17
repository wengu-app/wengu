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
body.wg { background: var(--wg-bg); color: var(--wg-ink); font-family: var(--wg-serif);
  font-size: var(--wg-card-size, 22px); line-height: 1.65; -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility; font-kerning: normal; }
@media (max-width: 560px) { body.wg { --wg-card-size: 19px; } }
.wg-card { box-sizing: border-box; max-width: 36em; margin: 0 auto; padding: clamp(28px, 9vh, 88px) 24px 64px;
  text-align: center; }
body.wg-prose .wg-card { text-align: start; }
.wg-card p { margin: 0 0 .7em; }
.wg-card :is(ul, ol) { display: inline-block; text-align: start; margin: .3em 0 .8em; padding-inline-start: 1.3em; }
.wg-card :is(pre, table, blockquote) { text-align: start; }
.wg-card table { display: inline-table; border-collapse: collapse; margin: .5em 0; font-size: .9em; }
.wg-card :is(td, th) { border-bottom: 1px solid var(--wg-line); padding: .3em .7em; vertical-align: top; }
.wg-card th { font-weight: 600; }
.wg-card pre, .wg-card code { font-family: var(--wg-mono); font-size: .82em; }
.wg-card pre { background: var(--wg-sunken); padding: .8em 1em; border-radius: 8px; overflow-x: auto; }
.wg-card blockquote { margin: .6em 0; padding-inline-start: 1em; border-inline-start: 3px solid var(--wg-line); color: var(--wg-muted); }
.wg-card img { max-height: 62vh; border-radius: 6px; vertical-align: middle; }
.wg-card a { color: var(--wg-accent); }
.wg-card b, .wg-card strong { font-weight: 650; }
.wg-card hr { border: 0; border-top: 1px solid var(--wg-line); margin: 1.1em auto; }
.wg-card hr#answer { width: min(100%, 12em); margin: 1.2em auto 1.1em; }
.wg-card ruby rt { font-size: .5em; color: var(--wg-muted); letter-spacing: .02em; }
.wg-card .cloze { color: var(--wg-accent); font-weight: 650; }
.wg-q .wg-card .cloze, .wg-card .cloze[data-cloze] { font-weight: 600; background: var(--wg-accent-soft);
  border-radius: 6px; padding: 0 .3em; }
.wg-card .cloze-inactive { color: inherit; }
.wg-card a.hint { display: inline-block; font-family: var(--wg-sans); font-size: .7em; color: var(--wg-muted);
  text-decoration: none; border: 1px dashed var(--wg-line); border-radius: 999px; padding: .1em .8em; margin: .3em 0; }
.wg-card a.hint:hover { color: var(--wg-ink); border-color: var(--wg-muted); }
.wg-card div.hint { color: var(--wg-muted); font-size: .9em; }
.wg-card .wg-small { font-size: .75em; color: var(--wg-muted); }
.wg-card ::selection { background: var(--wg-accent-soft); }
.wg-card .wg-large { font-size: 1.8em; line-height: 1.3; }
.wg-card .wg-small { font-size: .68em; font-family: var(--wg-sans); color: var(--wg-muted); line-height: 1.5; margin-top: .8em; }
.wg-card .wg-muted { color: var(--wg-muted); }
.wg-card .wg-italic { font-style: italic; }
body.wg-short .wg-front { font-size: 1.9em; line-height: 1.3; }
body.wg-short .wg-front :is(.wg-typeans, .wg-typeans-result, a.hint) { font-size: .5em; line-height: 1.6; }
body.wg-short .wg-front .wg-typeans { margin-top: .6em; }
.wg-typeans { margin-top: .5em; }
.wg-reveal { animation: wg-in 140ms cubic-bezier(.2,0,0,1); }
@keyframes wg-in { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { body.wg-short .wg-front { font-size: 1.9em; line-height: 1.3; }
body.wg-short .wg-front :is(.wg-typeans, .wg-typeans-result, a.hint) { font-size: .5em; line-height: 1.6; }
body.wg-short .wg-front .wg-typeans { margin-top: .6em; }
.wg-typeans { margin-top: .5em; }
.wg-reveal { animation: none; } }
`;

export const PLAY_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9-5.5z"/></svg>';
