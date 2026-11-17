/** Drawn charts for the home page and statistics: stacked cuboids, a gauge, a stopwatch and a jar. */
import type { ReactNode } from "react";

export interface CuboidSeg {
  n: number;
  /** CSS colour of the front face. */
  color: string;
}

export interface CuboidCol {
  label: string;
  sub?: string;
  segs: CuboidSeg[];
  /** Lighter colours: days that have not come yet. */
  faded?: boolean;
}

const side = (c: string) => `color-mix(in srgb, ${c} 72%, #000)`;
const top = (c: string) => `color-mix(in srgb, ${c} 62%, #fff)`;
const fade = (c: string) => `color-mix(in srgb, ${c} 55%, var(--c-surface))`;

/**
 * One column of stacked cuboids per day, one layer per card. The first column carries a total bubble; when it is much
 * taller than the rest it is drawn shorter with a break mark.
 */
export function Cuboids({ cols, unitLabel, ariaLabel }: { cols: CuboidCol[]; unitLabel?: (n: number) => string; ariaLabel: string }) {
  const W = 660;
  const H = 300;
  const base = 246;
  const maxH = 190;
  const slots = cols.length + 0.6;
  const slot = W / slots;
  const w = Math.min(24, slot * 0.52);
  const dx = Math.min(9, slot * 0.2);
  const dy = -dx * 0.78;
  const totals = cols.map((c) => c.segs.reduce((a, s) => a + s.n, 0));
  const maxRest = Math.max(6, ...totals.slice(1));
  const unit = Math.min(8, maxH / maxRest);
  const fmt = unitLabel ?? ((n: number) => String(n));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="cuboids" role="img" aria-label={ariaLabel}>
      {cols.map((col, i) => {
        const tot = totals[i]!;
        const x0 = i ? slot * (i + 0.6) + (slot - w - dx) / 2 : (slot - w - dx) / 2 + 4;
        const cx = x0 + (w + dx) / 2;
        const scale = tot * unit > maxH ? maxH / (tot * unit) : 1;
        const cut = scale < 1;
        const parts: ReactNode[] = [];
        let y = base;
        let topColor: string | null = null;
        parts.push(<path key="shadow" d={`M${x0 - 3},${base + 2} h${w + 6} l${dx},${dy} h${-(w + 6)} z`} fill="#000" opacity={0.06} />);
        if (!tot) {
          parts.push(
            <g key="empty">
              <rect x={x0} y={base - 3} width={w} height={3} style={{ fill: "var(--c-line-strong)" }} />
              <path d={`M${x0},${base - 3} h${w} l${dx},${dy} h${-w} z`} style={{ fill: "var(--c-sunken)", stroke: "var(--c-line-strong)" }} strokeWidth={1} />
            </g>,
          );
        }
        col.segs.forEach((seg, k) => {
          if (!seg.n) return;
          const c = col.faded ? fade(seg.color) : seg.color;
          const h = seg.n * unit * scale;
          const yt = y - h;
          parts.push(
            <g key={`s${k}`}>
              <rect x={x0} y={yt} width={w} height={h} style={{ fill: c }} />
              <path d={`M${x0 + w},${y} l${dx},${dy} V${yt + dy} l${-dx},${-dy} z`} style={{ fill: side(c) }} />
              {!cut && unit >= 4 &&
                Array.from({ length: seg.n - 1 }, (_, j) => {
                  const yy = y - (j + 1) * unit;
                  return <path key={j} d={`M${x0},${yy} h${w} l${dx},${dy}`} fill="none" style={{ stroke: side(c) }} strokeWidth={1} opacity={0.35} />;
                })}
            </g>,
          );
          y = yt;
          topColor = c;
        });
        if (topColor) {
          if (cut) {
            const yb = base - maxH * 0.55;
            const zig = Array.from({ length: Math.ceil((w + 4) / 5) }, (_, j) => `l2.5,${j % 2 ? 4 : -4}`).join(" ");
            parts.push(<path key="cut" d={`M${x0 - 2},${yb} ${zig} v-6 H${x0 - 2} z`} style={{ fill: "var(--c-surface)" }} />);
          }
          parts.push(<path key="top" d={`M${x0},${y} h${w} l${dx},${dy} h${-w} z`} style={{ fill: top(topColor) }} />);
        }
        if (i === 0) {
          if (tot) {
            const label = fmt(tot);
            const bw = label.length * 8.5 + 22;
            const by = y + dy - 12;
            parts.push(
              <g key="bubble">
                <rect x={cx - bw / 2} y={by - 22} width={bw} height={24} rx={8} style={{ fill: "var(--c-ink)" }} />
                <path d={`M${cx - 5},${by + 2} l5,5 l5,-5 z`} style={{ fill: "var(--c-ink)" }} />
                <text x={cx} y={by - 5} className="cb-bubble">
                  {label}
                </text>
              </g>,
            );
          }
          parts.push(
            <g key="day">
              <rect x={cx - 24} y={base + 12} width={48} height={22} rx={8} style={{ fill: "var(--c-ink)" }} />
              <text x={cx} y={base + 27} className="cb-day is-today">
                {col.label}
              </text>
            </g>,
          );
        } else {
          if (tot)
            parts.push(
              <text key="n" x={cx} y={y + dy - 7} className="cb-n">
                {tot}
              </text>,
            );
          parts.push(
            <text key="day" x={cx} y={base + 27} className="cb-day">
              {col.label}
            </text>,
          );
        }
        if (col.sub)
          parts.push(
            <text key="sub" x={cx} y={base + 46} className="cb-sub">
              {col.sub}
            </text>,
          );
        return (
          <g key={i} className="cb-col">
            <title>{`${col.label} · ${tot}`}</title>
            {parts}
          </g>
        );
      })}
    </svg>
  );
}

/** Half-circle gauge from `min` to 100 (percent), with a needle at `value` and a tick at `target`. */
export function Gauge({ value, target, min = 70, ok }: { value: number | null; target: number; min?: number; ok: boolean }) {
  const ang = (p: number) => Math.PI * (1 - Math.min(1, Math.max(0, (p - min) / (100 - min))));
  const pt = (p: number, r: number): [number, number] => [60 + r * Math.cos(ang(p)), 62 - r * Math.sin(ang(p))];
  const arc = (p0: number, p1: number, r: number) => {
    const [x0, y0] = pt(p0, r);
    const [x1, y1] = pt(p1, r);
    return `M${x0.toFixed(1)},${y0.toFixed(1)} A${r},${r} 0 0 1 ${x1.toFixed(1)},${y1.toFixed(1)}`;
  };
  const color = value === null ? "var(--c-line-strong)" : ok ? "var(--c-good)" : "var(--c-again)";
  const [nx, ny] = pt(value ?? min, 36);
  const [tx0, ty0] = pt(target, 40);
  const [tx1, ty1] = pt(target, 56);
  return (
    <svg viewBox="0 0 120 72" className="gauge" aria-hidden="true">
      <path d={arc(min, 100, 48)} fill="none" style={{ stroke: "var(--c-line)" }} strokeWidth={14} strokeLinecap="round" />
      {value !== null && <path d={arc(min, Math.max(min + 0.5, value), 48)} fill="none" style={{ stroke: color }} strokeWidth={14} strokeLinecap="round" />}
      <line x1={tx0} y1={ty0} x2={tx1} y2={ty1} style={{ stroke: "var(--c-ink)" }} strokeWidth={3} strokeLinecap="round" />
      <line x1={60} y1={62} x2={nx} y2={ny} style={{ stroke: "var(--c-ink)" }} strokeWidth={4} strokeLinecap="round" />
      <circle cx={60} cy={62} r={7} style={{ fill: "var(--c-ink)" }} />
      <circle cx={60} cy={62} r={2.5} style={{ fill: "var(--c-surface)" }} />
    </svg>
  );
}

/** Stopwatch with a hand at `seconds` (one turn = 60 s). */
export function Stopwatch({ seconds }: { seconds: number | null }) {
  const a = (Math.min(60, seconds ?? 0) / 60) * 2 * Math.PI;
  const hx = 40 + 22 * Math.sin(a);
  const hy = 52 - 22 * Math.cos(a);
  return (
    <svg viewBox="0 0 80 90" className="stopwatch" aria-hidden="true">
      <rect x={33} y={2} width={14} height={9} rx={3} style={{ fill: "var(--c-faint)" }} />
      <rect x={58} y={12} width={9} height={7} rx={2} transform="rotate(40 62 15)" style={{ fill: "var(--c-line-strong)" }} />
      <circle cx={40} cy={52} r={34} style={{ fill: "var(--c-surface)", stroke: "var(--c-ink)" }} strokeWidth={5} />
      {Array.from({ length: 12 }, (_, k) => {
        const t = (k / 12) * 2 * Math.PI;
        return (
          <line
            key={k}
            x1={40 + 25 * Math.sin(t)}
            y1={52 - 25 * Math.cos(t)}
            x2={40 + 29 * Math.sin(t)}
            y2={52 - 29 * Math.cos(t)}
            style={{ stroke: "var(--c-line-strong)" }}
            strokeWidth={k % 3 ? 1.5 : 3}
            strokeLinecap="round"
          />
        );
      })}
      {seconds !== null && seconds > 0 && (
        <path d={`M40 52 L40 30 A22 22 0 ${a > Math.PI ? 1 : 0} 1 ${hx} ${hy} Z`} style={{ fill: "var(--c-easy)" }} opacity={0.18} />
      )}
      <line x1={40} y1={52} x2={hx} y2={hy} style={{ stroke: "var(--c-easy)" }} strokeWidth={4} strokeLinecap="round" />
      <circle cx={40} cy={52} r={4.5} style={{ fill: "var(--c-ink)" }} />
    </svg>
  );
}

/** A jar filled to `fraction` (0–1). */
export function Jar({ fraction }: { fraction: number }) {
  const lvl = 90 - Math.min(1, Math.max(0, fraction)) * 70;
  const body = "M14 22h52v62a10 10 0 0 1-10 10H24a10 10 0 0 1-10-10z";
  const wave = (y: number, a: number) => `M-40 ${y} q10 -${a} 20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 V100 H-40z`;
  return (
    <svg viewBox="0 0 80 100" className="jar" aria-hidden="true">
      <defs>
        <clipPath id="wg-jar">
          <path d={body} />
        </clipPath>
      </defs>
      <rect x={10} y={8} width={60} height={14} rx={5} style={{ fill: "#a08a6a" }} />
      <rect x={10} y={17} width={60} height={5} style={{ fill: "#7d6a4f" }} />
      <g clipPath="url(#wg-jar)">
        <rect x={0} y={0} width={80} height={100} style={{ fill: "var(--c-sunken)" }} />
        <path className="jar-wave" d={wave(lvl, 5)} style={{ fill: "var(--c-good)" }} />
        <path className="jar-wave jar-wave-2" d={wave(lvl + 3, 4)} style={{ fill: "color-mix(in srgb, var(--c-good) 70%, #000)" }} opacity={0.5} />
      </g>
      <path d={body} fill="none" style={{ stroke: "var(--c-line-strong)" }} strokeWidth={3} />
      <rect x={20} y={30} width={5} height={40} rx={2.5} fill="#fff" opacity={0.5} />
    </svg>
  );
}
