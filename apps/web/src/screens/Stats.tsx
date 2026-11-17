import { useEffect, useState } from "react";
import type { DeckNode, Id, RetentionSample, Stats as StatsData } from "@wengu/core";

import { useApp } from "../lib/app.tsx";
import { formatDuration, formatNumber, formatPercent } from "../lib/format.ts";
import { useLang, useT, type MessageKey } from "../lib/i18n.ts";
import { flattenDecks } from "./Editor.tsx";

const DAYS = 30;

function Upcoming({ data, overdue }: { data: number[]; overdue: number }) {
  const t = useT();
  const lang = useLang();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data);
  const W = 600;
  const H = 160;
  const padB = 20;
  const gap = 2;
  const bw = W / data.length - gap;
  const ticks = [0, 7, 14, 21, 28].filter((d) => d < data.length);
  return (
    <figure className="chart">
      <div className="chart-plot" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("stats.upcoming")} preserveAspectRatio="none">
          <line x1={0} x2={W} y1={H - padB} y2={H - padB} className="chart-base" />
          {data.map((v, i) => {
            const h = (v / max) * (H - padB - 8);
            const x = i * (bw + gap);
            return (
              <g key={i} onMouseEnter={() => setHover(i)}>
                <rect x={x} y={0} width={bw + gap} height={H - padB} fill="transparent" />
                {v > 0 && <rect x={x} y={H - padB - h} width={bw} height={h} rx={Math.min(3, bw / 2)} className={`chart-bar ${hover === i ? "is-hover" : ""}`} />}
              </g>
            );
          })}
        </svg>
        <div className="chart-ticks" aria-hidden="true">
          {ticks.map((d) => (
            <span key={d} style={{ left: `${((d + 0.5) / data.length) * 100}%` }}>
              {d === 0 ? t("stats.todayLabel") : `+${d}`}
            </span>
          ))}
        </div>
        {hover !== null && (
          <div className="chart-tip" style={{ left: `${((hover + 0.5) / data.length) * 100}%` }} role="status">
            <strong>{hover === 0 ? t("stats.todayLabel") : t("stats.dayN", { n: hover })}</strong>
            <span>{t("stats.perDay", { n: formatNumber(data[hover] ?? 0, lang) })}</span>
          </div>
        )}
      </div>
      <figcaption className="muted small">
        {t("stats.upcomingHelp")} {overdue > 0 ? t("stats.overdue", { n: formatNumber(overdue, lang) }) : ""}
      </figcaption>
      <table className="sr-only">
        <tbody>
          {data.map((v, i) => (
            <tr key={i}>
              <th>{i === 0 ? t("stats.todayLabel") : t("stats.dayN", { n: i })}</th>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function Retention({ label, s }: { label: MessageKey; s: RetentionSample }) {
  const t = useT();
  const lang = useLang();
  const n = s.passed + s.failed;
  return (
    <div className="tile">
      <span className="tile-label">{t(label)}</span>
      <span className="tile-value">{formatPercent(s.rate, lang, 1)}</span>
      <span className="tile-sub">{n ? `${formatNumber(s.passed, lang)} / ${formatNumber(n, lang)}` : t("stats.noData")}</span>
    </div>
  );
}

export function Stats() {
  const { db, version } = useApp();
  const t = useT();
  const lang = useLang();
  const [decks, setDecks] = useState<DeckNode[]>([]);
  const [deckId, setDeckId] = useState<Id | null>(null);
  const [stats, setStats] = useState<StatsData | null>(null);

  useEffect(() => {
    void db.deckTree().then((tree) => setDecks(flattenDecks(tree)));
  }, [db, version]);
  useEffect(() => {
    void db.stats(deckId !== null ? { deckId, days: DAYS } : { days: DAYS }).then(setStats);
  }, [db, deckId, version]);

  const n = (v: number) => formatNumber(v, lang);
  const ratings: { key: MessageKey; cls: string }[] = [
    { key: "review.again", cls: "again" },
    { key: "review.hard", cls: "hard" },
    { key: "review.good", cls: "good" },
    { key: "review.easy", cls: "easy" },
  ];
  const answers = stats ? stats.today.byRating.reduce((a, b) => a + b, 0) : 0;
  const sum = (from: number, to: number) => (stats ? stats.upcoming.slice(from, to).reduce((a, b) => a + b, 0) : 0);

  return (
    <div className="page page-stats" data-testid="stats">
      <header className="page-head">
        <div>
          <h1 className="page-title">{t("stats.title")}</h1>
        </div>
        <div className="page-actions">
          <select className="select" value={deckId ?? ""} onChange={(e) => setDeckId(e.target.value ? Number(e.target.value) : null)} aria-label={t("stats.scope")}>
            <option value="">{t("browse.anyDeck")}</option>
            {decks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name.replace(/::/g, " / ")}
              </option>
            ))}
          </select>
        </div>
      </header>
      {stats && (
        <>
          <section className="stats-section">
            <h2 className="section-title">{t("stats.today")}</h2>
            <div className="tiles">
              <div className="tile">
                <span className="tile-label">{t("stats.reviews")}</span>
                <span className="tile-value" data-testid="stats-today-reviews">
                  {n(stats.today.reviews)}
                </span>
              </div>
              <div className="tile">
                <span className="tile-label">{t("stats.newCards")}</span>
                <span className="tile-value">{n(stats.today.newItems)}</span>
              </div>
              <div className="tile">
                <span className="tile-label">{t("stats.time")}</span>
                <span className="tile-value">{formatDuration(stats.today.timeMs, t)}</span>
              </div>
            </div>
            {answers > 0 && (
              <div className="answers">
                <span className="tile-label">{t("stats.answers")}</span>
                <div className="answer-bar" aria-hidden="true">
                  {stats.today.byRating.map((v, i) => (v ? <span key={i} className={`seg seg-${ratings[i]!.cls}`} style={{ flexGrow: v }} /> : null))}
                </div>
                <ul className="legend">
                  {stats.today.byRating.map((v, i) => (
                    <li key={i}>
                      <span className={`swatch seg-${ratings[i]!.cls}`} />
                      {t(ratings[i]!.key)} <span className="muted">{n(v)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
          <section className="stats-section">
            <h2 className="section-title">{t("stats.retention")}</h2>
            <p className="muted small">{t("stats.retentionHelp")}</p>
            <div className="tiles">
              <Retention label="stats.last7" s={stats.retention.last7Days} />
              <Retention label="stats.last30" s={stats.retention.last30Days} />
              <Retention label="stats.mature" s={stats.retention.mature30Days} />
            </div>
          </section>
          <section className="stats-section">
            <h2 className="section-title">{t("stats.upcoming")}</h2>
            <div className="tiles tiles-inline">
              <div className="tile">
                <span className="tile-label">{t("stats.next7")}</span>
                <span className="tile-value">{n(sum(0, 7))}</span>
              </div>
              <div className="tile">
                <span className="tile-label">{t("stats.next30")}</span>
                <span className="tile-value">{n(sum(0, 30))}</span>
              </div>
            </div>
            <Upcoming data={stats.upcoming.slice(0, DAYS)} overdue={stats.overdue} />
          </section>
          <section className="stats-section">
            <h2 className="section-title">{t("stats.collection")}</h2>
            <dl className="summary-list summary-cols">
              <div>
                <dt>{t("stats.notes")}</dt>
                <dd>{n(stats.totals.knowledgePoints)}</dd>
              </div>
              <div>
                <dt className="c-new">{t("decks.new")}</dt>
                <dd>{n(stats.totals.new)}</dd>
              </div>
              <div>
                <dt className="c-learn">{t("decks.learning")}</dt>
                <dd>{n(stats.totals.learning)}</dd>
              </div>
              <div>
                <dt className="c-review">{t("decks.review")}</dt>
                <dd>{n(stats.totals.review)}</dd>
              </div>
              <div>
                <dt>{t("stats.suspended")}</dt>
                <dd>{n(stats.totals.suspended)}</dd>
              </div>
              <div>
                <dt>{t("stats.buried")}</dt>
                <dd>{n(stats.totals.buried)}</dd>
              </div>
            </dl>
          </section>
        </>
      )}
    </div>
  );
}
