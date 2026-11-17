/**
 * Colours and type of the app, one source for both the app page (CSS custom properties on :root) and the card frame.
 * The palette is the landing page's (warm paper, ink, seal red), extended with the semantic colours the reviewer needs.
 * Intervals, counts and ratings use Anki's familiar colour coding, in muted tones.
 */
export interface Palette {
  bg: string;
  surface: string;
  sunken: string;
  raised: string;
  ink: string;
  muted: string;
  faint: string;
  line: string;
  lineStrong: string;
  accent: string;
  accentInk: string;
  accentSoft: string;
  /** Rating / queue colours. */
  again: string;
  hard: string;
  good: string;
  easy: string;
  newc: string;
  learn: string;
  review: string;
  focus: string;
  shadow: string;
  scrim: string;
}

export const light: Palette = {
  bg: "#f7f5ef",
  surface: "#ffffff",
  sunken: "#f0ede5",
  raised: "#ffffff",
  ink: "#24221d",
  muted: "#5b5850",
  faint: "#958f83",
  line: "#e7e2d6",
  lineStrong: "#d6d0c1",
  accent: "#f26a3d",
  accentInk: "#ffffff",
  accentSoft: "rgba(242, 106, 61, 0.1)",
  again: "#ec4d5e",
  hard: "#f1a62a",
  good: "#1fae7a",
  easy: "#3d8bf0",
  newc: "#3d8bf0",
  learn: "#ec4d5e",
  review: "#1fae7a",
  focus: "#3d8bf0",
  shadow: "0 0 0 2px #e7e2d6, 0 20px 50px rgba(36, 34, 29, 0.14)",
  scrim: "rgba(20, 18, 14, 0.35)",
};

export const dark: Palette = {
  bg: "#141412",
  surface: "#1e1d1a",
  sunken: "#191816",
  raised: "#24231f",
  ink: "#efece4",
  muted: "#bdb9ae",
  faint: "#85817a",
  line: "#2c2a26",
  lineStrong: "#3a3732",
  accent: "#f26a3d",
  accentInk: "#ffffff",
  accentSoft: "rgba(242, 106, 61, 0.16)",
  again: "#ef5f6f",
  hard: "#f1a62a",
  good: "#2cbb86",
  easy: "#4d95f2",
  newc: "#4d95f2",
  learn: "#ef5f6f",
  review: "#2cbb86",
  focus: "#4d95f2",
  shadow: "0 0 0 2px #2c2a26, 0 20px 50px rgba(0, 0, 0, 0.5)",
  scrim: "rgba(0, 0, 0, 0.55)",
};

/** Deck colours: each root deck gets one (by id), used for its pack, its card band and its row in tables. */
export const DECK_COLORS: readonly [string, string][] = [
  ["#3a6bd6", "#2b51a8"],
  ["#13958e", "#0c736d"],
  ["#d24877", "#a8335c"],
  ["#7857cf", "#5a3ea8"],
  ["#e0812f", "#b8621a"],
  ["#2f9fd6", "#1f7aa8"],
  ["#5a9e3a", "#427a29"],
  ["#c95fbd", "#9c4692"],
];

/** Colour of a deck, by the name of its root deck (so a deck and its subdecks share it everywhere). */
export function deckColor(deckName: string): [string, string] {
  const root = deckName.split("::")[0] ?? "";
  let h = 0;
  for (const ch of root) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return DECK_COLORS[h % DECK_COLORS.length]!;
}

export const fonts = {
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans SC", system-ui, sans-serif',
  serif: '"Iowan Old Style", "Charter", "Georgia", "Noto Serif CJK SC", "Noto Serif SC", "Source Han Serif SC", "Songti SC", "STSong", serif',
  mono: '"JetBrains Mono", "SF Mono", ui-monospace, Menlo, Consolas, "Noto Sans Mono CJK SC", monospace',
};

function kebab(s: string): string {
  return s.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
}

/** `--c-bg`, `--c-accent-soft`, …, `--font-serif` for the app. */
export function appVars(p: Palette): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(p)) out[`--c-${kebab(k)}`] = v;
  for (const [k, v] of Object.entries(fonts)) out[`--font-${k}`] = v;
  return out;
}

/** `--wg-…` variables for Wengu mode in the card frame. */
export function frameVars(p: Palette): Record<string, string> {
  return {
    "--wg-bg": p.surface,
    "--wg-surface": p.surface,
    "--wg-sunken": p.sunken,
    "--wg-ink": p.ink,
    "--wg-muted": p.muted,
    "--wg-line": p.line,
    "--wg-accent": p.accent,
    "--wg-accent-soft": p.accentSoft,
    "--wg-good": p.good,
    "--wg-again": p.again,
    "--wg-serif": fonts.serif,
    "--wg-sans": fonts.sans,
    "--wg-mono": fonts.mono,
  };
}
