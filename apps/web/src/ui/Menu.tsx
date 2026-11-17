/** A small dropdown menu: button + list of actions, keyboard navigable, closes on Escape / outside click. */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export interface MenuItem {
  label: string;
  onSelect(): void;
  icon?: ReactNode;
  disabled?: boolean;
  hint?: string;
}

export function Menu(props: { label: string; trigger: ReactNode; items: MenuItem[]; align?: "start" | "end"; className?: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    list.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      setOpen(false);
      root.current?.querySelector<HTMLButtonElement>(".menu-trigger")?.focus();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const buttons = Array.from(list.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
      const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = buttons[(i + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length];
      next?.focus();
    }
  };

  return (
    <div className={`menu ${props.className ?? ""}`} ref={root} onKeyDown={onKey}>
      <button
        type="button"
        className="icon-btn menu-trigger"
        aria-label={props.label}
        title={props.label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        {props.trigger}
      </button>
      {open && (
        <ul className={`menu-list menu-${props.align ?? "end"}`} role="menu" id={id} ref={list}>
          {props.items.map((it) => (
            <li key={it.label} role="none">
              <button
                type="button"
                role="menuitem"
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onSelect();
                }}
              >
                {it.icon}
                <span>{it.label}</span>
                {it.hint && <kbd>{it.hint}</kbd>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
