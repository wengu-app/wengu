import { DesktopUpdate } from "./ui/DesktopUpdate.tsx";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Id, WenguClient } from "@wengu/core";

import { AppProvider, navigate, routeHash, useApp, useRoute, type Route, type Toast } from "./lib/app.tsx";
import { useAgentBridge } from "./lib/agents.ts";
import { useDesktopCommands } from "./lib/desktop.ts";
import { useT, type MessageKey } from "./lib/i18n.ts";
import { Browse } from "./screens/Browse.tsx";
import { Decks } from "./screens/Decks.tsx";
import { ExportDialog } from "./screens/ExportDialog.tsx";
import { ImportDialog, isAnkiFile } from "./screens/ImportDialog.tsx";
import { Make } from "./screens/Make.tsx";
import { Review } from "./screens/Review.tsx";
import { Settings } from "./screens/Settings.tsx";
import { Stats } from "./screens/Stats.tsx";
import { Welcome } from "./screens/Welcome.tsx";
import { Icon, type IconName } from "./ui/Icon.tsx";

export function App({ db }: { db: WenguClient }) {
  const [importState, setImportState] = useState<{ open: boolean; file: File | null; key: number }>({ open: false, file: null, key: 0 });
  const [exportState, setExportState] = useState<{ open: boolean; deckId: Id | null }>({ open: false, deckId: null });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const onImport = useCallback((file?: File) => {
    if (file) setImportState((s) => ({ open: true, file, key: s.key + 1 }));
    else fileInput.current?.click();
  }, []);
  const onExport = useCallback((deckId?: Id) => setExportState({ open: true, deckId: deckId ?? null }), []);
  useDesktopCommands(onImport, onExport);

  return (
    <AppProvider db={db} onImport={onImport} onExport={onExport} toasts={setToasts}>
      <Shell />
      <AgentBridge />
      <input
        ref={fileInput}
        type="file"
        accept=".apkg,.colpkg"
        hidden
        data-testid="import-input"
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (f) onImport(f);
        }}
      />
      <DropZone onFile={onImport} />
      <ImportDialog
        key={importState.key}
        open={importState.open}
        file={importState.file}
        onClose={() => setImportState((s) => ({ ...s, open: false }))}
      />
      <ExportDialog open={exportState.open} deckId={exportState.deckId} onClose={() => setExportState((s) => ({ ...s, open: false }))} />
      <Toasts toasts={toasts} />
    </AppProvider>
  );
}

function AgentBridge() {
  useAgentBridge();
  return null;
}

function Shell() {
  const route = useRoute();
  const { info, openImport, openExport } = useApp();
  const t = useT();
  const empty = info.counts.knowledgePoints === 0 && info.counts.decks <= 1;
  const focus = route.name === "review";

  // "/" opens Browse with the search box focused, like the search field in the top bar; "A" opens Make (as in Anki).
  useEffect(() => {
    if (focus) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.tagName === "SELECT" || tgt.isContentEditable)) return;
      if (document.querySelector("dialog[open]")) return;
      if (e.key === "a" && route.name !== "make") {
        e.preventDefault();
        navigate({ name: "make", deckId: null });
        return;
      }
      if (e.key !== "/") return;
      e.preventDefault();
      if (route.name !== "browse") navigate({ name: "browse", deckId: null, noteId: null });
      setTimeout(() => document.querySelector<HTMLInputElement>('[data-testid="browse-search"]')?.focus(), 0);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus, route.name]);

  return (
    <div className={`shell ${focus ? "shell-focus" : ""}`} data-desktop={window.wenguDesktop ? "" : undefined}>
      {!focus && (
        <header className="topbar">
          <nav className="topbar-in" aria-label={t("nav.main")}>
            <a className="brand" href={routeHash({ name: "decks" })} aria-current={route.name === "decks" ? "page" : undefined} aria-label={t("nav.decks")}>
              <span className="seal" aria-hidden="true">
                温
              </span>
              <span className="brand-name">{t("app.name")}</span>
            </a>
            {route.name !== "browse" ? (
              <a className="topsearch" href={routeHash({ name: "browse", deckId: null, noteId: null })} aria-label={t("nav.browse")}>
                <Icon name="browse" />
                <span>{t("nav.search")}</span>
                <kbd>/</kbd>
              </a>
            ) : (
              <span className="topsearch-space" />
            )}
            <div className="topbar-actions">
              {route.name !== "make" && (
                <a className="btn btn-primary btn-small top-make" href={routeHash({ name: "make", deckId: null })} aria-label={t("nav.make")} title={`${t("nav.make")} (A)`}>
                  <Icon name="plus" />
                  <span className="btn-text">{t("nav.make")}</span>
                  <kbd>A</kbd>
                </a>
              )}
              <TopLink route={{ name: "stats" }} icon="stats" label="nav.stats" current={route.name === "stats"} />
              <button type="button" className="btn btn-ghost btn-small" onClick={() => openImport()} aria-label={t("nav.import")} title={t("nav.import")}>
                <Icon name="import" />
                <span className="btn-text">{t("nav.import")}</span>
              </button>
              <button type="button" className="btn btn-ghost btn-small" onClick={() => openExport()} disabled={empty} aria-label={t("nav.export")} title={t("nav.export")}>
                <Icon name="export" />
                <span className="btn-text">{t("nav.export")}</span>
              </button>
              <DesktopUpdate />
              <TopLink route={{ name: "settings" }} icon="settings" label="nav.settings" current={route.name === "settings"} />
            </div>
          </nav>
        </header>
      )}
      <main className="main" id="main">
        <Screen route={route} empty={empty} />
      </main>
    </div>
  );
}

function TopLink({ route, icon, label, current }: { route: Route; icon: IconName; label: MessageKey; current: boolean }) {
  const t = useT();
  return (
    <a className="icon-btn top-link" href={routeHash(route)} aria-current={current ? "page" : undefined} title={t(label)} aria-label={t(label)}>
      <Icon name={icon} size={20} />
    </a>
  );
}

function Screen({ route, empty }: { route: Route; empty: boolean }) {
  switch (route.name) {
    case "decks":
      return empty ? <Welcome /> : <Decks />;
    case "review":
      return <Review key={String(route.deckId)} deckId={route.deckId} onExit={() => navigate({ name: "decks" })} />;
    case "browse":
      return <Browse initialDeckId={route.deckId} initialNoteId={route.noteId} />;
    case "make":
      return <Make key={String(route.deckId)} initialDeckId={route.deckId} />;
    case "stats":
      return <Stats />;
    case "settings":
      return <Settings />;
  }
}

function DropZone({ onFile }: { onFile(f: File): void }) {
  const t = useT();
  const [over, setOver] = useState(false);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setOver(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setOver(false);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      const f = Array.from(e.dataTransfer?.files ?? []).find(isAnkiFile) ?? e.dataTransfer?.files[0];
      if (f) onFile(f);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [onFile]);
  if (!over) return null;
  return (
    <div className="dropzone" aria-hidden="true">
      <div className="dropzone-inner">
        <Icon name="import" size={28} />
        <p>{t("import.dropHere")}</p>
      </div>
    </div>
  );
}

function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <span>{t.message}</span>
          {t.action && (
            <button type="button" className="toast-action" onClick={t.action.run}>
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
