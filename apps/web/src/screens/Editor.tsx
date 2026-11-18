import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AnkiTemplatePresentation, DeckNode, Id, KnowledgePointDetail, NoteType, ReviewItem } from "@wengu/core";

import { CardFrame } from "../card/CardFrame.tsx";
import type { FrameController } from "../card/frameController.ts";
import { frameCard, prepareFor } from "../card/prepare.ts";
import { cleanTree } from "../frame/sanitize.ts";
import { useApp } from "../lib/app.tsx";
import { formatDate, formatDays, formatDue } from "../lib/format.ts";
import { useLang, useT, type MessageKey, type Translate } from "../lib/i18n.ts";
import { AudioPlayer, type MediaCache } from "../lib/media.ts";

type AvTag = AnkiTemplatePresentation["questionAvTags"][number];
import { useSettings } from "../lib/settings.ts";
import { Dialog } from "../ui/Dialog.tsx";
import { Icon } from "../ui/Icon.tsx";
import { deckOptions, Select } from "../ui/Select.tsx";

// ------------------------------------------------------------------------------------------ field editor

/**
 * Field HTML from shared decks is untrusted: it is cleaned (no scripts, handlers, frames) before it enters the
 * app's DOM, and media file names are swapped for the app's object URLs while editing (and back when saving).
 */
async function toEditable(html: string, media: MediaCache): Promise<string> {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  cleanTree(tpl.content, { restyle: false });
  for (const img of Array.from(tpl.content.querySelectorAll("img[src]"))) {
    const name = img.getAttribute("src")!;
    if (/^[a-z][a-z0-9+.-]*:/i.test(name)) {
      if (!/^(data|blob):/i.test(name)) img.removeAttribute("src");
      continue;
    }
    const url = await media.url(name);
    img.setAttribute("data-wg-media", name);
    if (url) img.setAttribute("src", url);
    else img.removeAttribute("src");
  }
  return tpl.innerHTML;
}

function fromEditable(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement;
  for (const img of Array.from(clone.querySelectorAll("img[data-wg-media]"))) {
    img.setAttribute("src", img.getAttribute("data-wg-media")!);
    img.removeAttribute("data-wg-media");
  }
  let html = clone.innerHTML;
  if (html === "<br>") html = "";
  return html;
}

export function FieldEditor(props: {
  name: string;
  value: string;
  onChange(v: string): void;
  rtl: boolean;
  autoFocus?: boolean;
  testId?: string;
  /** Drawn on an index card (Make screen) instead of a boxed field. */
  variant?: "card";
  placeholder?: string;
  /** Shows the cloze tool; returns the number for the next deletion. */
  nextCloze?(): number;
}) {
  const { media } = useApp();
  const t = useT();
  const [mode, setMode] = useState<"rich" | "html">("rich");
  const ref = useRef<HTMLDivElement>(null);
  const lastOut = useRef<string | null>(null);
  const { value } = props;

  // Load the value into the editable element unless it is the value we just produced ourselves (keeps the caret).
  useEffect(() => {
    if (mode !== "rich" || value === lastOut.current) return;
    let cancelled = false;
    void toEditable(value, media).then((h) => {
      if (!cancelled && ref.current) ref.current.innerHTML = h;
    });
    return () => {
      cancelled = true;
    };
  }, [value, mode, media]);

  useEffect(() => {
    if (props.autoFocus) ref.current?.focus();
  }, [props.autoFocus]);

  const emit = () => {
    if (!ref.current) return;
    const v = fromEditable(ref.current);
    lastOut.current = v;
    props.onChange(v);
  };
  const exec = (cmd: string) => {
    ref.current?.focus();
    document.execCommand(cmd);
    emit();
  };

  const cloze = () => {
    if (!props.nextCloze) return;
    ref.current?.focus();
    const sel = window.getSelection()?.toString() ?? "";
    document.execCommand("insertText", false, `{{c${props.nextCloze()}::${sel}}}`);
    emit();
  };

  return (
    <div className={`fe ${props.variant === "card" ? "fe-card" : ""}`} data-testid={props.testId}>
      <div className="fe-head">
        <span className="fe-name">{props.name}</span>
        <span className="fe-tools">
          {mode === "rich" && (
            <>
              <button type="button" className="tool" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("bold")} aria-label={t("editor.bold")} title={`${t("editor.bold")} (Ctrl+B)`}>
                <b>B</b>
              </button>
              <button type="button" className="tool" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("italic")} aria-label={t("editor.italic")} title={`${t("editor.italic")} (Ctrl+I)`}>
                <i>I</i>
              </button>
              <button type="button" className="tool" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("underline")} aria-label={t("editor.underline")} title={`${t("editor.underline")} (Ctrl+U)`}>
                <u>U</u>
              </button>
              {props.nextCloze && (
                <button type="button" className="tool tool-wide" onMouseDown={(e) => e.preventDefault()} onClick={cloze} aria-label={t("make.cloze")} title={`${t("make.cloze")} (Ctrl+Shift+C)`}>
                  [...]
                </button>
              )}
            </>
          )}
          <button
            type="button"
            className={`tool ${mode === "html" ? "is-on" : ""}`}
            aria-pressed={mode === "html"}
            onClick={() => {
              lastOut.current = null;
              setMode((m) => (m === "rich" ? "html" : "rich"));
            }}
            title={t(mode === "html" ? "editor.rich" : "editor.html")}
          >
            <Icon name="code" size={15} />
          </button>
        </span>
      </div>
      {mode === "rich" ? (
        <div
          ref={ref}
          className="fe-rich"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label={props.name}
          dir={props.rtl ? "rtl" : undefined}
          data-placeholder={props.placeholder}
          onInput={emit}
          onKeyDown={(e) => {
            if (props.nextCloze && (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "c") {
              e.preventDefault();
              cloze();
            }
          }}
          onPaste={(e) => {
            e.preventDefault();
            document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
          }}
        />
      ) : (
        <textarea className="fe-html" aria-label={`${props.name} (HTML)`} value={value} onChange={(e) => props.onChange(e.target.value)} spellCheck={false} rows={4} />
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------ items

export function flattenDecks(tree: DeckNode[]): DeckNode[] {
  const out: DeckNode[] = [];
  const walk = (ds: DeckNode[]) => {
    for (const d of ds) {
      out.push(d);
      walk(d.children);
    }
  };
  walk(tree);
  return out;
}

function itemName(nt: NoteType, item: ReviewItem, t: Translate): string {
  if (nt.kind === "cloze") return `Cloze ${item.ord + 1}`;
  return nt.templates[item.ord]?.name ?? t("editor.cardN", { n: item.ord + 1 });
}

function dueText(item: ReviewItem, lang: "zh" | "en", t: Translate): string {
  if (item.due.kind === "new") return t("editor.dueNew", { n: item.due.position });
  return formatDue(item.due.at, lang);
}

function ItemRow({ item, detail, decks, onChanged }: { item: ReviewItem; detail: KnowledgePointDetail; decks: DeckNode[]; onChanged(): void }) {
  const { db } = useApp();
  const t = useT();
  const lang = useLang();
  const status = item.status !== "active" ? t(`status.${item.status}` as MessageKey) : null;
  return (
    <li className="item" data-testid="item-row">
      <div className="item-main">
        <span className="item-name">{itemName(detail.noteType, item, t)}</span>
        <span className={`badge badge-${item.state}`}>{t(`state.${item.state}` as MessageKey)}</span>
        {status && <span className="badge badge-muted">{status}</span>}
        {item.flag > 0 && <span className={`flag-dot flag-bg-${item.flag}`} title={t(`flag.${item.flag}` as MessageKey)} />}
      </div>
      <dl className="item-facts">
        <div>
          <dt>{t("editor.due")}</dt>
          <dd>{dueText(item, lang, t)}</dd>
        </div>
        <div>
          <dt>{t("editor.interval")}</dt>
          <dd>{item.intervalDays ? formatDays(item.intervalDays, lang) : "—"}</dd>
        </div>
        <div>
          <dt>{t("editor.stability")}</dt>
          <dd>{item.memory ? formatDays(item.memory.stability, lang) : "—"}</dd>
        </div>
        <div>
          <dt>{t("editor.reps")}</dt>
          <dd>
            {item.reps}
            {item.lapses ? ` · ${t("editor.lapses")} ${item.lapses}` : ""}
          </dd>
        </div>
      </dl>
      <div className="item-actions">
        <Select size="sm" className="item-move" label={t("editor.moveTo")} value={item.deckId}
          options={deckOptions(decks.filter((d) => d.kind === "normal"))}
          onChange={async (v) => {
            await db.moveItems([item.id], v);
            onChanged();
          }} />
        {item.status === "buried" ? (
          <button type="button" className="btn btn-small btn-ghost" onClick={async () => (await db.unbury([item.id]), onChanged())}>
            {t("editor.unbury")}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-small btn-ghost"
            data-testid="item-suspend"
            onClick={async () => {
              await db.setSuspended([item.id], item.status !== "suspended");
              onChanged();
            }}
          >
            {t(item.status === "suspended" ? "editor.unsuspend" : "editor.suspend")}
          </button>
        )}
      </div>
    </li>
  );
}

// ------------------------------------------------------------------------------------------ preview

function Preview({ detail, item }: { detail: KnowledgePointDetail; item: ReviewItem }) {
  const app = useApp();
  const settings = useSettings();
  const t = useT();
  const [ctl, setCtl] = useState<FrameController | null>(null);
  const [side, setSide] = useState<"question" | "answer">("question");
  const audio = useMemo(() => new AudioPlayer(app.media), [app.media]);
  const av = useRef<{ q: AvTag[]; a: AvTag[] }>({ q: [], a: [] });
  const onController = useCallback(
    (c: FrameController | null) => {
      setCtl(c);
      if (c)
        c.events = {
          onPlay: (side, i) => {
            const tag = av.current[side][i];
            if (tag) void audio.play([tag]);
          },
        };
    },
    [audio],
  );
  useEffect(() => () => audio.stop(), [audio]);
  useEffect(() => {
    if (!ctl) return;
    let cancelled = false;
    void (async () => {
      const p = await app.db.renderItem(item.id);
      const prepared = prepareFor(app, settings, t, p, detail.noteTypeId, detail.fields, item.ord);
      const files = await app.media.get(prepared.media);
      av.current = { q: prepared.questionAv, a: prepared.answerAv };
      if (!cancelled) await ctl.show(frameCard(prepared, files, side));
    })();
    return () => {
      cancelled = true;
    };
  }, [ctl, item, detail, side, app, settings, t]);
  return (
    <div className="preview">
      <div className="seg" role="tablist" aria-label={t("editor.preview")}>
        {(["question", "answer"] as const).map((s) => (
          <button key={s} type="button" role="tab" aria-selected={side === s} className={side === s ? "is-on" : ""} onClick={() => setSide(s)}>
            {t(`editor.side.${s}`)}
          </button>
        ))}
      </div>
      <CardFrame onController={onController} className="preview-frame" testId="preview-frame" />
    </div>
  );
}

// ------------------------------------------------------------------------------------------ note editor

export function NoteEditor(props: { noteId: Id; onSaved?(): void; onDeleted?(): void; full?: boolean; onDirty?(dirty: boolean): void }) {
  const app = useApp();
  const { db, changed, toast } = app;
  const t = useT();
  const lang = useLang();
  const [detail, setDetail] = useState<KnowledgePointDetail | null>(null);
  const [fields, setFields] = useState<string[]>([]);
  const [tags, setTags] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [decks, setDecks] = useState<DeckNode[]>([]);
  const [previewItem, setPreviewItem] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { noteId, onDirty } = props;

  /** Counts edits, so a reload after saving never throws away what was typed meanwhile. */
  const edits = useRef(0);
  const load = useCallback(
    async (since?: number) => {
      const [d, tree] = await Promise.all([db.getKnowledgePoint(noteId), props.full ? db.deckTree() : Promise.resolve([])]);
      setDetail(d);
      setDecks(flattenDecks(tree));
      if (d && (since === undefined || since === edits.current)) {
        setFields(d.fields);
        setTags(d.tags.join(" "));
        setDirty(false);
      }
    },
    [db, noteId, props.full],
  );

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => onDirty?.(dirty), [dirty, onDirty]);

  const save = useCallback(async () => {
    if (!detail || !dirty) return;
    setSaving(true);
    const at = edits.current;
    try {
      const tagList = tags.split(/\s+/).filter(Boolean);
      await db.updateKnowledgePoint({ id: detail.id, fields, tags: tagList });
      if (edits.current === at) setDirty(false);
      await changed();
      toast(t("common.saved"));
      await load(at);
      props.onSaved?.();
    } finally {
      setSaving(false);
    }
  }, [detail, dirty, tags, fields, db, changed, toast, t, load, props]);

  const itemsChanged = useCallback(async () => {
    await changed();
    await load(dirty ? -1 : edits.current);
  }, [changed, load, dirty]);

  if (!detail) return <div className="editor" aria-busy="true" />;
  const nt = detail.noteType;

  return (
    <div
      className="editor"
      data-testid="note-editor"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "Enter")) {
          e.preventDefault();
          void save();
        }
      }}
    >
      <div className="editor-meta">
        <span className="pill">{nt.name}</span>
        <span className="muted small">
          {t("editor.created", { date: formatDate(detail.createdAt, lang) })} · {t("editor.modified", { date: formatDate(detail.modifiedAt, lang) })}
        </span>
      </div>
      <section className="editor-fields" aria-label={t("editor.fields")}>
        {detail.fieldNames.map((name, i) => (
          <FieldEditor
            key={`${detail.id}-${i}`}
            name={name}
            value={fields[i] ?? ""}
            rtl={nt.fields[i]?.rtl ?? false}
            autoFocus={!props.full && i === 0}
            testId={`field-${i}`}
            onChange={(v) => {
              edits.current++;
              setFields((f) => f.map((x, j) => (j === i ? v : x)));
              setDirty(true);
            }}
          />
        ))}
        <label className="field">
          <span className="field-label">{t("editor.tags")}</span>
          <input
            className="input"
            value={tags}
            placeholder={t("editor.tagsHint")}
            data-testid="tags-input"
            onChange={(e) => {
              edits.current++;
              setTags(e.target.value);
              setDirty(true);
            }}
          />
        </label>
      </section>
      <div className="editor-save">
        <span className="muted small" aria-live="polite">
          {dirty ? t("editor.unsaved") : ""}
        </span>
        <button type="button" className="btn btn-primary" disabled={!dirty || saving} onClick={() => void save()} title={t("editor.saveShortcut")} data-testid="save-note">
          {t("common.save")}
        </button>
      </div>

      {props.full && (
        <>
          <section className="editor-section">
            <h3 className="section-label">{t("editor.cards")}</h3>
            <ul className="items">
              {detail.items.map((it) => (
                <ItemRow key={it.id} item={it} detail={detail} decks={decks} onChanged={() => void itemsChanged()} />
              ))}
            </ul>
          </section>
          {detail.items.length > 0 && (
            <section className="editor-section">
              <div className="section-label-row">
                <h3 className="section-label">{t("editor.preview")}</h3>
                {detail.items.length > 1 && (
                  <Select size="sm" label={t("editor.cards")} value={previewItem}
                    options={detail.items.map((it, i) => ({ value: i, label: itemName(nt, it, t) }))}
                    onChange={setPreviewItem} />
                )}
              </div>
              <Preview detail={detail} item={detail.items[Math.min(previewItem, detail.items.length - 1)]!} />
            </section>
          )}
          <section className="editor-section editor-danger">
            <button type="button" className="btn btn-ghost btn-danger" onClick={() => setConfirmDelete(true)} data-testid="delete-note">
              <Icon name="trash" /> {t("editor.deleteNote")}
            </button>
          </section>
          <Dialog
            open={confirmDelete}
            title={t("editor.deleteNote")}
            onClose={() => setConfirmDelete(false)}
            width="sm"
            footer={
              <>
                <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(false)} autoFocus>
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  className="btn btn-danger-solid"
                  data-testid="confirm-delete"
                  onClick={async () => {
                    setConfirmDelete(false);
                    await db.deleteKnowledgePoints([detail.id]);
                    await changed();
                    toast(t("editor.deleted"), {
                      label: t("common.undo"),
                      run: async () => {
                        await db.undo();
                        await changed();
                      },
                    });
                    props.onDeleted?.();
                  }}
                >
                  {t("common.delete")}
                </button>
              </>
            }
          >
            <p>{t("editor.deleteConfirm", { n: detail.items.length })}</p>
          </Dialog>
        </>
      )}
    </div>
  );
}

export function EditNoteDialog(props: { noteId: Id; onClose(): void; onSaved(): void }) {
  const t = useT();
  const [dirty, setDirty] = useState(false);
  const close = () => {
    if (dirty && !confirm(t("editor.leaveUnsaved"))) return;
    props.onClose();
  };
  return (
    <Dialog open title={t("review.edit")} onClose={close} width="lg">
      <NoteEditor noteId={props.noteId} onSaved={props.onSaved} onDirty={setDirty} />
    </Dialog>
  );
}
