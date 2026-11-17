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
  typeCompare?: string | null;
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
  private ready = false;
  private revision = 0;
  private sentSeq: number | null = null;
  private warmMath = false;
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
    iframe.addEventListener("load", this.onLoad);
    iframe.src = frameUrl();
  }

  private disconnect(): void {
    this.ready = false;
    this.revision++;
    this.port?.close();
    this.port = null;
    this.sentSeq = null;
    this.sentMedia.clear();
    this.mathSent = false;
  }

  private onLoad = () => {
    if (this.disposed) return;
    this.disconnect();
    if (this.lastCard) this.armWatchdog(this.seq, this.lastCard.side);
    const ch = new MessageChannel();
    this.port = ch.port1;
    ch.port1.onmessage = (e: MessageEvent) => {
      if (!this.disposed && this.port === ch.port1) this.onMessage(e.data as FrameToHost);
    };
    this.iframe.contentWindow?.postMessage({ t: "wengu-init" }, "*", [ch.port2]);
  };

  private onMessage(m: FrameToHost): void {
    switch (m.t) {
      case "ready":
        if (this.ready) break;
        this.ready = true;
        if (this.theme) this.post({ t: "theme", theme: this.theme });
        if (this.warmMath) void this.preloadMath();
        void this.sendCard();
        break;
      case "shown":
        if (this.awaiting && this.awaiting.seq === m.seq && this.awaiting.side === m.side) {
          this.clearWatchdog();
          this.events.onShown?.(m.seq, m.side);
        }
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

  /** Queues the latest card and returns its sequence without waiting for a broken frame to reconnect. */
  async show(card: FrameCard): Promise<number> {
    if (this.disposed) return this.seq;
    const seq = ++this.seq;
    this.lastCard = card;
    this.armWatchdog(seq, card.side);
    void this.sendCard();
    return seq;
  }

  /** Replays the latest card after every handshake, including reloads initiated by the desktop shell. */
  private async sendCard(): Promise<void> {
    const card = this.lastCard;
    const port = this.port;
    if (!this.ready || !card || !port || this.disposed) return;
    const revision = ++this.revision;
    const seq = this.seq;
    if (card.hasMath) await this.preloadMath();
    if (this.disposed || !this.ready || port !== this.port || revision !== this.revision) return;
    const media: Record<string, Blob> = {};
    for (const [name, blob] of Object.entries(card.media)) {
      if (this.sentMedia.has(name)) continue;
      media[name] = blob;
      this.sentMedia.add(name);
    }
    const msg: ShowCard = { t: "show", seq, mode: card.mode, question: card.question, answer: card.answer, css: card.css, cardClass: card.cardClass, media, side: card.side, emphasis: card.emphasis, typeCompare: card.typeCompare };
    this.sentSeq = seq;
    this.post(msg);
  }

  /** Shows the answer side, or queues it if the frame is reconnecting. */
  reveal(typeCompare: string | null): void {
    if (!this.lastCard || this.disposed) return;
    this.lastCard = { ...this.lastCard, side: "answer", typeCompare };
    this.revision++;
    if (this.ready && this.sentSeq === this.seq) this.post({ t: "reveal", seq: this.seq, typeCompare });
    else void this.sendCard();
    this.armWatchdog(this.seq, "answer");
  }

  /** Warm-up: load MathJax into the frame before a card needs it. */
  async preloadMath(): Promise<void> {
    this.warmMath = true;
    const port = this.port;
    if (this.disposed || !this.ready || this.mathSent || !port) return;
    const code = await loadMathJaxCode();
    if (!this.disposed && this.ready && !this.mathSent && port === this.port) {
      this.post({ t: "mathjax", code });
      this.mathSent = true;
    }
  }

  focusType(): void {
    this.post({ t: "focusType" });
  }

  clear(): void {
    this.seq++;
    this.revision++;
    this.lastCard = null;
    this.clearWatchdog();
    this.post({ t: "clear" });
  }

  get currentSeq(): number {
    return this.seq;
  }

  /** A deck script that breaks the frame (or loops) must not leave the reviewer stuck: reload and show again. */
  private armWatchdog(seq: number, side: "question" | "answer"): void {
    this.awaiting = { seq, side };
    // Input can keep coming while the renderer is dead. Track the latest acknowledgement we need, but do not
    // let every reveal/rating postpone recovery indefinitely. Only an actual paint clears this deadline.
    if (this.watchdog) return;
    this.watchdog = setTimeout(() => {
      this.watchdog = null;
      if (this.disposed || !this.awaiting) return;
      console.warn("[card] frame did not respond; reloading it");
      this.disconnect();
      // Removing and reinserting the same DOM element creates a new browsing context. Reloading src alone can
      // stay attached to the dead/busy renderer. Keep the element itself so React's ref remains valid.
      const parent = this.iframe.parentNode;
      const next = this.iframe.nextSibling;
      this.iframe.remove();
      this.iframe.src = frameUrl();
      parent?.insertBefore(this.iframe, next);
      // Bound the handshake too: load/ready may never arrive. Do not strand show() on an abandoned promise.
      this.armWatchdog(this.seq, this.lastCard?.side ?? side);
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
    this.disconnect();
  }
}
