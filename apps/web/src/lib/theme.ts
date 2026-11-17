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
  bg: "#f7f4ee",
  surface: "#fffdf9",
  sunken: "#f1ede5",
  raised: "#ffffff",
  ink: "#1d1b18",
  muted: "#6b655c",
  faint: "#9a948a",
  line: "#e6e0d5",
  lineStrong: "#d4cdbf",
  accent: "#b23a2b",
  accentInk: "#fffdf9",
  accentSoft: "rgba(178, 58, 43, 0.08)",
  again: "#b23a2b",
  hard: "#9a6418",
  good: "#3c7a52",
  easy: "#2f5d8a",
  newc: "#2f5d8a",
  learn: "#b23a2b",
  review: "#3c7a52",
  focus: "#2f5d8a",
  shadow: "0 1px 0 rgba(29, 27, 24, 0.04), 0 12px 32px -18px rgba(29, 27, 24, 0.28)",
  scrim: "rgba(29, 27, 24, 0.28)",
};

export const dark: Palette = {
  bg: "#141311",
  surface: "#1c1a17",
  sunken: "#171513",
  raised: "#24211d",
  ink: "#ece7de",
  muted: "#a39c90",
  faint: "#716b61",
  line: "#2e2b27",
  lineStrong: "#3d3934",
  accent: "#e0664f",
  accentInk: "#141311",
  accentSoft: "rgba(224, 102, 79, 0.12)",
  again: "#e0735e",
  hard: "#d9a05b",
  good: "#7fbf93",
  easy: "#7fa8d1",
  newc: "#7fa8d1",
  learn: "#e0735e",
  review: "#7fbf93",
  focus: "#7fa8d1",
  shadow: "0 1px 0 rgba(0, 0, 0, 0.3), 0 16px 40px -20px rgba(0, 0, 0, 0.7)",
  scrim: "rgba(0, 0, 0, 0.5)",
};

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
    "--wg-bg": p.bg,
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
