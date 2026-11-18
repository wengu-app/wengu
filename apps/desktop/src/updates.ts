import { app, dialog, type BrowserWindow } from "electron";
import type { UpdateState } from "../../web/src/lib/desktop.ts";
import { autoUpdater } from "electron-updater";
import { configureRequestOptionsFromUrl, HttpExecutor, type DownloadOptions } from "builder-util-runtime";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import { request } from "node:https";

// Only the main process can start an update. Chromium, including every card renderer,
// keeps its no-DNS/no-network policy. The updater still checks the manifest's SHA-512.
export class UpdateTransport extends HttpExecutor<ClientRequest> {
  createRequest(options: RequestOptions, callback: (response: IncomingMessage) => void) {
    return request(options, callback);
  }

  download(url: URL, destination: string, options: DownloadOptions): Promise<string> {
    return options.cancellationToken.createPromise((resolve, reject, onCancel) => {
      this.doDownload(configureRequestOptionsFromUrl(url.href, { headers: options.headers ?? {} }), {
        destination, options, onCancel, responseHandler: null,
        callback: error => error ? reject(error) : resolve(destination),
      }, 0);
    });
  }
}

export function startUpdates(getWindow: () => BrowserWindow | null, notify: (state: UpdateState) => void) {
  Object.assign(autoUpdater, { httpExecutor: new UpdateTransport() });
  autoUpdater.disableDifferentialDownload = true;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  let state: UpdateState = { phase: "idle" };
  let checking = false;
  function set(next: UpdateState) {
    state = next;
    notify(next);
  }
  function failed(version: string, error: unknown) {
    set({ phase: "error", version, message: error instanceof Error ? error.message : String(error) });
  }
  autoUpdater.on("download-progress", progress => {
    if (state.phase !== "downloading" || !Number.isFinite(progress.percent)) return;
    const percent = Math.min(99, Math.max(state.percent, Math.floor(progress.percent)));
    if (percent !== state.percent) set({ ...state, percent });
  });
  autoUpdater.on("error", error => {
    if (state.phase === "installing") failed(state.version, error);
  });

  async function check(manual = false) {
    if (checking || !["idle", "available", "error"].includes(state.phase)) return;
    checking = true;
    const win = getWindow();
    const zh = app.getLocale().startsWith("zh");
    try {
      const result = await autoUpdater.checkForUpdates();
      if (result?.isUpdateAvailable) set({ phase: "available", version: result.updateInfo.version });
      else {
        set({ phase: "idle" });
        if (manual && win && !win.isDestroyed()) await dialog.showMessageBox(win, { message: zh ? "当前已是最新版本。" : "Wengu is up to date." });
      }
    } catch (error) {
      if (manual && win && !win.isDestroyed()) await dialog.showMessageBox(win, { type: "error", message: zh ? "检查更新失败" : "Update check failed", detail: String(error) });
    } finally {
      checking = false;
    }
  }

  async function download() {
    if (checking || (state.phase !== "available" && state.phase !== "error")) return;
    const retry = state.phase === "error";
    let version = state.version;
    set({ phase: "downloading", version, percent: 0 });
    try {
      if (retry) {
        const result = await autoUpdater.checkForUpdates();
        if (!result?.isUpdateAvailable) return set({ phase: "idle" });
        version = result.updateInfo.version;
        set({ phase: "downloading", version, percent: 0 });
      }
      await autoUpdater.downloadUpdate();
      set({ phase: "ready", version });
    } catch (error) {
      failed(version, error);
    }
  }

  function install() {
    if (state.phase !== "ready") return;
    const version = state.version;
    set({ phase: "installing", version });
    try {
      autoUpdater.quitAndInstall();
    } catch (error) {
      failed(version, error);
    }
  }

  const startup = setTimeout(() => void check(), 15_000);
  const interval = setInterval(() => void check(), 6 * 60 * 60_000);
  app.once("will-quit", () => { clearTimeout(startup); clearInterval(interval); });
  return { check, download, install, get state() { return state; } };
}
