/**
 * Design tokens: Wengu's *recommended* visual style.
 *
 * They reach a component twice, with identical values:
 *  - as CSS custom properties on the frame's :root (e.g. `var(--wg-color-accent)`), for DOM/SVG content;
 *  - as `ctx.theme.tokens`, for code that cannot read CSS (WebGL materials, canvas 2D).
 * Components are free to ignore them.
 */

export type ColorScheme = 'light' | 'dark';

export interface DesignTokens {
  color: {
    /** Page background behind cards. */
    background: string;
    /** Card / component surface. The frame's own background. */
    surface: string;
    /** Slightly raised surface (popovers, overlays inside a component). */
    surfaceRaised: string;
    text: string;
    textMuted: string;
    border: string;
    accent: string;
    /** Text/icon colour on top of `accent`. */
    onAccent: string;
    success: string;
    danger: string;
    warning: string;
    /** Categorical palette for data series, in order. */
    categorical: string[];
  };
  font: {
    sans: string;
    serif: string;
    mono: string;
  };
  /** Font sizes in px. */
  fontSize: { xs: number; sm: number; md: number; lg: number; xl: number };
  lineHeight: number;
  /** Spacing scale in px. */
  space: { xs: number; sm: number; md: number; lg: number; xl: number; xxl: number };
  /** Corner radii in px. */
  radius: { sm: number; md: number; lg: number };
  motion: { fastMs: number; baseMs: number; easing: string };
}

export interface Theme {
  scheme: ColorScheme;
  tokens: DesignTokens;
}

const shared = {
  font: {
    sans: '"Inter", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Microsoft YaHei", system-ui, -apple-system, "Segoe UI", sans-serif',
    serif: '"Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", Georgia, serif',
    mono: '"JetBrains Mono", "SF Mono", ui-monospace, Menlo, Consolas, monospace',
  },
  fontSize: { xs: 12, sm: 13, md: 15, lg: 18, xl: 24 },
  lineHeight: 1.55,
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
  radius: { sm: 6, md: 10, lg: 16 },
  motion: { fastMs: 120, baseMs: 240, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
} satisfies Omit<DesignTokens, 'color'>;

export const lightTokens: DesignTokens = {
  ...shared,
  color: {
    background: '#f6f5f1',
    surface: '#ffffff',
    surfaceRaised: '#ffffff',
    text: '#1d1c1a',
    textMuted: '#6c6a64',
    border: '#e4e1d9',
    accent: '#3a5fcd',
    onAccent: '#ffffff',
    success: '#1f8a5b',
    danger: '#c9412f',
    warning: '#b7791f',
    categorical: ['#3a5fcd', '#d9822b', '#1f8a5b', '#b54aa0', '#c9412f', '#2a9bb3'],
  },
};

export const darkTokens: DesignTokens = {
  ...shared,
  color: {
    background: '#121212',
    surface: '#1b1b1c',
    surfaceRaised: '#252527',
    text: '#ecebe7',
    textMuted: '#9c9a94',
    border: '#2f2f31',
    accent: '#8aa6ff',
    onAccent: '#0e1530',
    success: '#4cc38a',
    danger: '#ff7a68',
    warning: '#f0b35a',
    categorical: ['#8aa6ff', '#f5a65b', '#4cc38a', '#e38ad2', '#ff7a68', '#5cc8de'],
  },
};

export function themeFor(scheme: ColorScheme): Theme {
  return { scheme, tokens: scheme === 'dark' ? darkTokens : lightTokens };
}

function kebab(s: string): string {
  return s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
}

/** Flattens tokens into CSS custom properties: `--wg-color-accent`, `--wg-space-md` (with px), `--wg-color-categorical-0`, ... */
export function tokensToCssVariables(tokens: DesignTokens): Record<string, string> {
  const out: Record<string, string> = {};
  const px = (n: number) => `${n}px`;
  for (const [k, v] of Object.entries(tokens.color)) {
    if (Array.isArray(v)) v.forEach((c, i) => (out[`--wg-color-${kebab(k)}-${i}`] = c));
    else out[`--wg-color-${kebab(k)}`] = v;
  }
  for (const [k, v] of Object.entries(tokens.font)) out[`--wg-font-${k}`] = v;
  for (const [k, v] of Object.entries(tokens.fontSize)) out[`--wg-font-size-${k}`] = px(v);
  out['--wg-line-height'] = String(tokens.lineHeight);
  for (const [k, v] of Object.entries(tokens.space)) out[`--wg-space-${k}`] = px(v);
  for (const [k, v] of Object.entries(tokens.radius)) out[`--wg-radius-${k}`] = px(v);
  out['--wg-motion-fast'] = `${tokens.motion.fastMs}ms`;
  out['--wg-motion-base'] = `${tokens.motion.baseMs}ms`;
  out['--wg-motion-easing'] = tokens.motion.easing;
  return out;
}
