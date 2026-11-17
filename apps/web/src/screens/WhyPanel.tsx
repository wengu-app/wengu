import type { RatingName, ReviewCard, ScheduleExplanation } from "@wengu/core";

import { formatDate, formatDays, formatPercent } from "../lib/format.ts";
import { useLang, useT, type MessageKey } from "../lib/i18n.ts";
import { Icon } from "../ui/Icon.tsx";

const NAMES: RatingName[] = ["again", "hard", "good", "easy"];

/** FSRS forgetting curve R(t) for stability S (FSRS-6: decay is the last parameter; earlier versions use 0.5). */
export function retrievability(days: number, stability: number, params: readonly number[]): number {
  const decay = params.length >= 21 ? params[20]! : 0.5;
  const factor = Math.pow(0.9, -1 / decay) - 1;
  return Math.pow(1 + (factor * days) / Math.max(stability, 1e-6), -decay);
}

function daysOf(e: ScheduleExplanation, name: RatingName): number {
  const o = e.outcomes[name];
  return o.interval.unit === "days" ? o.interval.value : o.interval.value / 86400;
}

/**
 * After each answer the memory has a new stability, so recall decays along a different curve; the next review is
 * where that curve meets the target retention. Drawing the four curves shows why a better answer means a longer gap.
 */
function Curves({ e }: { e: ScheduleExplanation }) {
  const t = useT();
  const W = 300;
  const H = 120;
  const pad = { l: 30, r: 8, t: 8, b: 18 };
  const maxDays = Math.max(1, ...NAMES.map((n) => daysOf(e, n))) * 1.15;
  // Square-root time axis: short learning steps and long review gaps both stay visible.
  const x = (d: number) => pad.l + (Math.sqrt(d) / Math.sqrt(maxDays)) * (W - pad.l - pad.r);
  const yMin = Math.min(0.7, e.desiredRetention - 0.1);
  const y = (r: number) => pad.t + ((1 - r) / (1 - yMin)) * (H - pad.t - pad.b);
  const ty = y(e.desiredRetention);
  return (
    <svg className="why-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("why.outcomes")}>
      <line x1={pad.l} x2={W - pad.r} y1={ty} y2={ty} className="why-target" />
      <text x={pad.l - 4} y={ty + 3} textAnchor="end" className="why-axis">
        {Math.round(e.desiredRetention * 100)}%
      </text>
      <text x={pad.l - 4} y={y(1) + 4} textAnchor="end" className="why-axis">
        100%
      </text>
      <line x1={pad.l} x2={pad.l} y1={pad.t} y2={H - pad.b} className="why-axisline" />
      {NAMES.map((name) => {
        const o = e.outcomes[name];
        const S = o.memory.stability;
        const end = daysOf(e, name);
        const pts: string[] = [];
        const steps = 40;
        for (let i = 0; i <= steps; i++) {
          const d = (maxDays * i * i) / (steps * steps);
          const r = retrievability(d, S, e.fsrsParams);
          if (r < yMin) break;
          pts.push(`${x(d).toFixed(1)},${y(r).toFixed(1)}`);
        }
        const rEnd = retrievability(end, S, e.fsrsParams);
        return (
          <g key={name} className={`why-curve why-${name}`}>
            <polyline points={pts.join(" ")} fill="none" />
            {rEnd >= yMin && <circle cx={x(end)} cy={y(rEnd)} r={3.5} />}
          </g>
        );
      })}
      <text x={W - pad.r} y={H - 4} textAnchor="end" className="why-axis">
        {formatDays(maxDays, "en").replace(" ", "")}
      </text>
      <text x={pad.l} y={H - 4} className="why-axis">
        0
      </text>
    </svg>
  );
}

export function WhyPanel({ card, onClose }: { card: ReviewCard; onClose(): void }) {
  const t = useT();
  const lang = useLang();
  const e = card.schedule;
  return (
    <aside className="why" aria-labelledby="why-title" data-testid="why-panel">
      <header className="why-head">
        <h2 id="why-title">{t("why.title")}</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label={t("common.close")}>
          <Icon name="close" />
        </button>
      </header>
      <section className="why-section">
        <h3>{t("why.memory")}</h3>
        {e.memory ? (
          <dl className="why-stats">
            <div>
              <dt>{t("why.retrievability")}</dt>
              <dd className="why-big" data-testid="why-r">
                {formatPercent(e.retrievability, lang)}
              </dd>
            </div>
            <div>
              <dt title={t("why.stabilityHelp")}>{t("why.stability")}</dt>
              <dd>{formatDays(e.memory.stability, lang)}</dd>
            </div>
            <div>
              <dt title={t("why.difficultyHelp")}>{t("why.difficulty")}</dt>
              <dd>{e.memory.difficulty.toFixed(1)} / 10</dd>
            </div>
            <div>
              <dt>{t("why.elapsed")}</dt>
              <dd>{e.elapsedDays === 0 ? t("why.today") : t("why.elapsedDays", { n: e.elapsedDays })}</dd>
            </div>
          </dl>
        ) : (
          <p className="muted small">{t("why.new")}</p>
        )}
      </section>
      <section className="why-section">
        <h3>{t("why.outcomes")}</h3>
        <Curves e={e} />
        <table className="why-table">
          <thead>
            <tr>
              <th />
              <th>{t("why.next")}</th>
              <th>{t("why.after")}</th>
            </tr>
          </thead>
          <tbody>
            {NAMES.map((name) => {
              const o = e.outcomes[name];
              return (
                <tr key={name}>
                  <th className={`why-name why-${name}`}>
                    <span className="why-swatch" aria-hidden="true" />
                    {t(`review.${name}` as MessageKey)}
                  </th>
                  <td>
                    <span className="strong">{o.label}</span> <span className="muted small">{formatDate(o.dueAt, lang)}</span>
                  </td>
                  <td>{formatDays(o.memory.stability, lang)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="muted small why-explain">{t("why.summary", { target: formatPercent(e.desiredRetention, lang) })}</p>
        <p className="muted small">
          {t("why.target")}: {formatPercent(e.desiredRetention, lang)} · {t("why.preset", { name: e.presetName })}
        </p>
      </section>
    </aside>
  );
}
