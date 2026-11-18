import { useEffect, useState, type CSSProperties } from "react";
import type { UpdateState } from "../lib/desktop.ts";
import { useT } from "../lib/i18n.ts";
import { Icon } from "./Icon.tsx";

/** The update button in the top bar: quiet while there is something to fetch, a solid key once a restart will apply it. */
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
  const icon = phase === "error" ? "warning" : solid ? "refresh" : "update";
  const percent = phase === "downloading" ? Math.max(0, Math.min(100, Math.round(state.percent))) : 0;

  return (
    <button type="button" className={`btn btn-small desktop-update ${solid ? "" : "btn-ghost"}`} data-phase={phase}
      style={phase === "downloading" ? ({ "--p": `${percent}%` } as CSSProperties) : undefined}
      title={phase === "error" ? state.message : `${label} · ${state.version}`}
      aria-label={phase === "downloading" ? `${label} ${percent}%` : label} aria-busy={busy || undefined}
      disabled={busy}
      onClick={() => desktop.update?.(solid ? "install" : "download")}>
      <Icon name={icon} />
      <span className="update-label">{label}</span>
      {phase === "downloading" && (
        <>
          <span className="update-percent">{percent}%</span>
          <progress className="sr-only" aria-label={label} value={percent} max={100} />
        </>
      )}
    </button>
  );
}
