/**
 * App side of the card frame: loads `card-frame.html` into a sandboxed iframe, hands it a private MessagePort, and
 * sends cards, media and theme. Only messages that arrive on that port are trusted to come from our frame script.
 *
 * Isolation: `sandbox="allow-scripts"` without `allow-same-origin` gives the frame an opaque origin, so deck code
 * cannot reach the app's DOM, storage, OPFS or cookies; the frame's CSP blocks every network request; the app page's
 * `frame-src 'self'` stops it navigating itself elsewhere; no popups, forms or top navigation (sandbox).
 * Media: the frame cannot load the app's blob: URLs (they belong to the app's origin), so the app posts the Blobs
 * themselves and the frame makes its own blob: URLs. Each file is sent once per frame lifetime.
 */
import type { FrameTheme, FrameToHost, HostToFrame, RenderMode, ShowCard } from "../frame/protocol.ts";

let mathjaxCode: Promise<string> | null = null;
/** MathJax (bundled, ~2 MB) is loaded only when a card has math, then kept by the frame. */
export function loadMathJaxCode(): Promise<string> {
  mathjaxCode ??= import("mathjax/es5/tex-svg-full.js?raw").then((m: { default: string }) => m.default);
  return mathjaxCode;
}

export interface FrameCard {
  mode: RenderMode;
  question: string;
  answer: string;
  css: string;
  cardClass: string;
  media: Record<string, Blob>;
  hasMath: boolean;
  side: "question" | "answer";
  emphasis: Record<string, string[]>;
}

export interface FrameEvents {
  onShown?(seq: number, side: "question" | "answer"): void;
  onKey?(ev: Extract<FrameToHost, { t: "key" }>): void;
  onPlay?(side: "q" | "a", index: number): void;
  onTyped?(seq: number, value: string): void;
}

const WATCHDOG_MS = 5000;

export function frameUrl(): string {
  return new URL("card-frame.html", document.baseURI).href;
}

export class FrameController {
  private port: MessagePort | null = null;
  private readyPromise!: Promise<void>;
  private resolveReady!: () => void;
  private sentMedia = new Set<string>();
  private mathSent = false;
  private seq = 0;
  private lastCard: FrameCard | null = null;
  private awaiting: { seq: number; side: "question" | "answer" } | null = null;
  private theme: FrameTheme | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  events: FrameEvents = {};

  constructor(readonly iframe: HTMLIFrameElement) {
    this.resetReady();
    iframe.addEventListener("load", this.onLoad);
    iframe.src = frameUrl();
  }

  private resetReady(): void {
    this.readyPromise = new Promise((r) => (this.resolveReady = r));
  }

  private onLoad = () => {
    if (this.disposed) return;
    this.port?.close();
    this.sentMedia.clear();
    this.mathSent = false;
    const ch = new MessageChannel();
    this.port = ch.port1;
    ch.port1.onmessage = (e: MessageEvent) => this.onMessage(e.data as FrameToHost);
    this.iframe.contentWindow?.postMessage({ t: "wengu-init" }, "*", [ch.port2]);
  };

  private onMessage(m: FrameToHost): void {
    switch (m.t) {
      case "ready":
        if (this.theme) this.post({ t: "theme", theme: this.theme });
        this.resolveReady();
        break;
      case "shown":
        if (this.awaiting && this.awaiting.seq === m.seq && this.awaiting.side === m.side) this.clearWatchdog();
        this.events.onShown?.(m.seq, m.side);
        break;
      case "key":
        this.events.onKey?.(m);
        break;
      case "play":
        this.events.onPlay?.(m.side, m.index);
        break;
      case "typed":
        this.events.onTyped?.(m.seq, m.value);
        break;
      case "error":
        console.warn("[card]", m.message);
        break;
    }
  }

  private post(m: HostToFrame): void {
    this.port?.postMessage(m);
  }

  setTheme(theme: FrameTheme): void {
    this.theme = theme;
    if (this.port) this.post({ t: "theme", theme });
  }

  /** Shows a card; resolves with its sequence number once the message is sent (not yet painted). */
  async show(card: FrameCard): Promise<number> {
    const seq = ++this.seq;
    this.lastCard = card;
    await this.readyPromise;
    if (card.hasMath && !this.mathSent) {
      const code = await loadMathJaxCode();
      if (!this.mathSent) {
        this.post({ t: "mathjax", code });
        this.mathSent = true;
      }
    }
    if (seq !== this.seq) return seq;
    const media: Record<string, Blob> = {};
    for (const [name, blob] of Object.entries(card.media)) {
      if (this.sentMedia.has(name)) continue;
      media[name] = blob;
      this.sentMedia.add(name);
    }
    const msg: ShowCard = { t: "show", seq, mode: card.mode, question: card.question, answer: card.answer, css: card.css, cardClass: card.cardClass, media, side: card.side, emphasis: card.emphasis };
    this.post(msg);
    this.armWatchdog(seq, card.side);
    return seq;
  }

  /** Shows the answer side of the current card. */
  reveal(typeCompare: string | null): void {
    if (this.lastCard) this.lastCard = { ...this.lastCard, side: "answer" };
    const seq = this.seq;
    this.post({ t: "reveal", seq, typeCompare });
    this.armWatchdog(seq, "answer");
  }

  /** Warm-up: load MathJax into the frame before a card needs it. */
  async preloadMath(): Promise<void> {
    await this.readyPromise;
    if (this.mathSent) return;
    const code = await loadMathJaxCode();
    if (!this.mathSent && this.port) {
      this.post({ t: "mathjax", code });
      this.mathSent = true;
    }
  }

  focusType(): void {
    this.post({ t: "focusType" });
  }

  clear(): void {
    this.seq++;
    this.lastCard = null;
    this.clearWatchdog();
    this.post({ t: "clear" });
  }

  get currentSeq(): number {
    return this.seq;
  }

  /** A deck script that breaks the frame (or loops) must not leave the reviewer stuck: reload and show again. */
  private armWatchdog(seq: number, side: "question" | "answer"): void {
    this.clearWatchdog();
    this.awaiting = { seq, side };
    this.watchdog = setTimeout(() => {
      if (this.disposed || seq !== this.seq || !this.awaiting) return;
      console.warn("[card] frame did not respond; reloading it");
      const card = this.lastCard;
      this.resetReady();
      this.iframe.src = frameUrl();
      if (card) void this.show(card);
    }, WATCHDOG_MS);
  }

  private clearWatchdog(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
    this.awaiting = null;
  }

  dispose(): void {
    this.disposed = true;
    this.clearWatchdog();
    this.iframe.removeEventListener("load", this.onLoad);
    this.port?.close();
    this.port = null;
  }
}
