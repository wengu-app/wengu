/**
 * The head of every page below home: a Back key (the same as the review screen's exit), the title, and the page's
 * own actions on the right. Escape goes back too, unless a field, a dialog or an open list has it.
 */
import { useEffect, type ReactNode } from "react";
import { goBack } from "../lib/app.tsx";
import { useT } from "../lib/i18n.ts";
import { Icon } from "./Icon.tsx";

export function PageHead(props: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; className?: string }) {
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.tagName === "SELECT" || tgt.isContentEditable)) return;
      if (document.querySelector("dialog[open], .select-pop")) return;
      e.preventDefault();
      goBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <header className={`page-head ${props.className ?? ""}`}>
      <div className="page-head-main">
        <button type="button" className="page-back" onClick={goBack} title={`${t("common.back")} (Esc)`} data-testid="page-back">
          <Icon name="chevronLeft" />
          <span>{t("common.back")}</span>
        </button>
        <div className="page-head-text">
          <h1 className="page-title">{props.title}</h1>
          {props.sub && <p className="page-sub">{props.sub}</p>}
        </div>
      </div>
      {props.actions && <div className="page-actions">{props.actions}</div>}
    </header>
  );
}
