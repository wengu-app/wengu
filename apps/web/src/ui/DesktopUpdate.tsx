import { useEffect, useState, type CSSProperties } from "react";
import type { UpdateState } from "../lib/desktop.ts";
import { useT } from "../lib/i18n.ts";
import { Icon, type IconName } from "./Icon.tsx";

type Phase = Exclude<UpdateState["phase"], "idle">;
const FACES: readonly [Phase, IconName][] = [
  ["available", "update"],
  ["downloading", "update"],
  ["ready", "refresh"],
  ["installing", "refresh"],
  ["error", "warning"],
];

/**
 * The update button in the top bar: a quiet icon while there is something to fetch (icon and percentage while it
 * downloads), and a labelled solid key once a restart will apply it. app.css decides what each phase shows.
 */
export function DesktopUpdate() {
  const t = useT();
  const [state, setState] = useState<UpdateState>({ phase: "idle" });
  const desktop = window.wenguDesktop;
  useEffect(() => desktop?.onCommand(command => {
    if (command.type === "update") setState(command.state);
  }), [desktop]);

  if (!desktop?.update || state.phase === "idle") return null;
  const { phase } = state;
  const label = t(`update.${phase}`);
  const busy = phase === "downloading" || phase === "installing";
  const solid = phase === "ready" || phase === "installing";
  const percent = phase === "downloading" ? Math.max(0, Math.min(100, Math.round(state.percent))) : 0;

  return (
    <button type="button" className={`btn btn-small desktop-update ${solid ? "" : "btn-ghost"}`} data-phase={phase}
      style={phase === "downloading" ? ({ "--p": `${percent}%` } as CSSProperties) : undefined}
      title={phase === "error" ? state.message : `${label} · ${state.version}`}
      aria-label={phase === "downloading" ? `${label} ${percent}%` : label} aria-busy={busy || undefined}
      disabled={busy}
      onClick={() => desktop.update?.(solid ? "install" : "download")}>
      <span className="update-faces" aria-hidden="true">
        {FACES.map(([face, icon]) => (
          <span key={face} className={`update-face${face === phase ? " is-on" : ""}`} data-face={face}>
            <Icon name={icon} />
            <span className="update-label">{t(`update.${face}`)}</span>
            {face === "downloading" && <span className="update-percent"><span>100%</span><span>{percent}%</span></span>}
          </span>
        ))}
      </span>
      {phase === "downloading" && <progress className="sr-only" aria-label={label} value={percent} max={100} />}
    </button>
  );
}
