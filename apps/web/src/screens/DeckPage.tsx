/**
 * One deck: its pack at the top left, what is due and the ways to work with it on the right, and below that its
 * subdecks and its notes. Opened from any deck on the home page; studying starts from here.
 */
import { useCallback, useEffect, useState } from "react";
import type { BrowseRow, DeckNode, Id } from "@wengu/core";

import { navigate, routeHash, useApp } from "../lib/app.tsx";
import { formatNumber } from "../lib/format.ts";
import { useLang, useT, type MessageKey } from "../lib/i18n.ts";
import { deckColor } from "../lib/theme.ts";
import { Icon } from "../ui/Icon.tsx";
import { PageHead } from "../ui/PageHead.tsx";
import { deckFront, dueOf, Pack } from "./Decks.tsx";

/** How many notes the page lists before handing over to Browse. */
const SHOWN = 100;

function findDeck(tree: DeckNode[], id: Id): DeckNode | null {
  for (const d of tree) {
    if (d.id === id) return d;
    const hit = findDeck(d.children, id);
    if (hit) return hit;
  }
  return null;
}

export function DeckPage({ deckId }: { deckId: Id }) {
  const { db, version, openExport } = useApp();
  const t = useT();
  const lang = useLang();
  const n = (v: number) => formatNumber(v, lang);
  const [deck, setDeck] = useState<DeckNode | null | undefined>(undefined);
  const [front, setFront] = useState("");
  const [notes, setNotes] = useState<{ total: number; rows: BrowseRow[] } | null>(null);

  const load = useCallback(async () => {
    const tree = await db.deckTree();
    const d = findDeck(tree, deckId);
    setDeck(d);
    if (!d) return;
    const [f, page] = await Promise.all([deckFront(db, deckId), db.search({ deckId, limit: SHOWN }).catch(() => null)]);
    setFront(f);
    setNotes(page ? { total: page.total, rows: page.rows } : { total: 0, rows: [] });
  }, [db, deckId]);
  useEffect(() => {
    void load();
    // Counts change at the day rollover and when learning cards come due, as on the home page.
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load, version]);

  const due = deck ? dueOf(deck) : 0;

  // Space studies this deck, like the home page's Space for all decks.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== " " || e.ctrlKey || e.metaKey || e.altKey || due === 0) return;
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.tagName === "BUTTON" || tgt.tagName === "A" || tgt.isContentEditable)) return;
      if (document.querySelector("dialog[open], .select-pop")) return;
      e.preventDefault();
      navigate({ name: "review", deckId });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [due, deckId]);

  if (deck === undefined) return <div className="page" aria-busy="true" />;
  if (deck === null)
    return (
      <div className="page page-deck">
        <PageHead title={t("decks.title")} />
        <p className="empty-line">{t("deck.notFound")}</p>
      </div>
    );

  const parents = deck.name.split("::").slice(0, -1);
  const minutes = Math.max(1, Math.round((deck.counts.new * 25 + deck.counts.learning * 10 + deck.counts.review * 9) / 60));

  return (
    <div className="page page-deck" data-testid="deck-page">
      <PageHead
        title={deck.shortName}
        sub={[
          ...(parents.length ? [parents.join(" / ")] : []),
          t("decks.cards", { n: n(deck.totalItems) }),
          ...(deck.children.length ? [t("home.subdecks", { n: n(deck.children.length) })] : []),
        ].join(" · ")}
      />

      <div className="deck-top">
        <div className="deck-obj">
          <Pack deck={deck} front={front} still />
        </div>
        <section className={`blk deck-info ${due ? "" : "is-clear"}`}>
          <p className="kicker">{t(due ? "home.dueToday" : "home.todayDone")}</p>
          <p className="hero-num">
            <b>{n(due)}</b>
            <span>{due ? t("home.dueSub", { min: n(minutes) }) : t("home.doneSub")}</span>
          </p>
          <div className="hero-pills">
            <span className={`pill pill-new ${deck.counts.new ? "" : "is-zero"}`}>
              {n(deck.counts.new)} <em>{t("decks.new")}</em>
            </span>
            <span className={`pill pill-learn ${deck.counts.learning ? "" : "is-zero"}`}>
              {n(deck.counts.learning)} <em>{t("decks.learning")}</em>
            </span>
            <span className={`pill pill-review ${deck.counts.review ? "" : "is-zero"}`}>
              {n(deck.counts.review)} <em>{t("decks.review")}</em>
            </span>
          </div>
          <div className="deck-acts">
            <button type="button" className="btn btn-primary" onClick={() => navigate({ name: "review", deckId })} disabled={due === 0} data-testid="deck-study">
              {t("deck.study")}
              <kbd>Space</kbd>
            </button>
            {deck.kind === "normal" && (
              <a className="btn btn-ghost" href={routeHash({ name: "make", deckId })}>
                <Icon name="plus" />
                {t("deck.make")}
              </a>
            )}
            <button type="button" className="btn btn-ghost" onClick={() => openExport(deckId)}>
              <Icon name="export" />
              {t("nav.export")}
            </button>
          </div>
        </section>
      </div>

      {deck.children.length > 0 && (
        <section className="blk deck-sub">
          <header className="blk-head">
            <h2>
              {t("deck.subdecks")} <small>{n(deck.children.length)}</small>
            </h2>
          </header>
          <ul className="deck-subs">
            {deck.children.map((c) => (
              <li key={c.id}>
                <a className="deck-subrow" href={routeHash({ name: "deck", deckId: c.id })}>
                  <i style={{ background: deckColor(c.name)[0] }} />
                  <span className="deck-subname">{c.shortName}</span>
                  <span className="deck-subcards">{t("decks.cards", { n: n(c.totalItems) })}</span>
                  <span className={`pill pill-new ${c.counts.new ? "" : "is-zero"}`}>{n(c.counts.new)}</span>
                  <span className={`pill pill-learn ${c.counts.learning ? "" : "is-zero"}`}>{n(c.counts.learning)}</span>
                  <span className={`pill pill-review ${c.counts.review ? "" : "is-zero"}`}>{n(c.counts.review)}</span>
                  <Icon name="chevronRight" size={16} />
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="blk deck-notes">
        <header className="blk-head">
          <h2>
            {t("deck.notes")} {notes && <small>{n(notes.total)}</small>}
          </h2>
          <a className="blk-more" href={routeHash({ name: "browse", deckId, noteId: null })}>
            {t("decks.browse")} <Icon name="chevronRight" size={14} />
          </a>
        </header>
        {notes && notes.rows.length === 0 && <p className="empty-line">{t("deck.noNotes")}</p>}
        {notes && notes.rows.length > 0 && (
          <ul className="deck-list" data-testid="deck-notes">
            {notes.rows.map((r) => (
              <li key={r.id}>
                <a className={`brow deck-row ${r.suspended ? "is-suspended" : ""}`} href={routeHash({ name: "browse", deckId, noteId: r.id })}>
                  <span className="brow-main">{r.sortField || "—"}</span>
                  <span className="brow-sub">
                    <span className="brow-nt">{r.noteTypeName}</span>
                    {r.tags.slice(0, 3).map((tg) => (
                      <span key={tg} className="brow-tag">
                        #{tg}
                      </span>
                    ))}
                  </span>
                  <span className="brow-states">
                    {r.suspended && <span className="badge badge-muted">{t("status.suspended")}</span>}
                    {r.states.map((s) => (
                      <span key={s} className={`state-dot state-${s}`} title={t(`state.${s}` as MessageKey)} />
                    ))}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
        {notes && notes.total > notes.rows.length && (
          <a className="deck-all" href={routeHash({ name: "browse", deckId, noteId: null })}>
            {t("deck.showAll", { n: n(notes.total) })}
          </a>
        )}
      </section>
    </div>
  );
}
