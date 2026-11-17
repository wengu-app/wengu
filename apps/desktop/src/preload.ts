/**
 * Preload for the app's top-level page (sandboxed; runs only in the main frame because nodeIntegrationInSubFrames is
 * off, so the card frame never gets it). Exposes one thing: `window.wenguDesktop.onCommand`, through which the shell
 * delivers menu commands and files opened from the OS. Nothing else of Electron or Node reaches the page.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

type DesktopCommand = { type: "import"; file?: { name: string; bytes: Uint8Array } } | { type: "export" };

// The shell's URL: wengu://app in a packaged build, or the dev server it was started against.
const allowed = (process.argv.find((a) => a.startsWith("--wengu-app-origin=")) ?? "").slice("--wengu-app-origin=".length);

if (window.top === window && allowed && location.origin === allowed) {
  contextBridge.exposeInMainWorld("wenguDesktop", {
    platform: process.platform,
    onCommand(cb: (command: DesktopCommand) => void): () => void {
      if (typeof cb !== "function") throw new TypeError("onCommand needs a function");
      const listener = (_e: IpcRendererEvent, command: DesktopCommand) => cb(command);
      ipcRenderer.on("wengu:command", listener);
      ipcRenderer.send("wengu:ready");
      return () => {
        ipcRenderer.off("wengu:command", listener);
      };
    },
  });
}
