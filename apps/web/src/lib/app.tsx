/** App-wide state: the database client, note types, media, and the global dialogs and toasts. */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { CollectionInfo, Id, NoteType, WenguClient } from "@wengu/core";

import { MediaCache } from "./media.ts";
import { analyseNoteType, type NoteTypeAnalysis } from "./renderMode.ts";

export interface Toast {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}

export interface AppContextValue {
  db: WenguClient;
  media: MediaCache;
  info: CollectionInfo;
  noteTypes: NoteType[];
  noteType(id: Id): NoteType | undefined;
  analysis(id: Id): NoteTypeAnalysis;
  /** Bumped whenever collection data changes (screens refetch). */
  version: number;
  /** Call after any change to the collection. `structure`: note types or media may have changed too. */
  changed(structure?: boolean): Promise<void>;
  toast(message: string, action?: Toast["action"]): void;
  openImport(file?: File): void;
  openExport(deckId?: Id): void;
}

const Ctx = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside AppProvider");
  return v;
}

const SAFE: NoteTypeAnalysis = { safe: true, reasons: [] };

export function AppProvider(props: {
  db: WenguClient;
  children: ReactNode;
  onImport(file?: File): void;
  onExport(deckId?: Id): void;
  toasts: (t: Toast[]) => void;
}) {
  const { db } = props;
  const media = useMemo(() => new MediaCache(db), [db]);
  const [info, setInfo] = useState<CollectionInfo>(db.opened);
  const [noteTypes, setNoteTypes] = useState<NoteType[]>([]);
  const [version, setVersion] = useState(0);
  const analyses = useRef(new Map<string, NoteTypeAnalysis>());
  const toastList = useRef<Toast[]>([]);
  const nextToast = useRef(1);
  const propsRef = useRef(props);
  propsRef.current = props;

  const loadNoteTypes = useCallback(async () => setNoteTypes(await db.listNoteTypes()), [db]);
  useEffect(() => {
    void loadNoteTypes();
  }, [loadNoteTypes]);

  const byId = useMemo(() => new Map(noteTypes.map((n) => [n.id, n])), [noteTypes]);

  const changed = useCallback(
    async (structure = false) => {
      if (structure) {
        media.invalidate();
        await loadNoteTypes();
      }
      setInfo(await db.info());
      setVersion((v) => v + 1);
    },
    [db, media, loadNoteTypes],
  );

  const toast = useCallback(
    (message: string, action?: Toast["action"]) => {
      const id = nextToast.current++;
      const dismiss = () => {
        toastList.current = toastList.current.filter((x) => x.id !== id);
        propsRef.current.toasts(toastList.current);
      };
      const t: Toast = {
        id,
        message,
        ...(action ? { action: { label: action.label, run: () => (dismiss(), action.run()) } } : {}),
      };
      toastList.current = [...toastList.current.slice(-2), t];
      propsRef.current.toasts(toastList.current);
      setTimeout(dismiss, action ? 6000 : 3200);
    },
    [],
  );

  const value = useMemo<AppContextValue>(
    () => ({
      db,
      media,
      info,
      noteTypes,
      noteType: (id) => byId.get(id),
      analysis: (id) => {
        const nt = byId.get(id);
        if (!nt) return SAFE;
        const key = `${nt.id}:${nt.modifiedAt}`;
        let a = analyses.current.get(key);
        if (!a) analyses.current.set(key, (a = analyseNoteType(nt)));
        return a;
      },
      version,
      changed,
      toast,
      openImport: (f) => propsRef.current.onImport(f),
      openExport: (d) => propsRef.current.onExport(d),
    }),
    [db, media, info, noteTypes, byId, version, changed, toast],
  );
  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}

// ------------------------------------------------------------------------------------------ hash routing

export type Route =
  | { name: "decks" }
  | { name: "deck"; deckId: Id }
  | { name: "review"; deckId: Id | null }
  | { name: "browse"; deckId: Id | null; noteId: Id | null }
  | { name: "make"; deckId: Id | null }
  | { name: "stats" }
  | { name: "settings" };

export function parseRoute(hash: string): Route {
  const [path = "", query = ""] = hash.replace(/^#\/?/, "").split("?");
  const q = new URLSearchParams(query);
  const num = (v: string | null) => (v && /^\d+$/.test(v) ? Number(v) : null);
  const parts = path.split("/").filter(Boolean);
  switch (parts[0]) {
    case "deck": {
      const id = num(parts[1] ?? null);
      return id === null ? { name: "decks" } : { name: "deck", deckId: id };
    }
    case "review":
      return { name: "review", deckId: num(parts[1] ?? null) };
    case "browse":
      return { name: "browse", deckId: num(q.get("deck")), noteId: num(q.get("note")) };
    case "make":
      return { name: "make", deckId: num(q.get("deck")) };
    case "stats":
      return { name: "stats" };
    case "settings":
      return { name: "settings" };
    default:
      return { name: "decks" };
  }
}

export function routeHash(r: Route): string {
  switch (r.name) {
    case "decks":
      return "#/";
    case "deck":
      return `#/deck/${r.deckId}`;
    case "review":
      return `#/review${r.deckId !== null ? "/" + r.deckId : ""}`;
    case "browse": {
      const q = new URLSearchParams();
      if (r.deckId !== null) q.set("deck", String(r.deckId));
      if (r.noteId !== null) q.set("note", String(r.noteId));
      const s = q.toString();
      return `#/browse${s ? "?" + s : ""}`;
    }
    case "make":
      return `#/make${r.deckId !== null ? "?deck=" + r.deckId : ""}`;
    case "stats":
      return "#/stats";
    case "settings":
      return "#/settings";
  }
}

export function navigate(r: Route, replace = false): void {
  const h = routeHash(r);
  if (!replace) {
    location.hash = h;
    return;
  }
  history.replaceState(null, "", h);
  trail[trail.length - 1] = h;
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

/**
 * The pages this tab has moved through, oldest first, so Back can tell whether there is an app page to return to. A
 * hash change to the entry before the current one is a step back (the browser's Back, or goBack); anything else is a
 * step forward.
 */
const trail: string[] = [routeHash(parseRoute(location.hash))];
window.addEventListener("hashchange", () => {
  const h = routeHash(parseRoute(location.hash));
  if (h === trail[trail.length - 1]) return;
  if (h === trail[trail.length - 2]) trail.pop();
  else trail.push(h);
});

/** Back to the page this one was opened from; home when it was the first page of the tab. */
export function goBack(): void {
  if (trail.length > 1) history.back();
  else navigate({ name: "decks" }, true);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseRoute(location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}
