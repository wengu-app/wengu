/**
 * Making cards, drawn as a desk: index cards on a cutting mat, note types as divider tabs, tags as label-maker tape,
 * and the target deck as its card holder. Adding keeps the deck, type and tags so several cards can be made in a row.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { DeckNode, Id, NoteType } from "@wengu/core";

import { goBack, navigate, useApp } from "../lib/app.tsx";
import { formatNumber } from "../lib/format.ts";
import { useLang, useT } from "../lib/i18n.ts";
import { deckColor } from "../lib/theme.ts";
import { Icon } from "../ui/Icon.tsx";
import { PageHead } from "../ui/PageHead.tsx";
import { deckOptions, Select } from "../ui/Select.tsx";
import { FieldEditor, flattenDecks } from "./Editor.tsx";

const TAB_COLORS = ["var(--c-accent)", "var(--c-easy)", "var(--c-good)", "var(--c-hard)", "#9b6cf0"];
const MEMO_KEY = "wengu.make";
const VISIBLE_TABS = 4;

/** Field names a template refers to, ignoring conditionals' markers and filters such as `type:` or `cloze:`. */
function fieldRefs(format: string): Set<string> {
  const out = new Set<string>();
  for (const m of format.matchAll(/\{\{([^{}]+)\}\}/g)) {
    const s = m[1]!.trim().replace(/^[#^/]/, "");
    out.add(s.split(":").pop()!.trim());
  }
  return out;
}

/** Fields shown on the first template's question go on the front card; the rest on the back. */
function sides(nt: NoteType): { front: number[]; back: number[] } {
  const refs = fieldRefs(nt.templates[0]?.questionFormat ?? "");
  const front: number[] = [];
  const back: number[] = [];
  nt.fields.forEach((f, i) => (refs.has(f.name) ? front : back).push(i));
  if (!front.length && back.length) front.push(back.shift()!);
  return { front, back };
}

const isBlank = (html: string | undefined) => !html?.replace(/<[^>]*>|&nbsp;|\s/g, "");

/** How many review cards the note would make (an estimate of Anki's rule: a non-empty question). */
function cardCount(nt: NoteType, fields: string[]): number {
  if (nt.kind === "cloze") {
    const ns = new Set<string>();
    for (const f of fields) for (const m of f.matchAll(/\{\{c(\d+)::/g)) ns.add(m[1]!);
    return ns.size;
  }
  return nt.templates.filter((tpl) => {
    const refs = fieldRefs(tpl.questionFormat);
    return nt.fields.some((f, i) => refs.has(f.name) && !isBlank(fields[i]));
  }).length;
}

function readMemo(): { nt?: Id; deck?: Id } {
  try {
    return JSON.parse(localStorage.getItem(MEMO_KEY) ?? "{}") as { nt?: Id; deck?: Id };
  } catch {
    return {};
  }
}
function writeMemo(m: { nt: Id | null; deck: Id | null }) {
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
  const [fields, setFields] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [knownTags, setKnownTags] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [sending, setSending] = useState(false);
  const [made, setMade] = useState(0);
  const busy = useRef(false);

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
    if (ntId !== null && noteTypes.some((n) => n.id === ntId)) return;
    if (!noteTypes.length) return;
    setNtId(noteTypes.some((n) => n.id === memo.nt) ? memo.nt! : noteTypes[0]!.id);
  }, [noteTypes, ntId, memo]);

  const nt = noteTypes.find((n) => n.id === ntId);
  useEffect(() => {
    setFields(nt ? nt.fields.map(() => "") : []);
    setError(null);
    // only when another note type is picked, not when the list is reloaded after adding
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nt?.id]);
  useEffect(() => writeMemo({ nt: ntId, deck: deckId }), [ntId, deckId]);

  const deck = decks.find((d) => d.id === deckId);
  const layout = useMemo(() => (nt ? sides(nt) : { front: [], back: [] }), [nt]);
  const count = nt ? cardCount(nt, fields) : 0;
  const ntIndex = Math.max(0, noteTypes.findIndex((n) => n.id === ntId));
  const ntColor = TAB_COLORS[ntIndex % TAB_COLORS.length]!;

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
    if (!nt || deckId === null || busy.current) return;
    if (isBlank(fields[layout.front[0] ?? 0])) {
      setError(t("editor.emptyFirst"));
      return;
    }
    busy.current = true;
    try {
      const allTags = tagDraft.trim() ? [...tags, ...tagDraft.split(/[\s,，]+/).filter(Boolean)] : tags;
      const r = await db.addKnowledgePoint({ noteTypeId: nt.id, deckId, fields, tags: allTags });
      setError(null);
      setSending(true);
      await changed();
      toast(t("editor.added"), { label: t("make.view"), run: () => navigate({ name: "browse", deckId, noteId: r.id }) });
      setMade((n) => n + r.itemIds.length);
      if (tagDraft.trim()) commitTag(tagDraft);
      window.setTimeout(() => {
        setFields(nt.fields.map(() => ""));
        setFormKey((k) => k + 1);
        setSending(false);
        busy.current = false;
      }, 420);
    } catch (e) {
      busy.current = false;
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const tabs = noteTypes.slice(0, VISIBLE_TABS);
  if (nt && !tabs.includes(nt)) tabs.push(nt);
  const more = noteTypes.filter((n) => !tabs.includes(n));
  const n = (v: number) => formatNumber(v, lang);

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
        onChange={(v) => setFields((fs) => fs.map((x, j) => (j === i ? v : x)))}
      />
    );
  };

  return (
    <div className="page page-make">
      <PageHead
        title={t("make.title")}
        sub={t("make.sub")}
        actions={
          <button type="button" className="btn btn-ghost btn-small" onClick={goBack}>
            <Icon name="check" size={16} />
            {t("make.done")}
          </button>
        }
      />

      {noteTypes.length > 0 && (
        <div className="ix-tabs" role="tablist" aria-label={t("browse.noteType")}>
          {tabs.map((x) => {
            const k = noteTypes.indexOf(x);
            return (
              <button
                key={x.id}
                type="button"
                role="tab"
                aria-selected={x.id === ntId}
                className="ix-tab"
                style={{ "--tc": TAB_COLORS[k % TAB_COLORS.length] } as React.CSSProperties}
                onClick={() => setNtId(x.id)}
              >
                {x.name}
              </button>
            );
          })}
          {more.length > 0 && (
            <Select className="ix-tab ix-tab-more" label={t("make.moreTypes")} value={0}
              options={more.map((x) => ({ value: x.id, label: x.name }))} onChange={setNtId}>
              <span>{t("make.moreTypes")}</span>
              <Icon name="more" size={16} />
            </Select>
          )}
        </div>
      )}

      <div
        className="mat"
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            void add();
          }
        }}
      >
        <div className="mat-ruler" aria-hidden="true">
          {Array.from({ length: 16 }, (_, k) => (
            <span key={k}>{k}</span>
          ))}
        </div>

        {!nt ? (
          <StockPicker />
        ) : (
          <div className="mat-grid">
            <div className={`ix-cards ${layout.back.length ? "" : "is-single"} ${sending ? "is-sending" : ""}`} key={formKey} style={{ "--tc": ntColor } as React.CSSProperties}>
              <section className="ix-card ix-front" aria-label={t("make.front")}>
                <span className="ix-tape" aria-hidden="true" />
                <header className="ix-head">
                  <span className="ix-side">{t("make.front")}</span>
                  <span className="ix-hint">{nt.kind === "cloze" ? t("make.clozeHint") : t("make.frontHint")}</span>
                </header>
                <div className="ix-body">{layout.front.map((i, k) => field(i, "front", k === 0))}</div>
              </section>
              {layout.back.length > 0 && (
                <section className="ix-card ix-back" aria-label={t("make.back")}>
                  <span className="ix-tape" aria-hidden="true" />
                  <header className="ix-head">
                    <span className="ix-side">{t("make.back")}</span>
                    <span className="ix-hint">{t("make.backHint")}</span>
                  </header>
                  <div className="ix-body">{layout.back.map((i, k) => field(i, "back", k === 0))}</div>
                </section>
              )}
            </div>

            <aside className="holder-col">
              <span className="holder-into">{t("make.into")}</span>
              {deck ? (
                <Holder deck={deck} decks={decks} made={made} onPick={setDeckId} />
              ) : (
                <p className="holder-none">{t("make.noDecks")}</p>
              )}
              <p className={`holder-count ${count ? "" : "is-zero"}`}>
                {count === 0 ? t("make.willMakeNone") : count === 1 ? t("make.willMakeOne") : t("make.willMake", { n: n(count) })}
              </p>
              <button type="button" className="btn btn-primary btn-lg holder-go" onClick={() => void add()} disabled={!deck || sending} data-testid="add-note-submit">
                {t("make.submit")}
                <kbd>Ctrl Enter</kbd>
              </button>
              {error && (
                <p className="error-text" role="alert">
                  {error}
                </p>
              )}
            </aside>

            <div className="tape-row">
              <span className="tape-label">{t("editor.tags")}</span>
              <div className="tapes">
                {tags.map((tag) => (
                  <span key={tag} className="tape">
                    {tag}
                    <button type="button" className="tape-x" aria-label={`${t("common.delete")} ${tag}`} onClick={() => setTags((ts) => ts.filter((x) => x !== tag))}>
                      <Icon name="close" size={11} />
                    </button>
                  </span>
                ))}
                <input
                  className="tape tape-input"
                  list="make-tags"
                  value={tagDraft}
                  placeholder={t("make.tagAdd")}
                  aria-label={t("editor.tags")}
                  size={Math.max(8, tagDraft.length + 2)}
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
              {made > 0 && <span className="tape-made">{t("make.session", { n: n(made) })}</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** The target deck as its card holder; the select laid over it changes the deck. */
function Holder({ deck, decks, made, onPick }: { deck: DeckNode; decks: DeckNode[]; made: number; onPick(id: Id): void }) {
  const t = useT();
  const lang = useLang();
  const [c, d] = deckColor(deck.name);
  const layers = Math.max(2, Math.min(6, Math.round(Math.sqrt(deck.totalItems))));
  return (
    <div className="holder" style={{ "--pc": c, "--pd": d } as React.CSSProperties}>
      <span className="pack-back" />
      <span className="pack-pile">
        {Array.from({ length: layers }, (_, k) => (
          <span key={k} className="pack-card" style={{ transform: `translate(${((k * 37) % 9) - 4}px, ${-(layers - 1 - k) * 5}px) rotate(${k === layers - 1 ? 0 : ((k * 53) % 7) - 3}deg)` }} />
        ))}
      </span>
      {made > 0 && (
        <span className="pack-due holder-made" key={made}>
          +{formatNumber(made, lang)}
        </span>
      )}
      <span className="pack-front">
        <span className="pack-hd">
          <span className="pack-emb">{[...deck.shortName][0]?.toUpperCase()}</span>
          <span className="pack-title">
            <span className="pack-name">{deck.name.split("::").pop()}</span>
            <span className="pack-meta">{deck.name.includes("::") ? deck.name.split("::").slice(0, -1).join(" / ") : t("decks.cards", { n: formatNumber(deck.totalItems, lang) })}</span>
          </span>
        </span>
        <span className="pack-label holder-pick">
          <span>{t("make.changeDeck")}</span>
          <Icon name="more" size={16} />
        </span>
      </span>
      <Select className="holder-select" label={t("browse.deck")} value={deck.id} options={deckOptions(decks)} onChange={onPick}>
        <span className="sr-only">{t("make.changeDeck")}</span>
      </Select>
    </div>
  );
}

/** No note types yet: offer Anki's stock ones as blank cards to pick from. */
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
            className="ix-card stock-card"
            style={{ "--tc": TAB_COLORS[i] } as React.CSSProperties}
            onClick={async () => {
              await db.createStockNoteType(k.kind);
              await changed(true);
            }}
          >
            <span className="ix-tape" aria-hidden="true" />
            <span className="stock-face">{k.face}</span>
            <span className="stock-label">{k.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
