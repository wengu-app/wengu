import { useEffect, useMemo, useRef, useState } from "react";
import type { VisualPresentation } from "@wengu/core";
import {
  themeFor,
  type ComponentPackage,
  type HostEvent,
  type JsonObject,
  type LibraryBundle,
  type Phase,
  type ReviewResult,
  type ShortcutKey,
  type Theme,
} from "@wengu/runtime";
import { SandboxedComponent } from "@wengu/runtime/react";

import { useT } from "../lib/i18n.ts";
import { useIsDark } from "../lib/settings.ts";
import { dark, fonts, light } from "../lib/theme.ts";
import { loadVisualLibraries, visualFrameUrl } from "./visualLibs.ts";

export interface VisualCardProps {
  presentation: VisualPresentation;
  phase: Phase;
  onRequestReveal(): void;
  onResult?(result: ReviewResult): void;
  onShortcut(code: ShortcutKey): void;
  onReady?(): void;
  onSwitchToText(): void;
}

export function visualThemeFor(isDark: boolean): Theme {
  const base = themeFor(isDark ? "dark" : "light");
  const p = isDark ? dark : light;
  return {
    scheme: base.scheme,
    tokens: {
      ...base.tokens,
      font: { ...fonts },
      radius: { sm: 10, md: 14, lg: 20 },
      color: {
        ...base.tokens.color,
        background: p.bg,
        surface: p.surface,
        surfaceRaised: p.raised,
        text: p.ink,
        textMuted: p.muted,
        border: p.line,
        accent: p.accent,
        onAccent: p.accentInk,
        success: p.good,
        danger: p.again,
        warning: p.hard,
      },
    },
  };
}

type LibState =
  | { status: "loading" }
  | { status: "ready"; libraries: Record<string, LibraryBundle>; key: string }
  | { status: "error"; message: string };

export function VisualCard(p: VisualCardProps) {
  const isDark = useIsDark();
  const t = useT();
  const theme = useMemo(() => visualThemeFor(isDark), [isDark]);
  const libsKey = [...p.presentation.manifest.libraries].sort().join(",");
  const [attempt, setAttempt] = useState(0);
  const [libState, setLibState] = useState<LibState>(() =>
    p.presentation.manifest.libraries.length === 0
      ? { status: "ready", libraries: {}, key: "" }
      : { status: "loading" },
  );

  const callbacksRef = useRef({
    phase: p.phase,
    onRequestReveal: p.onRequestReveal,
    onResult: p.onResult,
    onShortcut: p.onShortcut,
    onReady: p.onReady,
  });
  callbacksRef.current = {
    phase: p.phase,
    onRequestReveal: p.onRequestReveal,
    onResult: p.onResult,
    onShortcut: p.onShortcut,
    onReady: p.onReady,
  };

  useEffect(() => {
    let cancelled = false;
    const req = p.presentation.manifest.libraries;
    if (req.length === 0) {
      setLibState({ status: "ready", libraries: {}, key: libsKey });
      return;
    }
    setLibState({ status: "loading" });
    loadVisualLibraries(req)
      .then((libraries) => {
        if (!cancelled) setLibState({ status: "ready", libraries, key: libsKey });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLibState({ status: "error", message: err instanceof Error ? err.message : String(err) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [libsKey, attempt, p.presentation.manifest.libraries]);

  const componentPkg = useMemo<ComponentPackage>(
    () => ({
      manifest: p.presentation.manifest,
      source: p.presentation.source,
    }),
    [p.presentation.manifest, p.presentation.source],
  );

  const props = useMemo(
    () => p.presentation.props as JsonObject,
    [p.presentation.props],
  );

  const delivery = useMemo(() => ({ kind: "url" as const, url: visualFrameUrl() }), []);

  const handleEvent = useMemo(
    () => (e: HostEvent) => {
      const cb = callbacksRef.current;
      switch (e.type) {
        case "ready":
          cb.onReady?.();
          break;
        case "reveal-request":
          cb.onRequestReveal();
          break;
        case "result":
          cb.onResult?.(e.result);
          if (cb.phase === "question") cb.onRequestReveal();
          break;
        case "shortcut":
          cb.onShortcut(e.code);
          break;
      }
    },
    [],
  );

  if (libState.status === "loading" || (libState.status === "ready" && libState.key !== libsKey)) {
    return (
      <div className="visual-card visual-card-state" data-testid="visual-loading">
        <p className="muted small">{t("review.visual.loading")}</p>
      </div>
    );
  }

  if (libState.status === "error") {
    return (
      <div className="visual-card visual-card-fallback" role="alert" data-testid="visual-fallback">
        <p className="visual-fallback-title">{t("review.visual.failed")}</p>
        <p className="muted small break">{libState.message}</p>
        <div className="visual-fallback-actions">
          <button type="button" className="btn btn-ghost" onClick={() => setAttempt((a) => a + 1)}>
            {t("common.retry")}
          </button>
          <button type="button" className="btn btn-primary" onClick={p.onSwitchToText}>
            {t("review.visual.switchText")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="visual-card" data-testid="visual-card">
      <SandboxedComponent
        component={componentPkg}
        libraries={libState.libraries}
        props={props}
        theme={theme}
        mode="review"
        phase={p.phase}
        delivery={delivery}
        hostCspCheck="off"
        watchdog={{ intervalMs: 500, timeoutMs: 12_000 }}
        onEvent={handleEvent}
        className="visual-card-host"
        fallback={({ message, reason, retry }) => (
          <div className="visual-card-fallback" role="alert" data-testid="visual-fallback">
            <p className="visual-fallback-title">{t("review.visual.failed")}</p>
            <p className="muted small break">{message || reason}</p>
            <div className="visual-fallback-actions">
              <button type="button" className="btn btn-ghost" onClick={retry}>
                {t("common.retry")}
              </button>
              <button type="button" className="btn btn-primary" onClick={p.onSwitchToText}>
                {t("review.visual.switchText")}
              </button>
            </div>
          </div>
        )}
      />
    </div>
  );
}
