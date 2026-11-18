/**
 * Preload for the app's top-level page (sandboxed; runs only in the main frame because nodeIntegrationInSubFrames is
 * off, so the card frame never gets it). Exposes `window.wenguDesktop.onCommand`, through which the shell delivers menu
 * commands, files opened from the OS and tool calls from local agents, and `wenguDesktop.agent` to turn agent access
 * on or off and answer those calls. Nothing else of Electron or Node reaches the page.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

import type { DesktopCommand } from "../../web/src/lib/desktop.ts";

// The shell's URL: wengu://app in a packaged build, or the dev server it was started against.
const allowed = (process.argv.find((a) => a.startsWith("--wengu-app-origin=")) ?? "").slice("--wengu-app-origin=".length);
const agentCommand = (() => {
  try {
    const v = JSON.parse((process.argv.find((a) => a.startsWith("--wengu-agent-command=")) ?? "").slice("--wengu-agent-command=".length)) as unknown;
    return Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : [];
  } catch {
    return [];
  }
})();

if (window.top === window && allowed && location.origin === allowed) {
  contextBridge.exposeInMainWorld("wenguDesktop", {
    platform: process.platform,
    update(action: "download" | "install") {
      ipcRenderer.send("wengu:update-action", action);
    },
    onCommand(cb: (command: DesktopCommand) => void): () => void {
      if (typeof cb !== "function") throw new TypeError("onCommand needs a function");
      const listener = (_e: IpcRendererEvent, command: DesktopCommand) => cb(command);
      ipcRenderer.on("wengu:command", listener);
      ipcRenderer.send("wengu:ready");
      return () => {
        ipcRenderer.off("wengu:command", listener);
      };
    },
    agent: {
      /** The command line agents run to reach this profile: [executable, ...args]. */
      command: agentCommand,
      /** Opens or closes the local agent socket. */
      setAccess(on: boolean): void {
        ipcRenderer.send("wengu:agent-access", on === true);
      },
      /** Answers an "agent-call" command. */
      reply(r: { id: number; ok: boolean; result?: unknown; error?: string }): void {
        ipcRenderer.send("wengu:agent-reply", r);
      },
    },
  });
}
