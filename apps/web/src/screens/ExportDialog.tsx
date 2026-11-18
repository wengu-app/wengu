import { useEffect, useState } from "react";
import type { DeckNode, ExportOptions, Id } from "@wengu/core";

import { useApp } from "../lib/app.tsx";
import { formatBytes } from "../lib/format.ts";
import { useLang, useT } from "../lib/i18n.ts";
import { Dialog } from "../ui/Dialog.tsx";
import { Icon } from "../ui/Icon.tsx";
import { deckOptions, Select } from "../ui/Select.tsx";
import { flattenDecks } from "./Editor.tsx";

function fileName(deck: DeckNode | undefined): string {
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const base = deck ? deck.name.replace(/::/g, " - ").replace(/[\\/:*?"<>|]+/g, "_").trim() : "wengu";
  return `${base} ${date}.apkg`;
}

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

type State = { kind: "form" } | { kind: "working" } | { kind: "done"; blob: Blob; name: string } | { kind: "error"; message: string };

export function ExportDialog(props: { open: boolean; deckId: Id | null; onClose(): void }) {
  const { db } = useApp();
  const t = useT();
  const lang = useLang();
  const [decks, setDecks] = useState<DeckNode[]>([]);
  const [scope, setScope] = useState<"all" | "deck">("all");
  const [deckId, setDeckId] = useState<Id | null>(null);
  const [withProgress, setWithProgress] = useState(true);
  const [withMedia, setWithMedia] = useState(true);
  const [state, setState] = useState<State>({ kind: "form" });

  useEffect(() => {
    if (!props.open) return;
    setState({ kind: "form" });
    setScope(props.deckId !== null ? "deck" : "all");
    void db.deckTree().then((tree) => {
      const flat = flattenDecks(tree).filter((d) => !(d.id === 1 && d.totalItems === 0 && d.children.length === 0));
      setDecks(flat);
      setDeckId(props.deckId ?? flat[0]?.id ?? null);
    });
  }, [props.open, props.deckId, db]);

  const run = async () => {
    setState({ kind: "working" });
    try {
      const options: ExportOptions = { includeScheduling: withProgress, includeMedia: withMedia };
      if (scope === "deck" && deckId !== null) options.deckId = deckId;
      const blob = typeof db.exportApkgFile === "function" ? await db.exportApkgFile(options) : new Blob([(await db.exportApkg(options)) as BlobPart]);
      const name = fileName(scope === "deck" ? decks.find((d) => d.id === deckId) : undefined);
      download(blob, name);
      setState({ kind: "done", blob, name });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const working = state.kind === "working";
  return (
    <Dialog
      open={props.open}
      title={t("export.title")}
      onClose={props.onClose}
      locked={working}
      width="md"
      footer={
        state.kind === "done" ? (
          <>
            <button type="button" className="btn btn-ghost" onClick={() => download(state.blob, state.name)}>
              {t("export.again")}
            </button>
            <button type="button" className="btn btn-primary" onClick={props.onClose} autoFocus>
              {t("common.done")}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-ghost" onClick={props.onClose} disabled={working}>
              {t("common.cancel")}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void run()} disabled={working || (scope === "deck" && deckId === null)} data-testid="export-go">
              {working ? <span className="spinner" aria-hidden="true" /> : <Icon name="export" />}
              {working ? t("export.working") : t("export.go")}
            </button>
          </>
        )
      }
    >
      <div className="export" data-testid="export-dialog" aria-busy={working}>
        <p className="muted">{t("export.body")}</p>
        <fieldset className="fieldset" disabled={working || state.kind === "done"}>
          <legend className="field-label">{t("export.scope")}</legend>
          <label className="radio">
            <input type="radio" name="scope" checked={scope === "all"} onChange={() => setScope("all")} />
            <span>{t("export.whole")}</span>
          </label>
          <label className="radio">
            <input type="radio" name="scope" checked={scope === "deck"} onChange={() => setScope("deck")} data-testid="export-scope-deck" />
            <span>{t("export.deck")}</span>
          </label>
          {scope === "deck" && (
            <Select className="export-deck" label={t("browse.deck")} data-testid="export-deck" value={deckId ?? 0}
              options={deckOptions(decks)} onChange={setDeckId} />
          )}
        </fieldset>
        <fieldset className="fieldset" disabled={working || state.kind === "done"}>
          <label className="check">
            <input type="checkbox" checked={withProgress} onChange={(e) => setWithProgress(e.target.checked)} data-testid="export-progress" />
            <span>
              {t("export.withProgress")}
              <small>{t("export.withProgressHint")}</small>
            </span>
          </label>
          <label className="check">
            <input type="checkbox" checked={withMedia} onChange={(e) => setWithMedia(e.target.checked)} />
            <span>
              {t("export.withMedia")}
              <small>{t("export.withMediaHint")}</small>
            </span>
          </label>
        </fieldset>
        {working && (
          <div className="progress progress-indeterminate" role="progressbar" aria-label={t("export.working")}>
            <div className="progress-bar" />
          </div>
        )}
        {state.kind === "done" && (
          <p className="callout callout-ok" role="status" data-testid="export-done">
            <Icon name="check" /> {t("export.done", { file: state.name, size: formatBytes(state.blob.size, lang) })}
          </p>
        )}
        {state.kind === "error" && (
          <div className="callout callout-error" role="alert">
            <Icon name="warning" />
            <div>
              <p className="strong">{t("export.failed")}</p>
              <p className="muted small break">{state.message}</p>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
