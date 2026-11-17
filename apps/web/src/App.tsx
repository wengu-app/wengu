import { useCallback, useEffect, useRef, useState } from "react";
import type { Id, WenguClient } from "@wengu/core";

import { AppProvider, navigate, routeHash, useApp, useRoute, type Route, type Toast } from "./lib/app.tsx";
import { useDesktopCommands } from "./lib/desktop.ts";
import { useT, type MessageKey } from "./lib/i18n.ts";
import { Browse } from "./screens/Browse.tsx";
import { Decks } from "./screens/Decks.tsx";
import { ExportDialog } from "./screens/ExportDialog.tsx";
import { ImportDialog, isAnkiFile } from "./screens/ImportDialog.tsx";
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

const NAV: { route: Route; icon: IconName; label: MessageKey }[] = [
  { route: { name: "decks" }, icon: "decks", label: "nav.decks" },
  { route: { name: "browse", deckId: null, noteId: null }, icon: "browse", label: "nav.browse" },
  { route: { name: "stats" }, icon: "stats", label: "nav.stats" },
  { route: { name: "settings" }, icon: "settings", label: "nav.settings" },
];

function Shell() {
  const route = useRoute();
  const { info, openImport, openExport } = useApp();
  const t = useT();
  const empty = info.counts.knowledgePoints === 0 && info.counts.decks <= 1;
  const focus = route.name === "review";

  return (
    <div className={`shell ${focus ? "shell-focus" : ""}`}>
      {!focus && (
        <nav className="rail" aria-label={t("nav.main")}>
          <a className="brand" href={routeHash({ name: "decks" })}>
            <span className="seal" aria-hidden="true">
              温
            </span>
            <span className="brand-name">
              温故 <span className="brand-latin">Wengu</span>
            </span>
          </a>
          <ul className="rail-links">
            {NAV.map((n) => (
              <li key={n.label}>
                <a className="rail-link" href={routeHash(n.route)} aria-current={route.name === n.route.name ? "page" : undefined}>
                  <Icon name={n.icon} />
                  <span>{t(n.label)}</span>
                </a>
              </li>
            ))}
          </ul>
          <div className="rail-actions">
            <button type="button" className="rail-link" onClick={() => openImport()}>
              <Icon name="import" />
              <span>{t("nav.import")}</span>
            </button>
            <button type="button" className="rail-link" onClick={() => openExport()} disabled={empty}>
              <Icon name="export" />
              <span>{t("nav.export")}</span>
            </button>
          </div>
        </nav>
      )}
      <main className="main" id="main">
        <Screen route={route} empty={empty} />
      </main>
    </div>
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
