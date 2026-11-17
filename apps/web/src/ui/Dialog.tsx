/** Modal dialog on the native <dialog> element (focus trapping, Escape, top layer, inert background for free). */
import { useEffect, useId, useRef, type ReactNode } from "react";

import { useT } from "../lib/i18n.ts";
import { Icon } from "./Icon.tsx";

export function Dialog(props: {
  open: boolean;
  title: string;
  onClose(): void;
  children: ReactNode;
  footer?: ReactNode;
  width?: "sm" | "md" | "lg";
  /** Escape / backdrop do nothing (e.g. while an import runs). */
  locked?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const t = useT();
  const titleId = useId();
  const { open, locked, onClose } = props;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      if (!locked) onClose();
    };
    d.addEventListener("cancel", onCancel);
    return () => d.removeEventListener("cancel", onCancel);
  }, [locked, onClose]);

  return (
    <dialog
      ref={ref}
      className={`dialog dialog-${props.width ?? "md"} ${props.className ?? ""}`}
      aria-labelledby={titleId}
      onMouseDown={(e) => {
        if (e.target === ref.current && !locked) onClose();
      }}
    >
      {open && (
        <div className="dialog-body">
          <header className="dialog-head">
            <h2 id={titleId}>{props.title}</h2>
            {!locked && (
              <button type="button" className="icon-btn" onClick={onClose} aria-label={t("common.close")}>
                <Icon name="close" />
              </button>
            )}
          </header>
          <div className="dialog-content">{props.children}</div>
          {props.footer && <footer className="dialog-foot">{props.footer}</footer>}
        </div>
      )}
    </dialog>
  );
}
