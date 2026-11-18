/**
 * A dropdown that replaces the native <select>: a button showing the current choice and a list that opens under it
 * (or above it, when there is more room there). Keyboard: arrows, Home/End, Enter, Escape, Tab, and typing jumps to an
 * option; lists longer than SEARCH_AT get a filter box instead. The list is a manual popover, so it sits in the top
 * layer: above modal dialogs and never clipped by a scrolling parent.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "../lib/i18n.ts";
import { Icon } from "./Icon.tsx";

export interface SelectOption<V extends string | number> {
  value: V;
  label: string;
  /** Nesting level, drawn as indentation (sub-decks). */
  depth?: number;
  /** The full name ("Parent / Child"): the option's accessible name, and what the trigger and a filtered list show. */
  path?: string;
}

/** Above this many options the list gets a filter box. */
export const SEARCH_AT = 10;

/** Deck options from Anki-style names ("A::B"), indented by level; the decks must come parents first, as listed. */
export function deckOptions(decks: readonly { id: number; name: string }[]): SelectOption<number>[] {
  return decks.map((d) => {
    const parts = d.name.split("::");
    return { value: d.id, label: parts[parts.length - 1]!, depth: parts.length - 1, path: parts.join(" / ") };
  });
}

export function Select<V extends string | number>(props: {
  value: NoInfer<V>;
  options: readonly SelectOption<V>[];
  onChange(value: NoInfer<V>): void;
  /** Accessible name of the control. */
  label: string;
  size?: "sm";
  className?: string;
  /** Replaces the default face (current choice and a caret); the button then takes only `className`. */
  children?: ReactNode;
  disabled?: boolean;
  "data-testid"?: string;
}) {
  const { value, options, onChange } = props;
  const t = useT();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const searchable = options.length > SEARCH_AT;
  const q = query.trim().toLowerCase();
  const shown = q ? options.filter((o) => (o.path ?? o.label).toLowerCase().includes(q)) : options;
  const selected = options.find((o) => o.value === value);
  const optionId = (i: number) => `${id}-o${i}`;

  const close = (refocus = true) => {
    setOpen(false);
    setQuery("");
    if (refocus) trigger.current?.focus();
  };
  const show = () => {
    setQuery("");
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  const choose = (o: SelectOption<V> | undefined) => {
    if (!o) return;
    close();
    if (o.value !== value) onChange(o.value);
  };

  // Open: show the popover, place it against the trigger, focus it, and close it on an outside press or a scroll.
  useLayoutEffect(() => {
    const el = pop.current;
    const tr = trigger.current;
    if (!open || !el || !tr) return;
    try {
      el.showPopover();
    } catch {
      /* no popover support: it stays a fixed-position layer */
    }
    const place = () => {
      const r = tr.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - 12;
      const above = r.top - 12;
      const up = below < 220 && above > below;
      el.style.minWidth = `${Math.max(r.width, 180)}px`;
      el.style.maxHeight = `${Math.max(120, Math.min(360, up ? above : below))}px`;
      el.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - el.offsetWidth - 8))}px`;
      el.style.top = up ? "" : `${r.bottom + 6}px`;
      el.style.bottom = up ? `${window.innerHeight - r.top + 6}px` : "";
    };
    place();
    el.querySelector<HTMLElement>(searchable ? "input" : '[role="listbox"]')?.focus({ preventScroll: true });
    const onDown = (e: PointerEvent) => {
      const n = e.target as Node;
      if (!el.contains(n) && !tr.contains(n)) close(false);
    };
    // A scroll elsewhere moves the list along with its trigger; it closes once the trigger has left the window.
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && el.contains(e.target)) return;
      const r = tr.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) close(false);
      else place();
    };
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", place);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keep the active option in view by scrolling the list only: scrollIntoView would also scroll the trigger's
  // scrolling ancestors (the popover is their DOM child), and that scroll would close the list.
  useEffect(() => {
    const list = pop.current?.querySelector<HTMLElement>(".select-list");
    const opt = list?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!open || !list || !opt) return;
    const top = opt.offsetTop - list.offsetTop;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + opt.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + opt.offsetHeight - list.clientHeight;
  }, [open, active, q]);

  const onKey = (e: React.KeyboardEvent) => {
    // Keep keys away from the app's single-key shortcuts and from a dialog's Escape.
    e.stopPropagation();
    const last = shown.length - 1;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((i) => (i >= last ? 0 : i + 1));
        return;
      case "ArrowUp":
        e.preventDefault();
        setActive((i) => (i <= 0 ? last : i - 1));
        return;
      case "Home":
      case "End":
        if (searchable) return;
        e.preventDefault();
        setActive(e.key === "Home" ? 0 : last);
        return;
      case "Enter":
        e.preventDefault();
        choose(shown[active]);
        return;
      case "Escape":
        e.preventDefault();
        close();
        return;
      case "Tab":
        e.preventDefault();
        close();
        return;
    }
    if (searchable || e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
    // Type-ahead: letters typed within a second build a prefix; the next option starting with it becomes active.
    const now = Date.now();
    typed.current = { text: (now - typed.current.at < 1000 ? typed.current.text : "") + e.key.toLowerCase(), at: now };
    const prefix = typed.current.text;
    const start = prefix.length === 1 ? active + 1 : active;
    for (let k = 0; k < shown.length; k++) {
      const i = (start + k) % shown.length;
      if (shown[i]!.label.toLowerCase().startsWith(prefix)) {
        setActive(i);
        break;
      }
    }
  };

  const listbox = `${id}-list`;
  return (
    <>
      <button
        ref={trigger}
        type="button"
        role="combobox"
        className={props.children ? props.className : `select-btn ${props.size === "sm" ? "select-btn-sm" : ""} ${props.className ?? ""}`}
        aria-label={props.label}
        title={props.children ? props.label : selected?.path}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listbox : undefined}
        disabled={props.disabled}
        data-testid={props["data-testid"]}
        data-value={String(value)}
        onClick={() => (open ? close() : show())}
        onKeyDown={(e) => {
          if (open || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
          e.preventDefault();
          show();
        }}
      >
        {props.children ?? (
          <>
            <span className="select-value">{selected ? (selected.path ?? selected.label) : ""}</span>
            <Icon name="chevronDown" size={16} />
          </>
        )}
      </button>
      {open && (
        <div ref={pop} popover="manual" className="select-pop" onKeyDown={onKey}>
          {searchable && (
            <div className="select-search">
              <Icon name="browse" size={15} />
              <input
                type="text"
                value={query}
                placeholder={t("common.filter")}
                aria-label={t("common.filter")}
                aria-controls={listbox}
                aria-activedescendant={shown[active] ? optionId(active) : undefined}
                aria-autocomplete="list"
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
              />
            </div>
          )}
          <div className="select-list" role="listbox" id={listbox} aria-label={props.label} tabIndex={-1} aria-activedescendant={shown[active] ? optionId(active) : undefined}>
            {shown.length === 0 && <div className="select-empty">{t("common.noMatches")}</div>}
            {shown.map((o, i) => {
              const on = o.value === value;
              return (
                <div
                  key={String(o.value)}
                  id={optionId(i)}
                  role="option"
                  aria-selected={on}
                  aria-label={o.path && o.path !== o.label ? o.path : undefined}
                  data-index={i}
                  data-value={String(o.value)}
                  className={`select-opt${i === active ? " is-active" : ""}`}
                  style={!q && o.depth ? { paddingInlineStart: 10 + o.depth * 16 } : undefined}
                  onPointerMove={() => i !== active && setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(o)}
                >
                  <span>{q ? (o.path ?? o.label) : o.label}</span>
                  {on && <Icon name="check" size={15} />}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
