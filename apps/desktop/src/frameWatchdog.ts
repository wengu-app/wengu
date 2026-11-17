/**
 * Hung card frames. A deck template that never yields (`for(;;){}`) keeps the card frame's renderer busy. Chromium gives
 * the sandboxed card frame its own process, so the app itself stays responsive, but the app's watchdog cannot bring the
 * frame back: its reload is routed to the same busy process and never commits, so every later card stays blank.
 *
 * The shell checks each card frame that lives in a process of its own; one that does not answer for HUNG_MS has its
 * renderer process killed. The page rebuilds the iframe browsing context and replays its latest card after a fresh
 * handshake. A process that also hosts the app's own page is never touched.
 */
import type { BrowserWindow, WebFrameMain } from "electron";

const CHECK_EVERY_MS = 1000;
const HUNG_MS = 3500;

export function watchCardFrames(win: BrowserWindow, isCardFrameUrl: (url: string) => boolean, log: (msg: string) => void, debug: (msg: string) => void = () => {}): void {
  const pending = new Map<number, number>(); // osProcessId → when the unanswered probe was sent

  const frames = (): WebFrameMain[] => {
    try {
      return win.webContents.mainFrame.framesInSubtree;
    } catch {
      return [];
    }
  };

  const timer = setInterval(() => {
    if (win.isDestroyed()) return clearInterval(timer);
    const main = win.webContents.mainFrame;
    const now = Date.now();

    for (const f of frames()) {
      if (f === main || f.isDestroyed() || f.detached) continue;
      const pid = f.osProcessId;
      if (!pid || pid === main.osProcessId || f.processId === main.processId || !isCardFrameUrl(f.url)) continue;
      const since = pending.get(pid);
      if (since !== undefined) {
        if (now - since > HUNG_MS) {
          pending.delete(pid);
          log(`card frame process ${pid} unresponsive for ${now - since} ms; terminating it`);
          try {
            process.kill(pid, "SIGKILL");
          } catch {
            /* already gone */
          }
          // The page's FrameController rebuilds the iframe's browsing context on its own timeout. Calling
          // reload() here races that handshake and may target a destroyed WebFrameMain after the kill.
          debug(`card frame ${f.frameTreeNodeId} terminated; waiting for the page to rebuild it`);
        }
        continue;
      }
      pending.set(pid, now);
      f.executeJavaScript("0").then(
        () => pending.delete(pid),
        () => pending.delete(pid),
      );
    }
  }, CHECK_EVERY_MS);
  win.on("closed", () => clearInterval(timer));
}
