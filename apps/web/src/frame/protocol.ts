/**
 * Messages between the app and the card frame. The app creates a MessageChannel and hands one port to the frame
 * once, when the (still empty) frame document has loaded and before any deck code runs; everything after that goes
 * over the port. Deck scripts never see the port, so they cannot send messages in the frame's name.
 */

export type RenderMode = "wengu" | "original";

export interface FrameTheme {
  dark: boolean;
  /** CSS custom properties for Wengu mode (`--wg-…`). */
  vars: Record<string, string>;
}

export interface ShowCard {
  t: "show";
  seq: number;
  mode: RenderMode;
  /** Question HTML, markers already turned into elements. Media references are file names. */
  question: string;
  /** Answer HTML (`#wg-typeans-result` placeholders where a comparison goes). */
  answer: string;
  /** Deck CSS (original mode only). */
  css: string;
  /** Classes for <body> in original mode, Anki-style: "card card1". */
  cardClass: string;
  /** Media not yet sent to this frame (the frame keeps what it got). */
  media: Record<string, Blob>;
  /** Start on the answer side (e.g. re-showing a card after an edit). */
  side: "question" | "answer";
  /** Wengu mode: deck class → Wengu emphasis classes (see emphasisMap). */
  emphasis: Record<string, string[]>;
  /** Text direction hint for Wengu mode. */
  rtl?: boolean;
}

export type HostToFrame =
  | ShowCard
  | { t: "reveal"; seq: number; typeCompare: string | null }
  | { t: "theme"; theme: FrameTheme }
  | { t: "mathjax"; code: string }
  | { t: "clear" }
  | { t: "focusType" };

export interface FrameKey {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export type FrameToHost =
  | { t: "ready" }
  /** Painted (after typesetting). */
  | { t: "shown"; seq: number; side: "question" | "answer" }
  | { t: "key"; ev: FrameKey; inInput: boolean }
  | { t: "play"; side: "q" | "a"; index: number }
  | { t: "typed"; seq: number; value: string }
  | { t: "error"; message: string };
