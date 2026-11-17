/**
 * App preferences, kept per device in localStorage (the collection itself is in OPFS). Reading and writing are
 * wrapped so a blocked or full storage never breaks the app; it then falls back to defaults for this session.
 */
import { useSyncExternalStore } from "react";

export type ThemePref = "system" | "light" | "dark";
export type LangPref = "system" | "zh" | "en";
/** "auto": Wengu typography where it is safe, the deck's own look otherwise. */
export type RenderDefault = "auto" | "original";
export type NoteTypeMode = "auto" | "wengu" | "original";

export interface Settings {
  theme: ThemePref;
  lang: LangPref;
  renderDefault: RenderDefault;
  /** Per note type (id as string) override. Missing = follow the default. */
  noteTypeModes: Record<string, NoteTypeMode>;
  autoplay: boolean;
  /** Collapsed decks in the deck list (id as string). */
  collapsedDecks: Record<string, boolean>;
  /** Show the "why" panel next to the card when the answer is shown. */
  whyOpen: boolean;
}

const KEY = "wengu.settings.v1";

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  lang: "system",
  renderDefault: "auto",
  noteTypeModes: {},
  autoplay: true,
  collapsedDecks: {},
  whyOpen: false,
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_SETTINGS;
}

let state: Settings = load();
const listeners = new Set<() => void>();

export function getSettings(): Settings {
  return state;
}

export function updateSettings(patch: Partial<Settings> | ((s: Settings) => Partial<Settings>)): void {
  const p = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...p };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* keep in memory */
  }
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings, getSettings);
}

// ------------------------------------------------------------------------------------------ system preferences

const darkQuery = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;

function subscribeDark(l: () => void): () => void {
  darkQuery?.addEventListener("change", l);
  return () => darkQuery?.removeEventListener("change", l);
}

export function useSystemDark(): boolean {
  return useSyncExternalStore(subscribeDark, () => darkQuery?.matches ?? false, () => false);
}

export function useIsDark(): boolean {
  const s = useSettings();
  const sys = useSystemDark();
  return s.theme === "dark" || (s.theme === "system" && sys);
}
