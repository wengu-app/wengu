/**
 * The card frame: runs inside `<iframe sandbox="allow-scripts">` (opaque origin, no network by CSP). It receives
 * card HTML and media Blobs from the app over a private MessagePort, turns the Blobs into blob: URLs of its own
 * (an opaque-origin frame cannot load the app's blob: URLs), and renders the card in one of two modes:
 *
 *  - original: the deck's CSS and scripts, as Anki shows it (body.card.cardN, div#qa, scripts re-run on each side);
 *  - wengu: the same content cleaned of the deck's scripts and styling, set in Wengu's typography.
 *
 * The frame stays alive across cards (like Anki's reviewer webview), so media and MathJax are loaded once.
 */
import { replaceMediaReferences } from "@wengu/core";
import type { FrameKey, FrameTheme, FrameToHost, HostToFrame, ShowCard } from "./protocol.ts";
import { cleanHtml } from "./sanitize.ts";
import { BASE_CSS, ORIGINAL_CSS, WENGU_CSS } from "./styles.ts";

// Captured before any deck script runs, so a template cannot intercept or forge our messages by patching prototypes.
const portPost = MessagePort.prototype.postMessage;
const apply = Reflect.apply;
const createObjectURL = URL.createObjectURL.bind(URL);
const raf = window.requestAnimationFrame.bind(window);
let send: (m: FrameToHost) => void = () => {};

interface MathJaxApi {
  typesetPromise(els: Element[]): Promise<void>;
  typesetClear(els: Element[]): void;
  startup: { defaultReady(): void; promise: Promise<void> };
}
const mj = () => (window as unknown as { MathJax?: MathJaxApi }).MathJax;

const media = new Map<string, string>();
let mathReady: Promise<void> | null = null;

let current: ShowCard | null = null;
let answerStash: Promise<void> = Promise.resolve();
let theme: FrameTheme = { dark: false, vars: {} };
let shortPrompt = false;
let revealed = false;

let qa: HTMLElement;
let stash: HTMLElement;
let modeStyle: HTMLStyleElement;
let deckStyle: HTMLStyleElement;

function setup(): void {
  const base = document.createElement("style");
  base.textContent = BASE_CSS;
  modeStyle = document.createElement("style");
  deckStyle = document.createElement("style");
  document.head.append(base, modeStyle, deckStyle);
  qa = document.createElement("div");
  qa.id = "qa";
  stash = document.createElement("div");
  stash.setAttribute("aria-hidden", "true");
  stash.style.cssText = "position:absolute;left:-10000px;top:0;width:min(36em,100vw);visibility:hidden;pointer-events:none";
  document.body.append(qa, stash);

  window.addEventListener("keydown", onKey, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("input", (e) => {
    const t = e.target as HTMLElement;
    if (t.id === "typeans" && current) send({ t: "typed", seq: current.seq, value: (t as HTMLInputElement).value });
  });
  window.addEventListener("error", (e) => send({ t: "error", message: String(e.message) }));
}

// ------------------------------------------------------------------------------------------ input

function onKey(e: KeyboardEvent): void {
  if (!e.isTrusted) return;
  if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta") return;
  const t = e.target as HTMLElement | null;
  // Once the answer is being revealed, the type-in box is on its way out: keys typed into it are reviewer keys.
  const inInput = !!t && (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable) && !(revealed && t.id === "typeans");
  if (inInput && e.key !== "Enter" && e.key !== "Escape") return;
  if (e.key === " " || (inInput && e.key === "Enter")) e.preventDefault();
  const ev: FrameKey = { key: e.key, code: e.code, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey };
  send({ t: "key", ev, inInput });
}

function onClick(e: MouseEvent): void {
  const target = e.target as Element | null;
  if (!target || !e.isTrusted) return;
  const play = target.closest("[data-wg-play]");
  if (play) {
    e.preventDefault();
    const [side, index] = (play.getAttribute("data-wg-play") ?? "").split(":");
    if ((side === "q" || side === "a") && index !== undefined) send({ t: "play", side, index: Number(index) });
    return;
  }
  const hint = target.closest("a.hint");
  if (hint) {
    e.preventDefault();
    const next = hint.nextElementSibling;
    if (next instanceof HTMLElement && next.classList.contains("hint")) {
      (hint as HTMLElement).style.display = "none";
      next.style.display = "block";
    }
    return;
  }
  // Links would navigate the frame away (and are blocked by the app's frame-src anyway).
  const link = target.closest("a[href]");
  if (link && !(link.getAttribute("href") ?? "").startsWith("#")) e.preventDefault();
}

// ------------------------------------------------------------------------------------------ media & math

function addMedia(files: Record<string, Blob>): void {
  for (const [name, blob] of Object.entries(files)) if (!media.has(name)) media.set(name, createObjectURL(blob));
}

const withMedia = (html: string) => replaceMediaReferences(html, (name) => media.get(name));

function loadMathJax(code: string): void {
  if (mathReady) return;
  mathReady = new Promise<void>((resolve) => {
    (window as unknown as { MathJax: unknown }).MathJax = {
      tex: {
        inlineMath: [["\\(", "\\)"]],
        displayMath: [["\\[", "\\]"]],
        processEscapes: false,
        processEnvironments: false,
        processRefs: false,
      },
      svg: { fontCache: "global" },
      options: { enableMenu: false },
      loader: { load: [] },
      startup: {
        typeset: false,
        ready() {
          const m = mj()!;
          m.startup.defaultReady();
          // Typeset one formula off-screen so the first real card does not pay MathJax's first-run cost.
          void m.startup.promise
            .then(() => (m as unknown as { tex2svgPromise?: (s: string) => Promise<unknown> }).tex2svgPromise?.("x^2"))
            .catch(() => undefined)
            .then(() => resolve());
        },
      },
    };
    const s = document.createElement("script");
    s.src = createObjectURL(new Blob([code], { type: "text/javascript" }));
    s.onerror = () => resolve();
    document.head.append(s);
  });
}

function hasMath(el: Element): boolean {
  const text = el.textContent ?? "";
  return text.includes("\\(") || text.includes("\\[");
}

/** Anki renders [latex] to images with an external LaTeX install; when the image is not in the collection, typeset the source with MathJax. */
function latexFallback(root: Element): void {
  for (const img of Array.from(root.querySelectorAll("img.latex"))) {
    const src = img.getAttribute("src") ?? "";
    if (src.startsWith("blob:") || src.startsWith("data:")) continue;
    const tex = (img.getAttribute("alt") ?? "").trim();
    if (!tex) continue;
    const span = document.createElement("span");
    span.className = "wg-latex-fallback";
    const display = /^\\begin\{displaymath\}([\s\S]*)\\end\{displaymath\}$/.exec(tex);
    const inline = /^\$([\s\S]*)\$$/.exec(tex);
    if (display) span.textContent = `\\[${display[1]}\\]`;
    else if (inline) span.textContent = `\\(${inline[1]}\\)`;
    else span.textContent = /\$/.test(tex) ? tex.replace(/\$\$([\s\S]+?)\$\$|\$([\s\S]+?)\$/g, (_w, d?: string, i?: string) => (d !== undefined ? `\\[${d}\\]` : `\\(${i}\\)`)) : `\\(${tex}\\)`;
    img.replaceWith(span);
  }
}

async function typeset(el: Element): Promise<void> {
  if (!hasMath(el) || !mathReady) return;
  await mathReady;
  const m = mj();
  if (!m?.typesetPromise) return;
  try {
    await m.typesetPromise([el]);
  } catch (e) {
    send({ t: "error", message: `MathJax: ${String(e)}` });
  }
}

function clearMath(el: Element): void {
  try {
    mj()?.typesetClear?.([el]);
  } catch {
    /* MathJax not loaded */
  }
}

// ------------------------------------------------------------------------------------------ rendering

/** Re-creates <script> elements so they run (innerHTML does not run them), in order, like Anki's reviewer. */
async function runScripts(container: Element): Promise<void> {
  for (const old of Array.from(container.querySelectorAll("script"))) {
    const s = document.createElement("script");
    for (const a of Array.from(old.attributes)) s.setAttribute(a.name, a.value);
    s.textContent = old.textContent;
    const loaded = s.src ? new Promise<void>((r) => ((s.onload = () => r()), (s.onerror = () => r()))) : null;
    old.replaceWith(s);
    if (loaded) await loaded;
  }
}

function applyTheme(): void {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(theme.vars)) root.style.setProperty(k, v);
  root.classList.toggle("dark", theme.dark);
  for (const c of ["nightMode", "night_mode"]) document.body.classList.toggle(c, theme.dark);
}

function bodyClasses(card: ShowCard, side: "question" | "answer"): string {
  const night = theme.dark ? " nightMode night_mode" : "";
  if (card.mode === "original") return `${card.cardClass}${night}`;
  return `wg ${side === "question" ? "wg-q" : "wg-a"}${night}${shortPrompt ? " wg-short" : ""}`;
}

function setProse(): void {
  document.body.classList.toggle("wg-prose", (qa.textContent ?? "").replace(/\s+/g, " ").length > 220);
}

/** Wengu mode: the part above `<hr id=answer>` (the question) in its own block, so a short prompt can be set large. */
function wrapFront(root: ParentNode): void {
  const kids = Array.from(root.childNodes);
  const hr = kids.findIndex((n) => n instanceof HTMLHRElement && n.id === "answer");
  const front = document.createElement("div");
  front.className = "wg-front";
  front.append(...(hr < 0 ? kids : kids.slice(0, hr)));
  root.insertBefore(front, root.firstChild);
}

function isShortPrompt(el: Element): boolean {
  const text = (el.textContent ?? "").replace(/\s+/g, "");
  return text.length > 0 && Array.from(text).length <= 14 && !el.querySelector("img, table, ul, ol, pre, .wg-large");
}

function applyEmphasis(root: ParentNode, map: Record<string, string[]>): void {
  for (const [cls, add] of Object.entries(map)) {
    for (const el of Array.from(root.querySelectorAll(`.${CSS.escape(cls)}`))) el.classList.add(...add);
  }
}

function afterPaint(): Promise<void> {
  // The task after the next animation frame runs once that frame has been painted.
  return new Promise((r) => raf(() => setTimeout(r, 0)));
}

async function show(card: ShowCard): Promise<void> {
  current = card;
  revealed = card.side === "answer";
  addMedia(card.media);
  clearMath(qa);
  window.scrollTo(0, 0);
  if (card.mode === "original") {
    modeStyle.textContent = ORIGINAL_CSS;
    deckStyle.textContent = withMedia(card.css);
    qa.className = "";
    qa.removeAttribute("dir");
    stash.replaceChildren();
  } else {
    modeStyle.textContent = WENGU_CSS;
    deckStyle.textContent = "";
    qa.className = "wg-card";
    qa.dir = card.rtl ? "rtl" : "auto";
  }
  document.body.className = bodyClasses(card, card.side);
  const html = card.side === "question" ? card.question : card.answer;
  qa.style.visibility = "hidden";
  if (card.mode === "original") {
    qa.innerHTML = withMedia(html);
    latexFallback(qa);
    await runScripts(qa);
  } else {
    const frag = cleanHtml(withMedia(html), { restyle: true });
    applyEmphasis(frag, card.emphasis);
    wrapFront(frag);
    qa.replaceChildren(frag);
    latexFallback(qa);
    setProse();
    const front = qa.querySelector(".wg-front");
    shortPrompt = !!front && isShortPrompt(front);
    document.body.classList.toggle("wg-short", shortPrompt);
    if (card.side === "question") {
      // Prepare the answer side now so revealing it is a node swap.
      clearMath(stash);
      const answerFrag = cleanHtml(withMedia(card.answer), { restyle: true });
      applyEmphasis(answerFrag, card.emphasis);
      wrapFront(answerFrag);
      stash.replaceChildren(answerFrag);
      latexFallback(stash);
      answerStash = typeset(stash);
    }
  }
  if (card.side === "answer") {
    for (const el of Array.from(qa.querySelectorAll(".wg-typeans-result"))) el.innerHTML = card.typeCompare ?? "";
  }
  await typeset(qa);
  // The answer may have been requested while this side was still rendering: the reveal takes over from here.
  if (current !== card || (revealed && card.side === "question")) return;
  qa.style.visibility = "";
  const input = qa.querySelector<HTMLInputElement>("#typeans");
  if (input && card.side === "question") input.focus({ preventScroll: true });
  await afterPaint();
  if (current === card && !(revealed && card.side === "question")) send({ t: "shown", seq: card.seq, side: card.side });
}

async function reveal(seq: number, typeCompare: string | null): Promise<void> {
  const card = current;
  if (!card || card.seq !== seq) return;
  revealed = true;
  document.body.className = bodyClasses(card, "answer");
  clearMath(qa);
  if (card.mode === "wengu") {
    await answerStash;
    if (current !== card) return;
    qa.replaceChildren(...Array.from(stash.childNodes));
    setProse();
  } else {
    qa.style.visibility = "hidden";
    qa.innerHTML = withMedia(card.answer);
    latexFallback(qa);
    await runScripts(qa);
    await typeset(qa);
    if (current !== card) return;
    qa.style.visibility = "";
  }
  for (const el of Array.from(qa.querySelectorAll(".wg-typeans-result"))) el.innerHTML = typeCompare ?? "";
  const hr = qa.querySelector("hr#answer");
  if (hr && card.mode === "wengu") {
    let n = hr.nextSibling;
    while (n) {
      if (n instanceof HTMLElement) n.classList.add("wg-reveal");
      n = n.nextSibling;
    }
  }
  if (hr instanceof HTMLElement) {
    const top = hr.getBoundingClientRect().top;
    if (top > window.innerHeight * 0.6) window.scrollTo({ top: window.scrollY + top - 24 });
  }
  await afterPaint();
  if (current === card) send({ t: "shown", seq, side: "answer" });
}


function handle(m: HostToFrame): void {
  switch (m.t) {
    case "show":
      void show(m);
      break;
    case "reveal":
      void reveal(m.seq, m.typeCompare);
      break;
    case "theme":
      theme = m.theme;
      applyTheme();
      if (current) document.body.className = bodyClasses(current, document.body.classList.contains("wg-a") ? "answer" : "question");
      break;
    case "mathjax":
      loadMathJax(m.code);
      break;
    case "clear":
      current = null;
      clearMath(qa);
      qa.replaceChildren();
      stash.replaceChildren();
      break;
    case "focusType":
      qa.querySelector<HTMLInputElement>("#typeans")?.focus();
      break;
  }
}

window.addEventListener("message", function init(ev: MessageEvent) {
  const data = ev.data as { t?: string } | null;
  if (ev.source !== window.parent || !data || data.t !== "wengu-init" || !ev.ports[0]) return;
  window.removeEventListener("message", init);
  const port = ev.ports[0];
  send = (m) => apply(portPost, port, [m]);
  port.onmessage = (e: MessageEvent) => handle(e.data as HostToFrame);
  send({ t: "ready" });
});

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setup, { once: true });
else setup();
