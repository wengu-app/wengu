/** Remembers the main window's size, position and maximized/fullscreen state in `<userData>/window-state.json`. */
import { screen, type BrowserWindow, type Rectangle } from "electron";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface WindowState {
  bounds: Rectangle | null;
  maximized: boolean;
  fullscreen: boolean;
}

const DEFAULT_SIZE = { width: 1200, height: 820 };
export const MIN_SIZE = { width: 560, height: 400 };

function valid(b: unknown): b is Rectangle {
  if (!b || typeof b !== "object") return false;
  const r = b as Record<string, unknown>;
  return ["x", "y", "width", "height"].every((k) => typeof r[k] === "number" && Number.isFinite(r[k]));
}

/** Loads the saved state; drops the position if it is no longer on any display (monitor unplugged). */
export function loadWindowState(userData: string): WindowState {
  const file = path.join(userData, "window-state.json");
  let saved: Partial<WindowState> = {};
  try {
    saved = JSON.parse(readFileSync(file, "utf8")) as Partial<WindowState>;
  } catch {
    /* first run or unreadable: defaults */
  }
  let bounds: Rectangle | null = valid(saved.bounds) ? saved.bounds : null;
  if (bounds) {
    bounds.width = Math.max(MIN_SIZE.width, Math.round(bounds.width));
    bounds.height = Math.max(MIN_SIZE.height, Math.round(bounds.height));
    const area = screen.getDisplayMatching(bounds).workArea;
    const visibleW = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
    const visibleH = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
    if (visibleW < 100 || visibleH < 50) bounds = { ...DEFAULT_SIZE, x: NaN, y: NaN };
  }
  return { bounds, maximized: saved.maximized === true, fullscreen: saved.fullscreen === true };
}

export function initialBounds(state: WindowState): Partial<Rectangle> {
  if (!state.bounds) return { ...DEFAULT_SIZE };
  const { x, y, width, height } = state.bounds;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y, width, height } : { width, height };
}

/** Tracks the window and writes its state (debounced, and once more when it closes). */
export function trackWindowState(win: BrowserWindow, userData: string): void {
  const file = path.join(userData, "window-state.json");
  let timer: ReturnType<typeof setTimeout> | null = null;
  const save = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (win.isDestroyed()) return;
    const state: WindowState = { bounds: win.getNormalBounds(), maximized: win.isMaximized(), fullscreen: win.isFullScreen() };
    try {
      writeFileSync(file + ".tmp", JSON.stringify(state));
      renameSync(file + ".tmp", file);
    } catch {
      /* not fatal */
    }
  };
  const later = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, 400);
  };
  for (const ev of ["resize", "move", "maximize", "unmaximize", "enter-full-screen", "leave-full-screen"] as const) win.on(ev as "resize", later);
  win.on("close", save);
}
