import { DesktopUpdate } from "../ui/DesktopUpdate.tsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { QueueCounts, Rating, RatingName, ReviewCard, Stats, StudyState } from "@wengu/core";

import { CardFrame } from "../card/CardFrame.tsx";
import type { FrameController } from "../card/frameController.ts";
import { frameCard, prepareFor, reasonText, templateOf } from "../card/prepare.ts";
import type { FrameKey } from "../frame/protocol.ts";
import { useApp } from "../lib/app.tsx";
import type { PreparedCard } from "../lib/cardPrep.ts";
import { formatDuration, formatNumber, formatTime } from "../lib/format.ts";
import { undoLabelText, useLang, useT, type MessageKey } from "../lib/i18n.ts";
import { AudioPlayer } from "../lib/media.ts";
import { updateSettings, useSettings, type NoteTypeMode } from "../lib/settings.ts";
import { compareAnswer } from "../lib/typeans.ts";
import { deckColor } from "../lib/theme.ts";
import { Dialog } from "../ui/Dialog.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Menu } from "../ui/Menu.tsx";
import { EditNoteDialog } from "./Editor.tsx";
import { WhyPanel } from "./WhyPanel.tsx";

const RATINGS: { rating: Rating; name: RatingName; key: MessageKey }[] = [
  { rating: 1, name: "again", key: "review.again" },
  { rating: 2, name: "hard", key: "review.hard" },
  { rating: 3, name: "good", key: "review.good" },
  { rating: 4, name: "easy", key: "review.easy" },
];

type View =
  | { kind: "loading" }
  | { kind: "card"; card: ReviewCard; prepared: PreparedCard; side: "question" | "answer"; counts: QueueCounts; undoLabel: string | null }
  | { kind: "done"; counts: QueueCounts; nextLearningDueAt: number | null; undoLabel: string | null; stats: Stats | null }
  | { kind: "error"; message: string };

function queueOf(card: ReviewCard): keyof QueueCounts {
  const s = card.item.state;
  return s === "new" ? "new" : s === "review" ? "review" : "learning";
}

export function Review({ deckId, onExit }: { deckId: number | null; onExit(): void }) {
  const app = useApp();
  const { db, media } = app;
  const settings = useSettings();
  const t = useT();
  const lang = useLang();
  const [view, setView] = useState<View>({ kind: "loading" });
  const [answered, setAnswered] = useState(0);
  const [editing, setEditing] = useState<number | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [ctlReady, setCtlReady] = useState(false);

  const ctl = useRef<FrameController | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const busy = useRef(false);
  const typed = useRef("");
  const shownAt = useRef(0);
  const history = useRef<ReviewCard[]>([]);
  const pendingLatency = useRef<{ seq: number; t0: number } | null>(null);
  const audio = useMemo(() => new AudioPlayer(media), [media]);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const appRef = useRef(app);
  appRef.current = app;

  useEffect(() => () => audio.stop(), [audio]);

  /** Shows a card on the frame. `t0`: when the user rated the previous card (latency measurement). */
  const showCard = useCallback(
    async (card: ReviewCard, counts: QueueCounts, undoLabel: string | null, side: "question" | "answer" = "question", t0?: number) => {
      const c = ctl.current;
      const tpl = templateOf(card.presentation);
      if (!c || !tpl) {
        setView({ kind: "error", message: `unsupported presentation: ${card.presentation.kind}` });
        return;
      }
      const prepared = prepareFor(appRef.current, settingsRef.current, t, tpl, card.knowledgePoint.noteTypeId, card.knowledgePoint.fields, card.item.ord);
      const files = prepared.media.length ? await media.get(prepared.media) : {};
      typed.current = "";
      audio.stop();
      const seq = await c.show(frameCard(prepared, files, side));
      if (t0 !== undefined) pendingLatency.current = { seq, t0 };
      shownAt.current = performance.now();
      setView({ kind: "card", card, prepared, side, counts, undoLabel });
      if (settingsRef.current.autoplay) void audio.play(side === "question" ? prepared.questionAv : prepared.answerAv);
    },
    [media, audio, t],
  );

  const showState = useCallback(
    async (s: StudyState, t0?: number) => {
      if (s.card) {
        await showCard(s.card, s.counts, s.undoLabel, "question", t0);
        return;
      }
      ctl.current?.clear();
      audio.stop();
      setView({ kind: "done", counts: s.counts, nextLearningDueAt: s.nextLearningDueAt, undoLabel: s.undoLabel, stats: null });
      const stats = await db.stats({ days: 1 }).catch(() => null);
      setView((v) => (v.kind === "done" ? { ...v, stats } : v));
    },
    [showCard, audio, db],
  );

  const load = useCallback(async () => {
    try {
      await showState(await db.study(deckId));
    } catch (e) {
      setView({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [db, deckId, showState]);

  useEffect(() => {
    if (ctlReady) void load();
  }, [ctlReady, load]);

  // MathJax is large: load it into the frame when the reviewer is idle, so the first math card is not slow.
  useEffect(() => {
    if (!ctlReady) return;
    const id = setTimeout(() => void ctl.current?.preloadMath(), 400);
    return () => clearTimeout(id);
  }, [ctlReady]);

  // Done, but learning cards come back later today: pick them up when they are due.
  useEffect(() => {
    if (view.kind !== "done" || view.nextLearningDueAt === null) return;
    const ms = Math.max(1000, view.nextLearningDueAt - Date.now() + 500);
    const id = setTimeout(() => void load(), Math.min(ms, 2 ** 31 - 1));
    return () => clearTimeout(id);
  }, [view, load]);

  // Card style changed in settings (or from the chip): show the current card again in the new mode.
  const modeKey = `${settings.renderDefault}|${JSON.stringify(settings.noteTypeModes)}`;
  const lastModeKey = useRef(modeKey);
  useEffect(() => {
    if (lastModeKey.current === modeKey) return;
    lastModeKey.current = modeKey;
    const v = viewRef.current;
    if (v.kind === "card") void showCard(v.card, v.counts, v.undoLabel, v.side);
  }, [modeKey, showCard]);

  // ---------------------------------------------------------------------------------------- actions

  const reveal = useCallback(() => {
    const v = viewRef.current;
    if (v.kind !== "card" || v.side !== "question" || !ctl.current) return;
    const p = v.prepared;
    const compare = p.typeSpec && p.expected !== null ? compareAnswer(typed.current, p.expected, p.typeSpec.nc).html : null;
    ctl.current.reveal(compare);
    setView({ ...v, side: "answer" });
    if (settingsRef.current.autoplay) void audio.play(p.answerAv);
  }, [audio]);

  const rate = useCallback(
    async (rating: Rating) => {
      const v = viewRef.current;
      if (v.kind !== "card" || v.side !== "answer" || busy.current) return;
      busy.current = true;
      const t0 = performance.now();
      try {
        const takenMs = Math.round(t0 - shownAt.current);
        history.current.push(v.card);
        if (history.current.length > 50) history.current.shift();
        const next = await db.answer({ itemId: v.card.item.id, rating, takenMs, deckId });
        window.__wenguPerf?.answerRpc.push(performance.now() - t0);
        setAnswered((n) => n + 1);
        await showState(next, t0);
      } catch (e) {
        setView({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      } finally {
        busy.current = false;
      }
    },
    [db, deckId, showState],
  );

  const undo = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const r = await db.undo();
      if (!r) {
        app.toast(t("review.nothingToUndo"));
        return;
      }
      app.toast(t("review.undone", { label: undoLabelText(r.label, t) }));
      const s = await db.study(deckId);
      const prev = history.current[history.current.length - 1];
      if (r.label.startsWith("Answer") && prev && r.itemIds.includes(prev.item.id)) {
        // Show the card that was just answered again (study() would pick whatever is first in the queue).
        history.current.pop();
        const schedule = await db.explain(prev.item.id);
        setAnswered((n) => Math.max(0, n - 1));
        await showCard({ ...prev, schedule }, s.counts, s.undoLabel);
      } else {
        await showState(s);
      }
    } finally {
      busy.current = false;
    }
  }, [db, deckId, app, t, showCard, showState]);

  const act = useCallback(
    async (kind: "suspend" | "bury") => {
      const v = viewRef.current;
      if (v.kind !== "card" || busy.current) return;
      busy.current = true;
      try {
        const id = v.card.item.id;
        if (kind === "suspend") await db.setSuspended([id], true);
        else await db.bury([id]);
        app.toast(t(kind === "suspend" ? "review.suspended" : "review.buried"), { label: t("common.undo"), run: () => void undo() });
        await showState(await db.study(deckId));
      } finally {
        busy.current = false;
      }
    },
    [db, deckId, app, t, showState, undo],
  );

  const setFlag = useCallback(
    async (flag: number) => {
      const v = viewRef.current;
      if (v.kind !== "card") return;
      const next = v.card.item.flag === flag ? 0 : flag;
      await db.setFlag([v.card.item.id], next);
      const cur = viewRef.current;
      if (cur.kind === "card" && cur.card.item.id === v.card.item.id) {
        setView({ ...cur, card: { ...cur.card, item: { ...cur.card.item, flag: next } }, undoLabel: "Flag" });
      }
      app.toast(t(next ? "review.flagged" : "review.unflagged"));
    },
    [db, app, t],
  );

  const replay = useCallback(() => {
    const v = viewRef.current;
    if (v.kind !== "card") return;
    void audio.play(v.side === "question" ? v.prepared.questionAv : v.prepared.answerAv);
  }, [audio]);

  const afterEdit = useCallback(async () => {
    const v = viewRef.current;
    setEditing(null);
    if (v.kind !== "card") return;
    const [presentation, kp] = await Promise.all([db.renderItem(v.card.item.id), db.getKnowledgePoint(v.card.knowledgePoint.id)]);
    media.invalidate();
    if (!kp) return void load();
    const card: ReviewCard = { ...v.card, presentation, knowledgePoint: { ...v.card.knowledgePoint, fields: kp.fields, tags: kp.tags } };
    await showCard(card, v.counts, "Edit", v.side);
  }, [db, media, showCard, load]);

  // ---------------------------------------------------------------------------------------- keyboard

  const onKey = useCallback(
    (e: FrameKey, inFrameInput = false): boolean => {
      const v = viewRef.current;
      const k = e.key;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey && /^[1-7]$/.test(k)) return void setFlag(Number(k)), true;
      if (mod && (k === "z" || k === "Z")) return void undo(), true;
      if (mod || e.altKey) return false;
      if (inFrameInput && k !== "Enter") return false;
      switch (k) {
        case " ":
        case "Enter":
          if (v.kind === "card" && v.side === "question") reveal();
          else if (v.kind === "card" && v.side === "answer" && !inFrameInput) void rate(3);
          return true;
        case "1":
        case "2":
        case "3":
        case "4":
          void rate(Number(k) as Rating);
          return true;
        case "z":
          void undo();
          return true;
        case "e":
          if (v.kind === "card") setEditing(v.card.knowledgePoint.id);
          return true;
        case "@":
          void act("suspend");
          return true;
        case "-":
          void act("bury");
          return true;
        case "r":
        case "F5":
          replay();
          return true;
        case "i":
          updateSettings((s) => ({ whyOpen: !s.whyOpen }));
          return true;
        case "?":
          setHelpOpen(true);
          return true;
        case "Escape":
          onExit();
          return true;
      }
      return false;
    },
    [reveal, rate, undo, act, replay, setFlag, onExit],
  );
  const onKeyRef = useRef(onKey);
  onKeyRef.current = onKey;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (document.querySelector("dialog[open]")) return;
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.tagName === "SELECT" || tgt.isContentEditable)) return;
      if ((e.key === " " || e.key === "Enter") && tgt?.tagName === "BUTTON" && !tgt.closest(".review-actions")) return;
      if (onKeyRef.current(e)) e.preventDefault();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const onController = useCallback((c: FrameController | null) => {
    ctl.current = c;
    setCtlReady(!!c);
    if (!c) return;
    c.events = {
      onShown(seq, side) {
        const p = pendingLatency.current;
        if (p && p.seq === seq && side === "question") {
          const ms = performance.now() - p.t0;
          window.__wenguPerf?.answerToNext.push(ms);
          pendingLatency.current = null;
        }
        const stage = document.querySelector<HTMLElement>(".review-stage");
        if (stage) {
          stage.dataset.shownSeq = String(seq);
          stage.dataset.shownSide = side;
        }
      },
      onKey(m) {
        if (document.querySelector("dialog[open]")) return;
        onKeyRef.current(m.ev, m.inInput);
      },
      onPlay(side, index) {
        const v = viewRef.current;
        if (v.kind !== "card") return;
        const tag = (side === "q" ? v.prepared.questionAv : v.prepared.answerAv)[index];
        if (tag) void audio.play([tag]);
      },
      onTyped(_seq, value) {
        typed.current = value;
      },
    };
  }, [audio]);

  // ---------------------------------------------------------------------------------------- render

  const counts = view.kind === "card" || view.kind === "done" ? view.counts : null;
  const remaining = counts ? counts.new + counts.learning + counts.review : 0;
  const progress = answered + remaining > 0 ? answered / (answered + remaining) : 0;
  const card = view.kind === "card" ? view.card : null;
  const whyOpen = settings.whyOpen && view.kind === "card";
  const ntId = card?.knowledgePoint.noteTypeId;
  const ntMode: NoteTypeMode = ntId !== undefined ? (settings.noteTypeModes[String(ntId)] ?? "auto") : "auto";
  const setNtMode = (m: NoteTypeMode) => {
    if (ntId === undefined) return;
    updateSettings((s) => {
      const next = { ...s.noteTypeModes };
      if (m === "auto") delete next[String(ntId)];
      else next[String(ntId)] = m;
      return { noteTypeModes: next };
    });
  };
  const n = (v: number) => formatNumber(v, lang);

  return (
    <div
      className={`review ${whyOpen ? "review-why" : ""}`}
      data-testid="review"
      data-phase={view.kind === "card" ? view.side : view.kind}
      style={card ? ({ "--pc": deckColor(card.deckName)[0] } as React.CSSProperties) : undefined}
    >
      <header className="review-bar">
        <button type="button" className="review-exit" onClick={onExit} aria-label={t("review.exit")} title={`${t("review.exit")} (Esc)`}>
          <Icon name="chevronLeft" />
          <kbd>Esc</kbd>
        </button>
        <span className="review-deck" title={card?.deckName}>
          {card && <i className="review-deck-dot" aria-hidden="true" />}
          {card?.deckName.split("::").pop() ?? ""}
        </span>
        <div className="session-progress" aria-hidden="true">
          <div style={{ transform: `scaleX(${progress})` }} />
        </div>
        {counts && (
          <span className="review-counts" aria-label={t("review.remaining", { new: counts.new, learning: counts.learning, review: counts.review })} data-testid="review-counts">
            {(["new", "learning", "review"] as const).map((q) => (
              <span key={q} className={`count c-${q === "learning" ? "learn" : q} ${card && queueOf(card) === q ? "count-current" : ""}`}>
                {n(counts[q])}
              </span>
            ))}
          </span>
        )}
        {view.kind === "card" && (
          <>
            <Menu
              className="mode-menu"
              label={t("review.mode.switch")}
              trigger={
                <span className="chip" data-testid="mode-chip" data-mode={view.prepared.decision.mode}>
                  {t(view.prepared.decision.mode === "wengu" ? "review.mode.wengu" : "review.mode.original")}
                </span>
              }
              items={[
                { label: `${t("settings.nt.auto")}${ntMode === "auto" ? " ✓" : ""}`, onSelect: () => setNtMode("auto") },
                { label: `${t("review.mode.wengu")}${ntMode === "wengu" ? " ✓" : ""}`, onSelect: () => setNtMode("wengu") },
                { label: `${t("review.mode.original")}${ntMode === "original" ? " ✓" : ""}`, onSelect: () => setNtMode("original") },
              ]}
            />
            <Menu
              label={t("review.flag")}
              trigger={<Icon name="flag" className={`flag-${view.card.item.flag}`} />}
              items={[1, 2, 3, 4, 5, 6, 7, 0].map((f) => ({
                label: t(`flag.${f}` as MessageKey) + (view.card.item.flag === f && f ? " ✓" : ""),
                icon: <span className={`flag-dot flag-bg-${f}`} />,
                hint: f ? `Ctrl+${f}` : undefined,
                onSelect: () => void setFlag(f || view.card.item.flag),
              }))}
            />
            <button
              type="button"
              className={`icon-btn ${settings.whyOpen ? "is-on" : ""}`}
              aria-pressed={settings.whyOpen}
              onClick={() => updateSettings((s) => ({ whyOpen: !s.whyOpen }))}
              title={`${t("review.why")} (I)`}
              aria-label={t("review.why")}
              data-testid="why-toggle"
            >
              <Icon name="info" />
            </button>
          </>
        )}
        <Menu
          label={t("common.more")}
          trigger={<Icon name="more" />}
          items={[
            { label: t("review.undo"), hint: "Z", disabled: !((view.kind === "card" || view.kind === "done") && view.undoLabel), onSelect: () => void undo() },
            { label: t("review.edit"), hint: "E", disabled: !card, onSelect: () => card && setEditing(card.knowledgePoint.id) },
            { label: t("review.suspend"), hint: "@", disabled: !card, onSelect: () => void act("suspend") },
            { label: t("review.bury"), hint: "-", disabled: !card, onSelect: () => void act("bury") },
            { label: t("review.replay"), hint: "R", disabled: view.kind !== "card" || (!view.prepared.questionAv.length && !view.prepared.answerAv.length), onSelect: replay },
            { label: t("review.shortcuts"), hint: "?", onSelect: () => setHelpOpen(true) },
          ]}
        />
        <DesktopUpdate />
      </header>

      <div className="review-body">
        <div className="review-stage">
          <div className={`paper ${view.kind === "card" ? "" : "is-hidden"}`}>
            <CardFrame onController={onController} className={view.kind === "card" ? "" : "is-hidden"} />
          </div>
          {view.kind === "card" && view.prepared.decision.mode === "original" && view.prepared.decision.reason.kind !== "default" && (
            <p className="mode-note" data-testid="mode-note">
              {t("review.mode.reason", { reason: reasonText(view.prepared.decision.reason, t) })}
            </p>
          )}
          {view.kind === "done" && <Done view={view} onExit={onExit} />}
          {view.kind === "error" && (
            <div className="center-note" role="alert">
              <p>{t("common.error")}</p>
              <p className="muted small break">{view.message}</p>
              <button type="button" className="btn btn-ghost" onClick={() => void load()}>
                {t("common.retry")}
              </button>
            </div>
          )}
        </div>
        {whyOpen && view.kind === "card" && <WhyPanel card={view.card} onClose={() => updateSettings({ whyOpen: false })} />}
      </div>

      {view.kind === "card" && (
        <footer className="review-actions">
          {view.side === "question" ? (
            <button type="button" className="btn btn-reveal" onClick={reveal} data-testid="reveal">
              {t("review.show")}
              <kbd>Space</kbd>
            </button>
          ) : (
            <div className="ratings" role="group" aria-label={t("review.why")}>
              {RATINGS.map((r) => {
                const o = view.card.schedule.outcomes[r.name];
                return (
                  <button
                    key={r.name}
                    type="button"
                    className={`rate rate-${r.name}`}
                    onClick={() => void rate(r.rating)}
                    data-testid={`rate-${r.name}`}
                    aria-keyshortcuts={String(r.rating)}
                  >
                    <span className="rate-ivl" data-testid={`ivl-${r.name}`}>
                      {o.label}
                    </span>
                    <span className="rate-name">{t(r.key)}</span>
                    <kbd>{r.rating}</kbd>
                  </button>
                );
              })}
            </div>
          )}
        </footer>
      )}

      {editing !== null && <EditNoteDialog noteId={editing} onClose={() => setEditing(null)} onSaved={() => void afterEdit()} />}
      <ShortcutsDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}

function Done({ view, onExit }: { view: Extract<View, { kind: "done" }>; onExit(): void }) {
  const t = useT();
  const lang = useLang();
  return (
    <div className="done" data-testid="done">
      <Trophy />
      <h1 className="done-title">{t("review.doneTitle")}</h1>
      <p className="done-body">{t("review.doneBody")}</p>
      {view.stats && view.stats.today.reviews > 0 && (
        <div className="done-tiles">
          <div className="done-tile done-tile-good">
            <span>{t("home.reviewed")}</span>
            <b>{formatNumber(view.stats.today.reviews, lang)}</b>
          </div>
          <div className="done-tile done-tile-easy">
            <span>{t("home.time")}</span>
            <b>{formatDuration(view.stats.today.timeMs, t)}</b>
          </div>
          <div className="done-tile done-tile-accent">
            <span>{t("review.doneRemembered")}</span>
            <b>{formatNumber(Math.round(((view.stats.today.byRating[1] + view.stats.today.byRating[2] + view.stats.today.byRating[3]) / Math.max(1, view.stats.today.byRating.reduce((a, b) => a + b, 0))) * 100), lang)}%</b>
          </div>
        </div>
      )}
      {view.nextLearningDueAt !== null && <p className="muted small">{t("review.doneLearning", { time: formatTime(view.nextLearningDueAt, lang) })}</p>}
      <button type="button" className="btn btn-primary btn-lg" onClick={onExit} autoFocus>
        {t("review.backToDecks")}
      </button>
    </div>
  );
}

function Trophy() {
  return (
    <svg className="trophy" width="120" height="120" viewBox="0 0 140 140" aria-hidden="true">
      <circle cx="70" cy="70" r="66" fill="#f7b500" opacity=".14" />
      <path d="M44 30h52v22c0 15-11.6 27-26 27S44 67 44 52z" fill="#f7b500" />
      <path d="M44 30h52v8H44z" fill="#d38f00" opacity=".35" />
      <path d="M44 38H32v6c0 9 6 15 14 16M96 38h12v6c0 9-6 15-14 16" fill="none" stroke="#d38f00" strokeWidth="7" strokeLinecap="round" />
      <path d="M62 78h16v14H62z" fill="#d38f00" />
      <rect x="48" y="92" width="44" height="14" rx="5" fill="#f7b500" />
      <path d="m70 40 4.3 8.7 9.6 1.4-7 6.8 1.7 9.5-8.6-4.5-8.6 4.5 1.7-9.5-7-6.8 9.6-1.4z" fill="#fff" />
    </svg>
  );
}

function ShortcutsDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const t = useT();
  const rows: [string, MessageKey][] = [
    ["Space / Enter", "keys.reveal"],
    ["1 2 3 4", "keys.rate"],
    ["Space / Enter", "keys.good"],
    ["Z · Ctrl+Z", "keys.undo"],
    ["E", "keys.edit"],
    ["@", "keys.suspend"],
    ["-", "keys.bury"],
    ["Ctrl+1…7", "keys.flag"],
    ["R", "keys.replay"],
    ["I", "keys.why"],
    ["Esc", "keys.exit"],
    ["?", "keys.help"],
  ];
  return (
    <Dialog open={open} title={t("keys.title")} onClose={onClose} width="sm">
      <dl className="keys">
        {rows.map(([k, label], i) => (
          <div key={i}>
            <dt>
              {k.split(" ").map((p, j) => (p === "/" || p === "·" ? ` ${p} ` : <kbd key={j}>{p}</kbd>))}
            </dt>
            <dd>{t(label)}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
