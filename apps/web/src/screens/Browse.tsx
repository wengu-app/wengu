import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BrowseQuery, BrowseRow, DeckNode, Id, ItemFilter } from "@wengu/core";

import { navigate, useApp } from "../lib/app.tsx";
import { formatNumber } from "../lib/format.ts";
import { useLang, useT, type MessageKey } from "../lib/i18n.ts";
import { Icon } from "../ui/Icon.tsx";
import { VirtualList, type VirtualListHandle } from "../ui/VirtualList.tsx";
import { AddNoteDialog, flattenDecks, NoteEditor } from "./Editor.tsx";

const PAGE = 200;
const ROW_H = 56;
const STATES: ItemFilter[] = ["new", "learning", "review", "due", "suspended", "buried", "flagged"];

interface Filters {
  text: string;
  deckId: Id | null;
  tag: string;
  state: ItemFilter | "";
  noteTypeId: Id | null;
  sort: "created" | "modified" | "sortField";
}

export function Browse(props: { initialDeckId: Id | null; initialNoteId: Id | null }) {
  const { db, noteTypes, version } = useApp();
  const t = useT();
  const lang = useLang();
  const [filters, setFilters] = useState<Filters>({ text: "", deckId: props.initialDeckId, tag: "", state: "", noteTypeId: null, sort: "created" });
  const [text, setText] = useState("");
  const [total, setTotal] = useState<number | null>(null);
  const [pages, setPages] = useState<Map<number, BrowseRow[]>>(new Map());
  const [selected, setSelected] = useState<Id | null>(props.initialNoteId);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [decks, setDecks] = useState<DeckNode[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [queryMs, setQueryMs] = useState<number | null>(null);
  const loading = useRef(new Set<number>());
  const generation = useRef(0);
  const list = useRef<VirtualListHandle>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void db.deckTree().then((tree) => setDecks(flattenDecks(tree)));
    void db.listTags().then(setTags);
  }, [db, version]);

  // Debounced text search.
  useEffect(() => {
    const id = setTimeout(() => setFilters((f) => (f.text === text ? f : { ...f, text })), 150);
    return () => clearTimeout(id);
  }, [text]);

  const query = useMemo<BrowseQuery>(() => {
    const q: BrowseQuery = { sort: { by: filters.sort, direction: filters.sort === "sortField" ? "asc" : "desc" } };
    if (filters.text.trim()) q.text = filters.text.trim();
    if (filters.deckId !== null) q.deckId = filters.deckId;
    if (filters.tag) q.tags = [filters.tag];
    if (filters.state) q.state = filters.state;
    if (filters.noteTypeId !== null) q.noteTypeId = filters.noteTypeId;
    return q;
  }, [filters]);

  const fetchPage = useCallback(
    async (page: number, gen: number) => {
      // The worker runs one request at a time: never queue pages for a query that is no longer shown, and keep at
      // most two in flight (the range effect asks again when they land).
      if (gen !== generation.current || loading.current.has(page) || loading.current.size >= 2) return;
      loading.current.add(page);
      try {
        const t0 = performance.now();
        const r = await db.search({ ...query, offset: page * PAGE, limit: PAGE });
        if (gen !== generation.current) return;
        if (page === 0) setQueryMs(performance.now() - t0);
        setTotal(r.total);
        setPages((m) => new Map(m).set(page, r.rows));
      } finally {
        loading.current.delete(page);
      }
    },
    [db, query],
  );

  // New query (or data changed): start over from the first page.
  useEffect(() => {
    const gen = ++generation.current;
    loading.current.clear();
    setPages(new Map());
    void fetchPage(0, gen);
  }, [fetchPage, version]);

  const onRange = useCallback(
    (start: number, end: number) => {
      for (let p = Math.floor(start / PAGE); p <= Math.floor(Math.max(start, end - 1) / PAGE); p++) {
        if (!pages.has(p)) void fetchPage(p, generation.current);
      }
    },
    [pages, fetchPage],
  );

  const rowAt = (i: number): BrowseRow | undefined => pages.get(Math.floor(i / PAGE))?.[i % PAGE];
  const deckName = useMemo(() => new Map(decks.map((d) => [d.id, d.name])), [decks]);

  const select = (i: number) => {
    if (total === null || i < 0 || i >= total) return;
    setActiveIndex(i);
    list.current?.scrollToIndex(i);
    const r = rowAt(i);
    if (r) setSelected(r.id);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target as HTMLElement).isContentEditable)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const hasFilters = filters.deckId !== null || filters.tag || filters.state || filters.noteTypeId !== null || filters.text;

  return (
    <div className={`page page-browse ${selected !== null ? "has-selection" : ""}`}>
      <div className="browse-list-pane">
        <header className="browse-head">
          <div className="search">
            <Icon name="browse" />
            <input
              ref={searchRef}
              type="search"
              className="search-input"
              placeholder={`${t("browse.search")}  /`}
              aria-label={t("browse.search")}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  list.current?.element()?.focus();
                  select(Math.max(0, activeIndex));
                }
              }}
              data-testid="browse-search"
            />
          </div>
          <div className="filters" role="group" aria-label={t("browse.filters")}>
            <select className="select select-sm" value={filters.deckId ?? ""} onChange={(e) => setFilters((f) => ({ ...f, deckId: e.target.value ? Number(e.target.value) : null }))} aria-label={t("browse.deck")} data-testid="filter-deck">
              <option value="">{t("browse.anyDeck")}</option>
              {decks.map((d) => (
                <option key={d.id} value={d.id}>
                  {" ".repeat(d.name.split("::").length - 1)}
                  {d.shortName}
                </option>
              ))}
            </select>
            <select className="select select-sm" value={filters.state} onChange={(e) => setFilters((f) => ({ ...f, state: e.target.value as ItemFilter | "" }))} aria-label={t("browse.state")} data-testid="filter-state">
              <option value="">{t("browse.anyState")}</option>
              {STATES.map((s) => (
                <option key={s} value={s}>
                  {t(`browse.state.${s}` as MessageKey)}
                </option>
              ))}
            </select>
            <select className="select select-sm" value={filters.noteTypeId ?? ""} onChange={(e) => setFilters((f) => ({ ...f, noteTypeId: e.target.value ? Number(e.target.value) : null }))} aria-label={t("browse.noteType")}>
              <option value="">{t("browse.anyNoteType")}</option>
              {noteTypes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
            <select className="select select-sm" value={filters.tag} onChange={(e) => setFilters((f) => ({ ...f, tag: e.target.value }))} aria-label={t("browse.tag")} data-testid="filter-tag">
              <option value="">{t("browse.anyTag")}</option>
              {tags.map((tg) => (
                <option key={tg} value={tg}>
                  {tg}
                </option>
              ))}
            </select>
            <select className="select select-sm" value={filters.sort} onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value as Filters["sort"] }))} aria-label={t("browse.sort")}>
              {(["created", "modified", "sortField"] as const).map((s) => (
                <option key={s} value={s}>
                  {t(`browse.sort.${s}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="browse-meta">
            <span className="muted small" data-testid="browse-count" data-total={total ?? ""}>
              {total === null ? t("common.loading") : t("browse.count", { n: formatNumber(total, lang) })}
              {queryMs !== null && total !== null ? ` · ${Math.round(queryMs)} ms` : ""}
            </span>
            <span className="spacer" />
            {hasFilters && (
              <button
                type="button"
                className="btn btn-small btn-quiet"
                onClick={() => {
                  setText("");
                  setFilters((f) => ({ ...f, text: "", deckId: null, tag: "", state: "", noteTypeId: null }));
                }}
              >
                {t("browse.clear")}
              </button>
            )}
            <button type="button" className="btn btn-small btn-ghost" onClick={() => setAdding(true)} data-testid="add-note">
              <Icon name="plus" size={16} /> {t("browse.add")}
            </button>
          </div>
        </header>
        {total === 0 ? (
          <p className="empty-line">{hasFilters ? t("browse.empty") : t("browse.emptyCollection")}</p>
        ) : (
          <VirtualList
            ref={list}
            className="browse-list"
            count={total ?? 0}
            rowHeight={ROW_H}
            onRange={onRange}
            label={t("browse.results")}
            activeId={activeIndex >= 0 ? `row-${activeIndex}` : undefined}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "j") {
                e.preventDefault();
                select(activeIndex + 1);
              } else if (e.key === "ArrowUp" || e.key === "k") {
                e.preventDefault();
                select(Math.max(0, activeIndex - 1));
              } else if (e.key === "Home") {
                e.preventDefault();
                select(0);
              } else if (e.key === "End" && total) {
                e.preventDefault();
                select(total - 1);
              }
            }}
            renderRow={(i) => {
              const r = rowAt(i);
              if (!r) return <div className="brow brow-skeleton" />;
              const isSel = r.id === selected;
              return (
                <div
                  id={`row-${i}`}
                  role="option"
                  aria-selected={isSel}
                  className={`brow ${isSel ? "is-selected" : ""} ${r.suspended ? "is-suspended" : ""}`}
                  onClick={() => {
                    setActiveIndex(i);
                    setSelected(r.id);
                  }}
                  data-testid="browse-row"
                >
                  <span className="brow-main">{r.sortField || "—"}</span>
                  <span className="brow-sub">
                    <span className="brow-deck">{(deckName.get(r.deckIds[0] ?? -1) ?? "").split("::").pop()}</span>
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
                </div>
              );
            }}
          />
        )}
      </div>
      <div className="browse-detail">
        {selected !== null ? (
          <>
            <button type="button" className="btn btn-small btn-quiet browse-back" onClick={() => setSelected(null)}>
              <Icon name="chevronLeft" size={16} /> {t("browse.results")}
            </button>
            <NoteEditor key={selected} noteId={selected} full onDeleted={() => setSelected(null)} />
          </>
        ) : (
          <p className="empty-detail">{t("browse.select")}</p>
        )}
      </div>
      <AddNoteDialog
        open={adding}
        deckId={filters.deckId}
        onClose={() => setAdding(false)}
        onAdded={(id) => {
          setSelected(id);
          navigate({ name: "browse", deckId: filters.deckId, noteId: id }, true);
        }}
      />
    </div>
  );
}
