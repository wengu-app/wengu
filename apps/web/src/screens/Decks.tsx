import { useCallback, useEffect, useState } from "react";
import type { DeckNode, Id, Stats } from "@wengu/core";

import { navigate, routeHash, useApp } from "../lib/app.tsx";
import { useLang, useT, type Translate } from "../lib/i18n.ts";
import { formatNumber } from "../lib/format.ts";
import { updateSettings, useSettings } from "../lib/settings.ts";
import { deckColor } from "../lib/theme.ts";
import { Cuboids, Gauge, Jar, Stopwatch, type CuboidCol } from "../ui/Charts.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Menu } from "../ui/Menu.tsx";

/** Anki's "Default" deck is hidden while it is empty and has no subdecks. */
function visibleRoots(tree: DeckNode[]): DeckNode[] {
  return tree.filter((d) => !(d.id === 1 && d.totalItems === 0 && d.children.length === 0));
}

const dueOf = (d: DeckNode) => d.counts.new + d.counts.learning + d.counts.review;
const FORECAST_DAYS = 14;
/** Reference line on the retention gauge (FSRS's default desired retention). */
const TARGET = 90;

export function Decks() {
  const { db, version, changed, openExport } = useApp();
  const t = useT();
  const lang = useLang();
  const [tree, setTree] = useState<DeckNode[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [fronts, setFronts] = useState<Record<number, string>>({});
  const [dialog, setDialog] = useState<{ kind: "create" } | { kind: "rename"; deck: DeckNode } | null>(null);

  const load = useCallback(async () => {
    const [tr, st] = await Promise.all([db.deckTree(), db.stats({ days: FORECAST_DAYS }).catch(() => null)]);
    setTree(tr);
    setStats(st);
    // The card on top of each pack shows what that deck asks next.
    const out: Record<number, string> = {};
    await Promise.all(
      visibleRoots(tr).map(async (d) => {
        try {
          for (const state of ["due", "new"] as const) {
            const page = await db.search({ deckId: d.id, state, limit: 1 });
            if (page.rows[0]) {
              out[d.id] = page.rows[0].sortField;
              return;
            }
          }
          const any = await db.search({ deckId: d.id, limit: 1 });
          if (any.rows[0]) out[d.id] = any.rows[0].sortField;
        } catch {
          /* the pack just stays blank */
        }
      }),
    );
    setFronts(out);
  }, [db]);
  useEffect(() => {
    void load();
    // Counts change at the day rollover and when learning cards come due.
    const timer = setInterval(() => void load(), 60_000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [load, version]);

  const roots = tree ? visibleRoots(tree) : [];
  const due = roots.reduce((a, d) => a + dueOf(d), 0);

  // Space starts studying all decks, like the big button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== " " || e.ctrlKey || e.metaKey || e.altKey || due === 0) return;
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.tagName === "SELECT" || tgt.tagName === "BUTTON" || tgt.tagName === "A" || tgt.isContentEditable)) return;
      if (document.querySelector("dialog[open]")) return;
      e.preventDefault();
      navigate({ name: "review", deckId: null });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [due]);

  if (!tree) return <div className="page" aria-busy="true" />;
  const n = (v: number) => formatNumber(v, lang);
  const sum = roots.reduce((a, d) => ({ new: a.new + d.counts.new, learning: a.learning + d.counts.learning, review: a.review + d.counts.review }), { new: 0, learning: 0, review: 0 });
  const minutes = Math.max(1, Math.round((sum.new * 25 + sum.learning * 10 + sum.review * 9) / 60));
  const from = roots.filter((d) => dueOf(d) > 0).sort((a, b) => dueOf(b) - dueOf(a));
  const totalCards = roots.reduce((a, d) => a + d.totalItems, 0);

  return (
    <div className="page page-home">
      <div className="home-grid">
        <section className={`blk hero ${due ? "" : "is-clear"}`}>
          <div className="hero-main">
            <p className="kicker">{t(due ? "home.dueToday" : "home.todayDone")}</p>
            <p className="hero-num">
              <b>{n(due)}</b>
              <span>{due ? t("home.dueSub", { min: n(minutes) }) : t("home.doneSub")}</span>
            </p>
            <p className="hero-pills">
              <span className={`pill pill-new ${sum.new ? "" : "is-zero"}`}>
                {n(sum.new)} <em>{t("decks.new")}</em>
              </span>
              <span className={`pill pill-learn ${sum.learning ? "" : "is-zero"}`}>
                {n(sum.learning)} <em>{t("decks.learning")}</em>
              </span>
              <span className={`pill pill-review ${sum.review ? "" : "is-zero"}`}>
                {n(sum.review)} <em>{t("decks.review")}</em>
              </span>
            </p>
            <div className="hero-acts">
              <button type="button" className="btn btn-primary btn-lg" onClick={() => navigate({ name: "review", deckId: null })} disabled={due === 0}>
                {t("decks.studyAll")}
                <kbd>Space</kbd>
              </button>
            </div>
            {due > 0 && from.length > 1 && (
              <p className="hero-note">
                <Icon name="info" size={14} />
                {t("home.mixNote", { n: from.length })}
              </p>
            )}
          </div>
          {from.length > 0 && (
            <table className="mix">
              <thead>
                <tr>
                  <th>{t("home.from")}</th>
                  <th>{t("decks.new")}</th>
                  <th>{t("decks.learning")}</th>
                  <th>{t("decks.review")}</th>
                  <th>{t("home.total")}</th>
                </tr>
              </thead>
              <tbody>
                {from.map((d) => (
                  <tr key={d.id} onClick={() => navigate({ name: "review", deckId: d.id })}>
                    <td>
                      <i style={{ background: deckColor(d.name)[0] }} />
                      <a href={routeHash({ name: "review", deckId: d.id })} onClick={(e) => e.stopPropagation()}>
                        {d.shortName}
                      </a>
                    </td>
                    <td className={d.counts.new ? "" : "is-zero"}>{n(d.counts.new)}</td>
                    <td className={d.counts.learning ? "" : "is-zero"}>{n(d.counts.learning)}</td>
                    <td className={d.counts.review ? "" : "is-zero"}>{n(d.counts.review)}</td>
                    <td className="is-total">{n(dueOf(d))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5}>{t("home.fromHint")}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </section>

        <TodayBlock stats={stats} />

        <section className="blk packs-blk">
          <header className="blk-head">
            <h2>
              {t("decks.title")} <small>{t("home.decksSum", { n: n(roots.length), cards: n(totalCards) })}</small>
            </h2>
          </header>
          <div className="packs">
            {roots.map((d) => (
              <Pack key={d.id} deck={d} front={fronts[d.id] ?? ""} />
            ))}
            <button type="button" className="pack pack-new" onClick={() => setDialog({ kind: "create" })}>
              <span className="pack-new-in">
                <span className="pack-plus">
                  <Icon name="plus" size={24} />
                </span>
                {t("decks.create")}
              </span>
            </button>
          </div>
        </section>

        <section className="blk fc-blk">
          <header className="blk-head">
            <h2>
              {t("home.forecast")} <small>{t("home.forecastSub")}</small>
            </h2>
            <a className="blk-more" href={routeHash({ name: "stats" })}>
              {t("nav.stats")} <Icon name="chevronRight" size={14} />
            </a>
          </header>
          {stats && <Forecast stats={stats} counts={sum} t={t} lang={lang} />}
        </section>

        <MemoryBlock stats={stats} />

        <section className="blk tree-blk">
          <header className="blk-head">
            <h2>{t("home.allDecks")}</h2>
          </header>
          <div className="deck-table" role="table" aria-label={t("decks.title")}>
            <div className="deck-row deck-header" role="row">
              <span role="columnheader" className="deck-name-col">
                {t("decks.title")}
              </span>
              <span role="columnheader" className="num c-new">
                {t("decks.new")}
              </span>
              <span role="columnheader" className="num c-learn">
                {t("decks.learning")}
              </span>
              <span role="columnheader" className="num c-review">
                {t("decks.review")}
              </span>
              <span role="columnheader" className="deck-actions-col">
                <span className="sr-only">{t("common.more")}</span>
              </span>
            </div>
            {roots.length === 0 && <p className="empty-line">{t("decks.empty")}</p>}
            {roots.map((d) => (
              <DeckRows
                key={d.id}
                deck={d}
                depth={0}
                color={deckColor(d.name)[0]}
                onRename={(deck) => setDialog({ kind: "rename", deck })}
                onExport={(id) => openExport(id)}
              />
            ))}
          </div>
        </section>
      </div>

      <DeckNameDialog
        state={dialog}
        onClose={() => setDialog(null)}
        onSubmit={async (name) => {
          if (!dialog) return;
          if (dialog.kind === "create") await db.createDeck(name);
          else await db.renameDeck(dialog.deck.id, name);
          setDialog(null);
          await changed();
        }}
      />
    </div>
  );
}

/** A root deck as a card holder: a back panel, a pile of cards and a half-height front pocket. */
function Pack({ deck, front }: { deck: DeckNode; front: string }) {
  const t = useT();
  const lang = useLang();
  const [c, d] = deckColor(deck.name);
  const due = dueOf(deck);
  const layers = Math.max(2, Math.min(6, Math.round(Math.sqrt(deck.totalItems))));
  // Stable jitter per deck so the pile does not move between renders.
  let seed = deck.id % 2147483647 || 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pile = Array.from({ length: layers }, (_, k) => {
    const isTop = k === layers - 1;
    return { x: isTop ? 0 : (rnd() - 0.5) * 14, y: -(layers - 1 - k) * 5, r: isTop ? 0 : (rnd() - 0.5) * 7, isTop };
  });
  const n = (v: number) => formatNumber(v, lang);
  return (
    <a className="pack" href={routeHash({ name: "review", deckId: deck.id })} style={{ "--pc": c, "--pd": d } as React.CSSProperties} title={deck.name}>
      <span className="pack-back" />
      <span className="pack-pile">
        {pile.map((p, k) => (
          <span key={k} className="pack-card" style={{ transform: `translate(${p.x.toFixed(1)}px, ${p.y}px) rotate(${p.r.toFixed(1)}deg)` }}>
            {p.isTop && front && <span className="pack-q">{front}</span>}
          </span>
        ))}
      </span>
      {due > 0 ? (
        <span className="pack-due" title={t("home.dueToday")}>
          {n(due)}
        </span>
      ) : (
        deck.totalItems > 0 && (
          <span className="pack-stamp">
            <Icon name="check" size={12} />
            {t("home.packDone")}
          </span>
        )
      )}
      <span className="pack-front">
        <span className="pack-hd">
          <span className="pack-emb">{[...deck.shortName][0]?.toUpperCase()}</span>
          <span className="pack-title">
            <span className="pack-name">{deck.shortName}</span>
            <span className="pack-meta">{t("decks.cards", { n: n(deck.totalItems) })}</span>
          </span>
        </span>
        <span className="pack-label">
          {due > 0 ? (
            <span className="pack-counts">
              <span className={`pill pill-new ${deck.counts.new ? "" : "is-zero"}`}>{n(deck.counts.new)}</span>
              <span className={`pill pill-learn ${deck.counts.learning ? "" : "is-zero"}`}>{n(deck.counts.learning)}</span>
              <span className={`pill pill-review ${deck.counts.review ? "" : "is-zero"}`}>{n(deck.counts.review)}</span>
            </span>
          ) : (
            <span className="pack-idle">{t(deck.totalItems ? "home.nothingDue" : "home.packEmpty")}</span>
          )}
          {deck.children.length > 0 && <span className="pack-sub">{t("home.subdecks", { n: n(deck.children.length) })}</span>}
        </span>
      </span>
    </a>
  );
}

function TodayBlock({ stats }: { stats: Stats | null }) {
  const t = useT();
  const lang = useLang();
  const n = (v: number) => formatNumber(v, lang);
  const today = stats?.today;
  const answers = today ? today.byRating.reduce((a, b) => a + b, 0) : 0;
  const mins = today ? Math.round(today.timeMs / 60000) : 0;
  const names = ["review.again", "review.hard", "review.good", "review.easy"] as const;
  const cls = ["again", "hard", "good", "easy"];
  return (
    <section className="blk today-blk">
      <header className="blk-head">
        <h2>{t("home.today")}</h2>
      </header>
      <div className="big3">
        <div>
          <b>
            {n(today?.reviews ?? 0)}
            <small>{t("home.unitCards")}</small>
          </b>
          <span>{t("home.reviewed")}</span>
        </div>
        <div>
          <b>
            {n(today?.newItems ?? 0)}
            <small>{t("home.unitCards")}</small>
          </b>
          <span>{t("home.newLearned")}</span>
        </div>
        <div>
          <b>
            {n(mins)}
            <small>{t("home.unitMin")}</small>
          </b>
          <span>{t("home.time")}</span>
        </div>
      </div>
      {answers > 0 && today ? (
        <div className="answers-keys">
          <div className="keyrow" aria-hidden="true">
            {today.byRating.map((v, i) =>
              Array.from({ length: Math.min(v, 60) }, (_, k) => <i key={`${i}-${k}`} className={`key key-${cls[i]}`} />),
            )}
          </div>
          <ul className="legend">
            {today.byRating.map((v, i) => (
              <li key={i}>
                <span className={`swatch seg-${cls[i]}`} />
                {t(names[i]!)} <span className="muted">{n(v)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="muted small today-empty">{t("home.noReviewsToday")}</p>
      )}
    </section>
  );
}

function Forecast({ stats, counts, t, lang }: { stats: Stats; counts: { new: number; learning: number; review: number }; t: Translate; lang: string }) {
  const wd = new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en", { weekday: "short" });
  const md = new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en", { month: "numeric", day: "numeric" });
  const cols: CuboidCol[] = Array.from({ length: FORECAST_DAYS }, (_, i) => {
    const date = new Date(Date.now() + i * 86_400_000);
    if (i === 0)
      return {
        label: t("stats.todayLabel"),
        sub: md.format(date),
        segs: [
          { n: counts.review, color: "var(--c-review)" },
          { n: counts.learning, color: "var(--c-learn)" },
          { n: counts.new, color: "var(--c-newc)" },
        ],
      };
    return { label: i === 1 ? t("home.tomorrow") : wd.format(date), sub: md.format(date), faded: true, segs: [{ n: stats.upcoming[i] ?? 0, color: "var(--c-review)" }] };
  });
  return (
    <>
      <Cuboids cols={cols} ariaLabel={t("home.forecast")} />
      <div className="cb-legend">
        <span>
          <i className="seg-new" />
          {t("decks.new")}
        </span>
        <span>
          <i className="seg-learn" />
          {t("decks.learning")}
        </span>
        <span>
          <i className="seg-review" />
          {t("decks.review")}
        </span>
      </div>
    </>
  );
}

function MemoryBlock({ stats }: { stats: Stats | null }) {
  const t = useT();
  const lang = useLang();
  const n = (v: number) => formatNumber(v, lang);
  const r30 = stats?.retention.last30Days.rate ?? null;
  const r7 = stats?.retention.last7Days.rate ?? null;
  const pct30 = r30 === null ? null : Math.round(r30 * 1000) / 10;
  const ok = pct30 !== null && pct30 >= TARGET - 2;
  const totals = stats?.totals;
  const all = totals ? totals.new + totals.learning + totals.review : 0;
  const learned = totals ? totals.learning + totals.review : 0;
  const frac = all ? learned / all : 0;
  const perCard = stats && stats.today.reviews ? stats.today.timeMs / stats.today.reviews / 1000 : null;
  const pin = (r: number | null) => (r === null ? 0 : Math.min(100, Math.max(0, ((r * 100 - 70) / 30) * 100)));
  return (
    <section className="blk mem-blk">
      <header className="blk-head">
        <h2>{t("home.memory")}</h2>
      </header>
      <div className="mem-grid">
        <div className="m m-gauge">
          <span className="m-l">{t("home.retention30")}</span>
          <Gauge value={pct30} target={TARGET} ok={ok} />
          <span className="m-v m-c">
            {pct30 === null ? "—" : n(Math.round(pct30))}
            <small>%</small>
          </span>
          <span className="m-d m-c">
            {pct30 === null ? t("stats.noData") : t(ok ? "home.onTarget" : "home.belowTarget", { goal: TARGET })}
          </span>
        </div>
        <div className="m m-row">
          <Jar fraction={frac} />
          <div>
            <span className="m-l">{t("home.learned")}</span>
            <span className="m-v">{n(learned)}</span>
            <span className="m-d">{t("home.learnedSub", { pct: Math.round(frac * 100) })}</span>
          </div>
        </div>
        <div className="m">
          <span className="m-l">{t("home.week")}</span>
          <span className="m-v">
            {r7 === null ? "—" : n(Math.round(r7 * 100))}
            <small>%</small>
          </span>
          <div className="ruler">
            <div className="ruler-bar">
              <i style={{ width: `${pin(r7)}%` }} />
            </div>
            {[70, 80, 90, 100].map((v) => (
              <span key={v} className="ruler-tick" style={{ left: `${((v - 70) / 30) * 100}%` }}>
                {v}%
              </span>
            ))}
            {r7 !== null && <span className="ruler-pin" style={{ left: `${pin(r7)}%` }} />}
          </div>
          <span className="m-d">{t("home.weekSub")}</span>
        </div>
        <div className="m m-row">
          <Stopwatch seconds={perCard} />
          <div>
            <span className="m-l">{t("home.perCard")}</span>
            <span className="m-v">
              {perCard === null ? "—" : perCard.toFixed(1)}
              <small>{t("home.unitSec")}</small>
            </span>
            <span className="m-d">{t("home.perCardSub")}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function DeckRows(props: { deck: DeckNode; depth: number; color: string; onRename(d: DeckNode): void; onExport(id: Id): void }) {
  const { deck, depth } = props;
  const t = useT();
  const lang = useLang();
  const settings = useSettings();
  const key = String(deck.id);
  const collapsed = settings.collapsedDecks[key] ?? deck.collapsed;
  const hasKids = deck.children.length > 0;
  const n = (v: number) => (
    <span className={v === 0 ? "zero" : undefined} aria-label={formatNumber(v, lang)}>
      {formatNumber(v, lang)}
    </span>
  );
  const due = deck.counts.new + deck.counts.learning + deck.counts.review;
  return (
    <>
      <div className={`deck-row ${due === 0 ? "deck-idle" : ""}`} role="row" data-testid="deck-row" data-deck={deck.name}>
        <span role="cell" className="deck-name-col" style={{ paddingInlineStart: depth * 22 }}>
          {hasKids ? (
            <button
              type="button"
              className="icon-btn icon-btn-sm twisty"
              aria-expanded={!collapsed}
              aria-label={t(collapsed ? "decks.expand" : "decks.collapse", { name: deck.shortName })}
              onClick={() => updateSettings((s) => ({ collapsedDecks: { ...s.collapsedDecks, [key]: !collapsed } }))}
            >
              <Icon name={collapsed ? "chevronRight" : "chevronDown"} size={16} />
            </button>
          ) : (
            <span className="twisty-space" />
          )}
          {depth === 0 && <i className="deck-dot" style={{ background: props.color }} aria-hidden="true" />}
          <a className="deck-link" href={routeHash({ name: "review", deckId: deck.id })} title={deck.name}>
            {deck.shortName}
            {deck.kind === "filtered" && <span className="pill">{t("decks.filtered")}</span>}
          </a>
          <span className="deck-total">{t("decks.cards", { n: formatNumber(deck.totalItems, lang) })}</span>
        </span>
        <span role="cell" className="num c-new">
          {n(deck.counts.new)}
        </span>
        <span role="cell" className="num c-learn">
          {n(deck.counts.learning)}
        </span>
        <span role="cell" className="num c-review">
          {n(deck.counts.review)}
        </span>
        <span role="cell" className="deck-actions-col">
          <Menu
            label={t("decks.actions", { name: deck.shortName })}
            trigger={<Icon name="more" />}
            items={[
              { label: t("decks.study"), onSelect: () => navigate({ name: "review", deckId: deck.id }) },
              { label: t("decks.browse"), onSelect: () => navigate({ name: "browse", deckId: deck.id, noteId: null }) },
              { label: t("common.rename"), onSelect: () => props.onRename(deck) },
              { label: t("decks.export"), onSelect: () => props.onExport(deck.id) },
            ]}
          />
        </span>
      </div>
      {hasKids && !collapsed && deck.children.map((c) => <DeckRows key={c.id} {...props} deck={c} depth={depth + 1} />)}
    </>
  );
}

function DeckNameDialog(props: {
  state: { kind: "create" } | { kind: "rename"; deck: DeckNode } | null;
  onClose(): void;
  onSubmit(name: string): Promise<void>;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { state } = props;
  useEffect(() => {
    setName(state?.kind === "rename" ? state.deck.name : "");
    setError(null);
  }, [state]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = name.trim();
    if (!v) return;
    setBusy(true);
    try {
      await props.onSubmit(v);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!state} title={t(state?.kind === "rename" ? "decks.renameTitle" : "decks.createTitle")} onClose={props.onClose} width="sm">
      <form onSubmit={submit} className="form">
        <label className="field">
          <span className="field-label">{t("decks.nameLabel")}</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
          <span className="field-hint">{t("decks.nameHint")}</span>
        </label>
        {error && <p className="error-text">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={props.onClose}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
            {t(state?.kind === "rename" ? "common.rename" : "common.create")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
