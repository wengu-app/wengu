/**
 * Making cards: compact deck selector + pinned note-type capsules (most-used pinned by default, with a "More" popover
 * to pick or pin/unpin others) above a clean front/back card sheet with keyboard-first flow.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DeckNode, Id, NoteType } from "@wengu/core";

import { goBack, navigate, useApp } from "../lib/app.tsx";
import { formatNumber } from "../lib/format.ts";
import { useLang, useT } from "../lib/i18n.ts";
import { cardCount, defaultPinnedIds, isBlank, isImageOcclusion, partitionNoteTypes, sides, transferFields } from "../lib/make.ts";
import { deckColor } from "../lib/theme.ts";
import { Icon } from "../ui/Icon.tsx";
import { PageHead } from "../ui/PageHead.tsx";
import { deckOptions, Select } from "../ui/Select.tsx";
import { FieldEditor, flattenDecks } from "./Editor.tsx";

const TYPE_COLORS = ["var(--c-accent)", "var(--c-easy)", "var(--c-good)", "var(--c-hard)", "#9b6cf0"];
const MEMO_KEY = "wengu.make";
const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);

interface MakeMemo {
  nt?: Id;
  deck?: Id;
  /** User-customised pinned note-type IDs; omitted until the user pins or unpins one. */
  pinned?: Id[];
}

function readMemo(): MakeMemo {
  try {
    return JSON.parse(localStorage.getItem(MEMO_KEY) ?? "{}") as MakeMemo;
  } catch {
    return {};
  }
}
function writeMemo(m: MakeMemo) {
  try {
    localStorage.setItem(MEMO_KEY, JSON.stringify(m));
  } catch {
    /* per-device convenience only */
  }
}

export function Make({ initialDeckId }: { initialDeckId: Id | null }) {
  const { db, noteTypes, changed, toast, version } = useApp();
  const t = useT();
  const lang = useLang();
  const memo = useMemo(readMemo, []);
  const [ntId, setNtId] = useState<Id | null>(null);
  const [deckId, setDeckId] = useState<Id | null>(initialDeckId ?? null);
  const [decks, setDecks] = useState<DeckNode[]>([]);
  const [usageCounts, setUsageCounts] = useState<Map<Id, number>>(() => new Map());
  const [customPinned, setCustomPinned] = useState<Id[] | null>(() => (Array.isArray(memo.pinned) ? memo.pinned : null));
  const [fields, setFields] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [knownTags, setKnownTags] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [made, setMade] = useState(0);
  const busy = useRef(false);
  const prevNtRef = useRef<NoteType | undefined>(undefined);

  const loadDecks = async () => {
    const flat = flattenDecks(await db.deckTree()).filter((d) => d.kind === "normal");
    setDecks(flat);
    setDeckId((cur) => {
      const ok = (id: Id | null | undefined) => id != null && flat.some((d) => d.id === id);
      if (ok(cur)) return cur;
      if (ok(memo.deck)) return memo.deck!;
      return flat.find((d) => d.id !== 1)?.id ?? flat[0]?.id ?? null;
    });
  };
  useEffect(() => {
    void loadDecks();
    void db.listTags().then(setKnownTags);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, version]);

  useEffect(() => {
    if (!noteTypes.length) return;
    let cancelled = false;
    void Promise.all(noteTypes.map(async (x) => [x.id, (await db.search({ noteTypeId: x.id, limit: 1 })).total] as const)).then((entries) => {
      if (!cancelled) setUsageCounts(new Map(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [db, noteTypes, version]);

  const effectivePinned = useMemo(
    () => (customPinned !== null ? customPinned : defaultPinnedIds(noteTypes, usageCounts)),
    [customPinned, noteTypes, usageCounts],
  );

  useEffect(() => {
    if (ntId !== null && noteTypes.some((n) => n.id === ntId)) return;
    if (!noteTypes.length) return;
    const memoNt = noteTypes.find((n) => n.id === memo.nt && !isImageOcclusion(n));
    const fallback = noteTypes.find((n) => n.id === effectivePinned[0]) ?? noteTypes.find((n) => !isImageOcclusion(n)) ?? noteTypes[0]!;
    setNtId((memoNt ?? fallback).id);
  }, [noteTypes, ntId, memo, effectivePinned]);

  const nt = noteTypes.find((n) => n.id === ntId);
  useEffect(() => {
    if (!nt) {
      setFields([]);
      prevNtRef.current = undefined;
      return;
    }
    const prevNt = prevNtRef.current;
    prevNtRef.current = nt;
    if (prevNt?.id === nt.id) return;
    setFields((cur) => transferFields(prevNt, cur, nt));
    setFormKey((k) => k + 1);
    setError(null);
  }, [nt]);

  useEffect(() => {
    const next: MakeMemo = {};
    if (ntId !== null) next.nt = ntId;
    if (deckId !== null) next.deck = deckId;
    if (customPinned !== null) next.pinned = customPinned;
    writeMemo(next);
  }, [ntId, deckId, customPinned]);

  const togglePin = (id: Id) => {
    setCustomPinned((cur) => {
      const base = cur ?? effectivePinned;
      return base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
    });
  };

  const { visible: visibleTypes, pinnedSet, hasMore } = useMemo(
    () => partitionNoteTypes(noteTypes, effectivePinned, ntId),
    [noteTypes, effectivePinned, ntId],
  );

  const deck = decks.find((d) => d.id === deckId);
  const unsupported = nt ? isImageOcclusion(nt) : false;
  const fallbackNt = useMemo(() => noteTypes.find((x) => !isImageOcclusion(x)), [noteTypes]);
  const layout = useMemo(() => (nt ? sides(nt) : { front: [], back: [] }), [nt]);
  const count = nt && !unsupported ? cardCount(nt, fields) : 0;
  const colorOf = (id: Id) => TYPE_COLORS[Math.max(0, noteTypes.findIndex((x) => x.id === id)) % TYPE_COLORS.length]!;
  const ntColor = nt ? colorOf(nt.id) : TYPE_COLORS[0]!;
  const deckTint = deck ? deckColor(deck.name)[0] : "var(--c-accent)";

  const nextCloze = () => {
    let max = 0;
    for (const f of fields) for (const m of f.matchAll(/\{\{c(\d+)::/g)) max = Math.max(max, Number(m[1]));
    return max + 1;
  };

  const commitTag = (raw: string) => {
    const parts = raw.split(/[\s,，]+/).filter(Boolean);
    if (parts.length) setTags((ts) => [...ts, ...parts.filter((p) => !ts.includes(p))]);
    setTagDraft("");
  };

  const add = async () => {
    if (!nt || unsupported || deckId === null || busy.current) return;
    if (isBlank(fields[layout.front[0] ?? 0])) {
      setError(t("editor.emptyFirst"));
      return;
    }
    busy.current = true;
    setSaving(true);
    try {
      const pending = tagDraft.trim() ? tagDraft.split(/[\s,，]+/).filter(Boolean) : [];
      const allTags = pending.length ? [...tags, ...pending.filter((p) => !tags.includes(p))] : tags;
      const r = await db.addKnowledgePoint({ noteTypeId: nt.id, deckId, fields, tags: allTags });
      setError(null);
      setMade((m) => m + r.itemIds.length);
      if (pending.length) commitTag(tagDraft);
      setFields(nt.fields.map(() => ""));
      setFormKey((k) => k + 1);
      await changed();
      toast(t("editor.added"), { label: t("make.view"), run: () => navigate({ name: "browse", deckId, noteId: r.id }) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  const n = (v: number) => formatNumber(v, lang);
  const frontHasContent = !isBlank(fields[layout.front[0] ?? 0]);
  const countLabel =
    count === 0
      ? nt?.kind === "cloze" && frontHasContent
        ? t("make.willMakeClozeNone")
        : t("make.willMakeNone")
      : count === 1
        ? t("make.willMakeOne")
        : t("make.willMake", { n: n(count) });

  const field = (i: number, side: "front" | "back", first: boolean) => {
    const f = nt!.fields[i]!;
    return (
      <FieldEditor
        key={`${formKey}-${nt!.id}-${i}`}
        variant="card"
        name={f.name}
        value={fields[i] ?? ""}
        rtl={f.rtl}
        autoFocus={side === "front" && first}
        testId={`add-field-${i}`}
        placeholder={first ? t(side === "front" ? "make.placeholderFront" : "make.placeholderBack") : undefined}
        {...(nt!.kind === "cloze" && side === "front" ? { nextCloze } : {})}
        onChange={(v) => {
          setFields((fs) => fs.map((x, j) => (j === i ? v : x)));
          if (error) setError(null);
        }}
      />
    );
  };

  return (
    <div className="page page-make">
      <PageHead
        title={t("make.title")}
        sub={t("make.sub")}
        actions={
          <>
            {made > 0 && (
              <span className="make-session" key={made}>
                {t("make.session", { n: n(made) })}
              </span>
            )}
            <button type="button" className="btn btn-ghost btn-small" onClick={goBack}>
              <Icon name="check" size={16} />
              {t("make.done")}
            </button>
          </>
        }
      />

      {!nt ? (
        <StockPicker />
      ) : (
        <div
          className="make-workspace"
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
              e.preventDefault();
              void add();
            }
          }}
        >
          <div className="make-bar">
            <span className="make-control-label">{t("browse.deck")}</span>
            <div className="make-control-val">
              {deck ? (
                <div className="make-select-wrap">
                  <span className="make-dot" style={{ background: deckTint }} aria-hidden="true" />
                  <Select
                    size="sm"
                    className="make-select"
                    label={t("browse.deck")}
                    value={deck.id}
                    options={deckOptions(decks)}
                    onChange={setDeckId}
                    data-testid="make-deck"
                  />
                </div>
              ) : (
                <span className="muted small">{t("make.noDecks")}</span>
              )}
            </div>

            <span className="make-control-label">{t("browse.noteType")}</span>
            <div className="make-pills" role="tablist" aria-label={t("browse.noteType")} data-testid="make-note-types">
              {visibleTypes.map((x) => {
                const selected = x.id === ntId;
                return (
                  <button
                    key={x.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    className={`make-pill ${isImageOcclusion(x) ? "is-unsupported" : ""}`}
                    style={{ "--tc": colorOf(x.id) } as React.CSSProperties}
                    onClick={() => setNtId(x.id)}
                  >
                    <span className="make-pill-dot" aria-hidden="true" />
                    <span>{x.name}</span>
                  </button>
                );
              })}
              {hasMore && (
                <MoreTypesMenu
                  noteTypes={noteTypes}
                  activeId={ntId}
                  pinnedSet={pinnedSet}
                  colorOf={colorOf}
                  onPick={setNtId}
                  onTogglePin={togglePin}
                />
              )}
            </div>
          </div>

          <div className="make-sheet" style={{ "--tc": ntColor } as React.CSSProperties}>
            {unsupported ? (
              <div className="make-unsupported" data-testid="make-unsupported">
                <div className="make-unsupported-icon">
                  <Icon name="info" size={24} />
                </div>
                <h2>{t("make.unsupportedTitle")}</h2>
                <p>{t("make.unsupportedBody", { name: nt.name })}</p>
                {fallbackNt && (
                  <button type="button" className="btn btn-primary" onClick={() => setNtId(fallbackNt.id)}>
                    {t("make.switchTo", { name: fallbackNt.name })}
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className={`make-sides ${layout.back.length ? "" : "is-single"}`}>
                  <section className="make-side" aria-label={t("make.front")}>
                    <header className="make-side-head">
                      <span className="make-side-label">{t("make.front")}</span>
                      <span className="make-side-hint">{nt.kind === "cloze" ? t("make.clozeHint") : t("make.frontHint")}</span>
                    </header>
                    <div className="make-fields">{layout.front.map((i, k) => field(i, "front", k === 0))}</div>
                  </section>

                  {layout.back.length > 0 && (
                    <section className="make-side" aria-label={t("make.back")}>
                      <header className="make-side-head">
                        <span className="make-side-label">{t("make.back")}</span>
                        <span className="make-side-hint">{t("make.backHint")}</span>
                      </header>
                      <div className="make-fields">{layout.back.map((i, k) => field(i, "back", k === 0))}</div>
                    </section>
                  )}
                </div>

                <footer className="make-foot">
                  <div className="make-tags-row">
                    <span className="make-tags-label">{t("editor.tags")}</span>
                    <div className="make-tags">
                      {tags.map((tag) => (
                        <span key={tag} className="make-tag">
                          {tag}
                          <button
                            type="button"
                            tabIndex={-1}
                            className="make-tag-x"
                            aria-label={`${t("common.delete")} ${tag}`}
                            onClick={() => setTags((ts) => ts.filter((x) => x !== tag))}
                          >
                            <Icon name="close" size={12} />
                          </button>
                        </span>
                      ))}
                      <input
                        className="make-tag-input"
                        list="make-tags"
                        value={tagDraft}
                        placeholder={t("make.tagAdd")}
                        aria-label={t("editor.tags")}
                        size={Math.max(10, tagDraft.length + 2)}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (/[\s,，]$/.test(v)) commitTag(v);
                          else setTagDraft(v);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !(e.ctrlKey || e.metaKey) && tagDraft.trim()) {
                            e.preventDefault();
                            commitTag(tagDraft);
                          } else if (e.key === "Backspace" && !tagDraft && tags.length) {
                            setTags((ts) => ts.slice(0, -1));
                          }
                        }}
                      />
                      <datalist id="make-tags">
                        {knownTags.slice(0, 200).map((x) => (
                          <option key={x} value={x} />
                        ))}
                      </datalist>
                    </div>
                  </div>

                  <div className="make-actions">
                    <div className="make-status">
                      <span className={`make-count ${count ? "" : "is-zero"}`}>{countLabel}</span>
                      {error && (
                        <span className="error-text" role="alert">
                          {error}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => void add()}
                      disabled={!deck || saving}
                      data-testid="add-note-submit"
                    >
                      {t("make.submit")}
                      <kbd>{IS_MAC ? "⌘ Enter" : "Ctrl Enter"}</kbd>
                    </button>
                  </div>
                </footer>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Popover listing every note type so the user can pick one or pin/unpin it to the outer capsule bar. */
function MoreTypesMenu(props: {
  noteTypes: readonly NoteType[];
  activeId: Id | null;
  pinnedSet: ReadonlySet<Id>;
  colorOf(id: Id): string;
  onPick(id: Id): void;
  onTogglePin(id: Id): void;
}) {
  const { noteTypes, activeId, pinnedSet, colorOf, onPick, onTogglePin } = props;
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  const searchable = noteTypes.length > 8;
  const q = query.trim().toLowerCase();
  const shown = q ? noteTypes.filter((x) => x.name.toLowerCase().includes(q)) : noteTypes;

  const close = (refocus = true) => {
    setOpen(false);
    setQuery("");
    if (refocus) trigger.current?.focus();
  };

  useLayoutEffect(() => {
    const el = pop.current;
    const tr = trigger.current;
    if (!open || !el || !tr) return;
    try {
      el.showPopover();
    } catch {
      /* no popover support: stays fixed */
    }
    const place = () => {
      const r = tr.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - 12;
      const above = r.top - 12;
      const up = below < 220 && above > below;
      el.style.minWidth = `${Math.max(r.width, 260)}px`;
      el.style.maxHeight = `${Math.max(140, Math.min(360, up ? above : below))}px`;
      el.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - el.offsetWidth - 8))}px`;
      el.style.top = up ? "" : `${r.bottom + 6}px`;
      el.style.bottom = up ? `${window.innerHeight - r.top + 6}px` : "";
    };
    place();
    if (searchable) el.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
    const onDown = (e: PointerEvent) => {
      const n = e.target as Node;
      if (!el.contains(n) && !tr.contains(n)) close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close(true);
      }
    };
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && el.contains(e.target)) return;
      const r = tr.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) close(false);
      else place();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", place);
    };
  }, [open, searchable]);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="make-pill make-pill-more"
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid="make-more-types"
        onClick={() => (open ? close(true) : setOpen(true))}
      >
        <span>{t("make.moreTypes")}</span>
        <Icon name="chevronDown" size={14} />
      </button>

      {open && (
        <div ref={pop} popover="manual" className="select-pop make-more-pop" data-testid="make-more-pop">
          {searchable && (
            <div className="select-search">
              <Icon name="browse" size={14} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("common.filter")} aria-label={t("common.filter")} />
            </div>
          )}
          <div className="select-list" role="listbox" aria-label={t("browse.noteType")}>
            {shown.map((x) => {
              const selected = x.id === activeId;
              const pinned = pinnedSet.has(x.id);
              const isIo = isImageOcclusion(x);
              return (
                <div key={x.id} className="make-more-row">
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={`make-more-pick ${isIo ? "is-unsupported" : ""}`}
                    onClick={() => {
                      onPick(x.id);
                      close(true);
                    }}
                  >
                    <span className="make-pill-dot" style={{ background: colorOf(x.id) }} aria-hidden="true" />
                    <span className="make-more-name">{x.name}</span>
                    {isIo && <span className="make-more-badge">{t("make.unsupportedBadge")}</span>}
                    {selected && <Icon name="check" size={14} className="make-more-check" />}
                  </button>
                  <button
                    type="button"
                    className={`make-pin-btn ${pinned ? "is-pinned" : ""}`}
                    aria-pressed={pinned}
                    aria-label={`${pinned ? t("make.unpinType") : t("make.pinType")} ${x.name}`}
                    title={pinned ? t("make.unpinType") : t("make.pinType")}
                    onClick={(e) => {
                      e.stopPropagation();
                      onTogglePin(x.id);
                    }}
                  >
                    <Icon name="pin" size={14} />
                  </button>
                </div>
              );
            })}
            {!shown.length && <div className="select-empty">{t("common.noMatches")}</div>}
          </div>
        </div>
      )}
    </>
  );
}

/** No note types yet: offer Anki's stock ones as clean cards to pick from. */
function StockPicker() {
  const { db, changed } = useApp();
  const t = useT();
  const kinds = [
    { kind: "basic", label: t("make.stock.basic"), face: "Q → A" },
    { kind: "basic-reversed", label: t("make.stock.reversed"), face: "Q ⇄ A" },
    { kind: "cloze", label: t("make.stock.cloze"), face: "[...]" },
  ] as const;
  return (
    <div className="stock">
      <p className="stock-title">{t("make.pickType")}</p>
      <div className="stock-cards">
        {kinds.map((k, i) => (
          <button
            key={k.kind}
            type="button"
            className="stock-card"
            style={{ "--tc": TYPE_COLORS[i] } as React.CSSProperties}
            onClick={async () => {
              await db.createStockNoteType(k.kind);
              await changed(true);
            }}
          >
            <span className="stock-face">{k.face}</span>
            <span className="stock-label">{k.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
