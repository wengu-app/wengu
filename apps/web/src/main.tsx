import { StrictMode, useCallback, useEffect, useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { connectWengu, type WenguClient } from "@wengu/core";

import "./styles/app.css";
import { App } from "./App.tsx";
import { useLang, useT } from "./lib/i18n.ts";
import { useIsDark } from "./lib/settings.ts";
import { appVars, dark, light } from "./lib/theme.ts";
import { Icon } from "./ui/Icon.tsx";

declare global {
  interface Window {
    /** Answer→next-card latencies (ms): to the next card painted, and the `answer` round trip alone. */
    __wenguPerf?: { answerToNext: number[]; answerRpc: number[] };
    /** The database client, exposed only when localStorage "wengu.debug" is set (tests). */
    __wenguDb?: WenguClient;
  }
}

function ThemeRoot() {
  const isDark = useIsDark();
  const lang = useLang();
  useLayoutEffect(() => {
    const root = document.documentElement;
    for (const [k, v] of Object.entries(appVars(isDark ? dark : light))) root.style.setProperty(k, v);
    root.dataset.theme = isDark ? "dark" : "light";
    root.style.colorScheme = isDark ? "dark" : "light";
  }, [isDark]);
  useLayoutEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    document.title = lang === "zh" ? "温故" : "Wengu";
  }, [lang]);
  return null;
}

type BootState = { kind: "connecting" } | { kind: "ready"; db: WenguClient } | { kind: "locked"; message: string } | { kind: "failed"; message: string };

function isLockError(message: string): boolean {
  return /another tab|already open|NoModificationAllowedError|access handle|createSyncAccessHandle/i.test(message);
}

/** One connection per attempt, outside React's effect lifecycle (StrictMode runs effects twice). */
let connection: { attempt: number; promise: Promise<WenguClient> } | null = null;

function connect(attempt: number): Promise<WenguClient> {
  if (connection?.attempt === attempt) return connection.promise;
  const worker = new Worker(new URL("./db.worker.ts", import.meta.url), { type: "module" });
  const promise = connectWengu(worker, attempt > 0 ? { waitForLockMs: 400 } : {}).then(
    (db) => {
      let debug = false;
      try {
        debug = localStorage.getItem("wengu.debug") === "1";
      } catch {
        /* no storage */
      }
      if (debug) window.__wenguDb = db;
      return db;
    },
    (e: unknown) => {
      worker.terminate();
      throw e;
    },
  );
  connection = { attempt, promise };
  return promise;
}

function Boot() {
  const t = useT();
  const [state, setState] = useState<BootState>({ kind: "connecting" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    connect(attempt)
      .then((db) => {
        if (!cancelled) setState({ kind: "ready", db });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : String(e);
        setState(isLockError(message) ? { kind: "locked", message } : { kind: "failed", message });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setState({ kind: "connecting" });
    setAttempt((a) => a + 1);
  }, []);

  if (state.kind === "ready") return <App db={state.db} />;
  if (state.kind === "connecting")
    return (
      <div className="boot" aria-busy="true">
        <span className="seal seal-lg" aria-hidden="true">
          温
        </span>
        <p className="boot-text">{t("boot.opening")}</p>
      </div>
    );
  const locked = state.kind === "locked";
  return (
    <div className="boot">
      <div className="boot-card" role="alert">
        <span className="boot-icon" aria-hidden="true">
          <Icon name={locked ? "lock" : "warning"} size={22} />
        </span>
        <h1>{t(locked ? "boot.locked.title" : "boot.failed.title")}</h1>
        <p>{t(locked ? "boot.locked.body" : "boot.failed.body")}</p>
        <button type="button" className="btn btn-primary" onClick={retry} autoFocus>
          {t("common.retry")}
        </button>
        <details className="boot-details">
          <summary>{t("boot.details")}</summary>
          <code>{state.message}</code>
        </details>
      </div>
    </div>
  );
}

window.__wenguPerf = { answerToNext: [], answerRpc: [] };

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeRoot />
    <Boot />
  </StrictMode>,
);
