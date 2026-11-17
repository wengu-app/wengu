import { useEffect, useRef, useState } from "react";
import type { ImportPhase, ImportProgress, ImportResult } from "@wengu/core";

import { navigate, useApp } from "../lib/app.tsx";
import { useLang, useT, type MessageKey } from "../lib/i18n.ts";
import { formatNumber } from "../lib/format.ts";
import { Dialog } from "../ui/Dialog.tsx";
import { Icon } from "../ui/Icon.tsx";

export function isAnkiFile(f: File): boolean {
  return /\.(apkg|colpkg)$/i.test(f.name);
}

const PHASES: ImportPhase[] = ["reading", "note-types", "decks", "knowledge-points", "review-items", "review-log", "media", "finishing"];
/** Rough share of the total time each phase takes, for one progress bar. */
const WEIGHT: Record<ImportPhase, number> = { reading: 12, "note-types": 2, decks: 2, "knowledge-points": 30, "review-items": 22, "review-log": 18, media: 12, finishing: 2 };

function overall(p: ImportProgress | null): number {
  if (!p) return 0;
  const i = PHASES.indexOf(p.phase);
  const total = PHASES.reduce((a, ph) => a + WEIGHT[ph], 0);
  const before = PHASES.slice(0, i).reduce((a, ph) => a + WEIGHT[ph], 0);
  const frac = p.total > 0 ? Math.min(1, p.done / p.total) : 0;
  return (before + WEIGHT[p.phase] * frac) / total;
}

type State = { kind: "idle" } | { kind: "running"; progress: ImportProgress | null } | { kind: "done"; result: ImportResult } | { kind: "error"; message: string };

export function ImportDialog(props: { open: boolean; file: File | null; onClose(): void }) {
  const { db, changed, openImport } = useApp();
  const t = useT();
  const lang = useLang();
  const [state, setState] = useState<State>({ kind: "idle" });
  const started = useRef(false);
  const { file, open } = props;

  useEffect(() => {
    if (!open || !file || started.current) return;
    started.current = true;
    if (!isAnkiFile(file)) {
      setState({ kind: "error", message: t("import.wrongType") });
      return;
    }
    setState({ kind: "running", progress: null });
    (async () => {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const result = await db.importAnki(bytes, { onProgress: (p) => setState({ kind: "running", progress: p }) });
        await changed(true);
        setState({ kind: "done", result });
      } catch (e) {
        setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      }
    })();
  }, [open, file, db, changed, t]);

  const running = state.kind === "running";
  const n = (v: number) => formatNumber(v, lang);
  const title = state.kind === "done" ? t("import.done", { file: file?.name ?? "" }) : t("import.title");

  return (
    <Dialog
      open={props.open}
      title={title}
      onClose={props.onClose}
      locked={running}
      width="md"
      footer={
        state.kind === "done" ? (
          <>
            <button type="button" className="btn btn-ghost" onClick={() => (props.onClose(), openImport())}>
              {t("import.another")}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              autoFocus
              onClick={() => {
                props.onClose();
                navigate({ name: "decks" });
              }}
            >
              {t("import.start")}
            </button>
          </>
        ) : state.kind === "error" ? (
          <button type="button" className="btn btn-ghost" onClick={props.onClose}>
            {t("common.close")}
          </button>
        ) : null
      }
    >
      {running && (
        <div className="import-progress" data-testid="import-progress">
          <p className="import-file">
            <Icon name="file" /> {file?.name}
          </p>
          <div
            className="progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(overall(state.progress) * 100)}
            aria-label={t("import.title")}
          >
            <div className="progress-bar" style={{ transform: `scaleX(${Math.max(0.02, overall(state.progress))})` }} />
          </div>
          <p className="muted small">
            {state.progress ? t(`import.phase.${state.progress.phase}` as MessageKey) : t("import.reading")}
            {state.progress && state.progress.total > 1 ? ` · ${n(state.progress.done)} / ${n(state.progress.total)}` : ""}
          </p>
        </div>
      )}
      {state.kind === "error" && (
        <div className="callout callout-error" role="alert">
          <Icon name="warning" />
          <div>
            <p className="strong">{t("import.failed")}</p>
            <p className="muted small break">{state.message}</p>
          </div>
        </div>
      )}
      {state.kind === "done" && <Summary result={state.result} />}
    </Dialog>
  );
}

function Summary({ result: r }: { result: ImportResult }) {
  const t = useT();
  const lang = useLang();
  const n = (v: number) => formatNumber(v, lang);
  const parts = (items: [MessageKey, number][]) =>
    items
      .filter(([, v], i) => v > 0 || i === 0)
      .map(([k, v]) => t(k, { n: n(v) }))
      .join(" · ");
  const rows: [MessageKey, string][] = [
    ["import.notes", parts([["import.added", r.knowledgePoints.added], ["import.updated", r.knowledgePoints.updated], ["import.unchanged", r.knowledgePoints.unchanged]])],
    ["import.cards", parts([["import.added", r.reviewItems.added], ["import.kept", r.reviewItems.kept]])],
    ["import.reviews", parts([["import.added", r.reviewLog.added], ["import.duplicates", r.reviewLog.duplicates]])],
    ["import.media", parts([["import.added", r.media.added], ["import.unchanged", r.media.unchanged], ["import.renamed", r.media.renamed]])],
    ["import.decks", parts([["import.added", r.decks.added], ["import.reused", r.decks.reused]])],
    ["import.noteTypes", parts([["import.added", r.noteTypes.added], ["import.reused", r.noteTypes.reused]])],
  ];
  return (
    <div className="import-summary" data-testid="import-summary">
      <dl className="summary-list">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{t(k)}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="muted small">{t("import.took", { s: (r.durationMs / 1000).toFixed(1) })}</p>
      {r.warnings.length ? (
        <details className="warnings">
          <summary>{t("import.warnings", { n: r.warnings.length })}</summary>
          <ul>
            {r.warnings.slice(0, 200).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      ) : (
        <p className="muted small">
          <Icon name="check" /> {t("import.noWarnings")}
        </p>
      )}
    </div>
  );
}
