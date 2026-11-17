import { useCallback, useEffect, useState } from "react";
import type { DeckNode, Id } from "@wengu/core";

import { navigate, routeHash, useApp } from "../lib/app.tsx";
import { useLang, useT } from "../lib/i18n.ts";
import { formatNumber } from "../lib/format.ts";
import { updateSettings, useSettings } from "../lib/settings.ts";
import { Dialog } from "../ui/Dialog.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Menu } from "../ui/Menu.tsx";

/** Anki's "Default" deck is hidden while it is empty and has no subdecks. */
function visibleRoots(tree: DeckNode[]): DeckNode[] {
  return tree.filter((d) => !(d.id === 1 && d.totalItems === 0 && d.children.length === 0));
}

export function Decks() {
  const { db, version, changed, openExport } = useApp();
  const t = useT();
  const lang = useLang();
  const [tree, setTree] = useState<DeckNode[] | null>(null);
  const [dialog, setDialog] = useState<{ kind: "create" } | { kind: "rename"; deck: DeckNode } | null>(null);

  const load = useCallback(async () => setTree(await db.deckTree()), [db]);
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

  if (!tree) return <div className="page" aria-busy="true" />;
  const roots = visibleRoots(tree);
  const due = roots.reduce((a, d) => a + d.counts.new + d.counts.learning + d.counts.review, 0);

  return (
    <div className="page page-decks">
      <header className="page-head">
        <div>
          <h1 className="page-title">{t("decks.title")}</h1>
          <p className="page-sub">{due > 0 ? t("decks.dueSummary", { n: formatNumber(due, lang) }) : t("decks.nothingDue")}</p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-ghost" onClick={() => setDialog({ kind: "create" })}>
            <Icon name="plus" /> {t("decks.create")}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => navigate({ name: "review", deckId: null })} disabled={due === 0}>
            {t("decks.studyAll")}
          </button>
        </div>
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
            onRename={(deck) => setDialog({ kind: "rename", deck })}
            onExport={(id) => openExport(id)}
          />
        ))}
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

function DeckRows(props: { deck: DeckNode; depth: number; onRename(d: DeckNode): void; onExport(id: Id): void }) {
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
