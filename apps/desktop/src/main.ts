/**
 * Wengu desktop shell: serves the web build (apps/web/dist) from wengu://app and shows it in one hardened window.
 *
 * Environment (all optional):
 *   WENGU_DEV_URL         development only: load this dev-server URL instead of the built files.
 *   WENGU_WEB_DIST        development only: the web build to serve (default ../web/dist).
 *   WENGU_USER_DATA_DIR   where the profile (collection, settings, window state) lives; default <appData>/Wengu.
 *   WENGU_DOWNLOAD_DIR    save exports here without asking (automation); default: a native save dialog.
 *   WENGU_DEVTOOLS=1      allow DevTools in a packaged build.
 *   WENGU_DEBUG=1, WENGU_TIMING=1   log IPC/permission/download decisions, or startup timing, to stdout.
 *
 * `--mcp` runs an MCP server on stdin/stdout for local agents instead of the app (see mcp.ts); it relays tool calls
 * to the running app of the same profile.
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, session, shell, type IpcMainEvent, type MenuItemConstructorOptions } from "electron";
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { APP_ORIGIN, APP_URL, handleAppScheme, registerSchemePrivileges } from "./protocol.ts";
import { AgentBridge } from "./agentBridge.ts";
import { runMcpServer } from "./mcp.ts";
import type { AgentAnswer, AgentCall, AgentReply } from "../../web/src/agent/tools.ts";
import { applyCommandLineHardening, hardenSession, hardenWebContents, isAppUrl, type AppOrigins } from "./security.ts";
import { watchCardFrames } from "./frameWatchdog.ts";
import { initialBounds, loadWindowState, MIN_SIZE, trackWindowState } from "./windowState.ts";

const t0 = Date.now();
const debug = (msg: string) => {
  if (process.env.WENGU_DEBUG === "1") console.log(`[wengu] ${msg}`);
};
const DISPLAY_NAME = "温故";
const WEBSITE = "https://wengu.dev";
const ANKI_EXT = /\.(apkg|colpkg)$/i;

const devUrl = !app.isPackaged && process.env.WENGU_DEV_URL ? new URL(process.env.WENGU_DEV_URL) : null;
const origins: AppOrigins = { app: APP_ORIGIN, dev: devUrl ? devUrl.origin : null };
const startUrl = devUrl ? devUrl.href : APP_URL;
const webRoot = app.isPackaged ? path.join(app.getAppPath(), "web") : path.resolve(process.env.WENGU_WEB_DIST ?? path.join(__dirname, "../../web/dist"));

// ------------------------------------------------------------------------------------------------- before ready

// The profile lives in a stable, ASCII-named directory, whatever the display name: <appData>/Wengu
// (~/.config/Wengu, ~/Library/Application Support/Wengu, %APPDATA%\Wengu). Development uses its own.
// macOS shows app.name in the app menu ("Quit 温故"), matching the bundle's CFBundleName.
app.setName(process.platform === "darwin" ? DISPLAY_NAME : "Wengu");
// `--wengu-profile=<dir>` does the same as WENGU_USER_DATA_DIR (for `--mcp` commands, which agents start without our env).
const profileArg = process.argv.find((a) => a.startsWith("--wengu-profile="))?.slice("--wengu-profile=".length);
const profileDir = profileArg || process.env.WENGU_USER_DATA_DIR;
app.setPath("userData", profileDir ? path.resolve(profileDir) : path.join(app.getPath("appData"), app.isPackaged ? "Wengu" : "Wengu-dev"));
if (process.platform === "win32") app.setAppUserModelId("dev.wengu.app");

const mcpMode = process.argv.includes("--mcp");

registerSchemePrivileges();
applyCommandLineHardening(origins);

if (mcpMode) {
  // No window and no GPU: this process only relays between the agent and the app. On Linux its command also carries
  // --no-sandbox and --ozone-platform=headless (see mcpCommand): Chromium reads those before any of our code runs.
  app.disableHardwareAcceleration();
  app.dock?.hide();
  runMcpServer({ userData: app.getPath("userData"), version: app.getVersion(), exit: (code) => app.exit(code) });
} else if (!app.requestSingleInstanceLock()) {
  // One instance per profile: the database is held by one window (a Web Lock), so a second launch hands its files to
  // the first one and quits.
  app.quit();
} else {
  main();
}

function main(): void {
  let win: BrowserWindow | null = null;
  let rendererReady = false;
  const pending: string[] = [];

  /** `.apkg`/`.colpkg` paths in a command line (first launch or a second instance). */
  const filesIn = (argv: string[], cwd: string): string[] =>
    argv
      .slice(1)
      .filter((a) => !a.startsWith("-") && ANKI_EXT.test(a))
      .map((a) => path.resolve(cwd, a))
      .filter((p) => {
        try {
          return statSync(p).isFile();
        } catch {
          return false;
        }
      });

  const send = (command: unknown) => win?.webContents.send("wengu:command", command);

  async function importPath(file: string): Promise<void> {
    try {
      const bytes = await readFile(file);
      send({ type: "import", file: { name: path.basename(file), bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) } });
    } catch (e) {
      if (win) void dialog.showMessageBox(win, { type: "error", message: `Could not read ${path.basename(file)}`, detail: String(e) });
    }
  }

  function flush(): void {
    if (!rendererReady || !win) return;
    // One import at a time: the app shows one import dialog. Extra files opened at once are ignored.
    const next = pending.shift();
    pending.length = 0;
    if (next) void importPath(next);
  }

  function openFiles(files: string[]): void {
    debug(`open files ${JSON.stringify(files)} (renderer ready: ${rendererReady})`);
    if (files.length === 0) return;
    pending.push(...files);
    flush();
  }

  function focus(): void {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }

  openFiles(filesIn(process.argv.slice(app.isPackaged ? 0 : 1), process.cwd()));
  app.on("second-instance", (_e, argv, cwd) => {
    focus();
    openFiles(filesIn(argv.slice(app.isPackaged ? 0 : 1), cwd));
  });
  // macOS: Finder "Open With", dropping on the Dock icon (may arrive before `ready`).
  app.on("open-file", (e, file) => {
    e.preventDefault();
    if (ANKI_EXT.test(file) && existsSync(file)) openFiles([file]);
  });

  /** IPC only from the app's own top-level page. */
  const fromApp = (e: IpcMainEvent) => {
    const f = e.senderFrame;
    const main = win?.webContents.mainFrame;
    return !!win && !!f && !!main && e.sender === win.webContents && f.processId === main.processId && f.routingId === main.routingId && isAppUrl(f.url, origins);
  };
  // ----------------------------------------------------------------------------------------- agent access (MCP)

  let nextCall = 1;
  const calls = new Map<number, (r: AgentAnswer) => void>();
  const failCalls = (error: string) => {
    for (const done of calls.values()) done({ ok: false, error });
    calls.clear();
  };
  const bridge = new AgentBridge(
    app.getPath("userData"),
    (call) =>
      new Promise((resolve) => {
        if (!win || !rendererReady) return resolve({ ok: false, error: "Wengu is starting up; try again in a moment." });
        const id = nextCall++;
        const timer = setTimeout(() => {
          calls.delete(id);
          resolve({ ok: false, error: "Wengu did not answer in time." });
        }, 110_000);
        calls.set(id, (r) => {
          clearTimeout(timer);
          resolve(r);
        });
        send({ type: "agent-call", call: { ...call, id } satisfies AgentCall });
      }),
    debug,
  );
  ipcMain.on("wengu:agent-access", (e, on: unknown) => {
    if (!fromApp(e) || typeof on !== "boolean") return;
    bridge.setEnabled(on);
  });
  ipcMain.on("wengu:agent-reply", (e, r: AgentReply) => {
    if (!fromApp(e) || !r || typeof r.id !== "number") return;
    const done = calls.get(r.id);
    calls.delete(r.id);
    done?.(r.ok ? { ok: true, result: r.result } : { ok: false, error: String(r.error) });
  });
  app.on("will-quit", () => bridge.close());

  ipcMain.on("wengu:ready", (e) => {
    debug(`ready from ${e.senderFrame?.url} accepted=${fromApp(e)}`);
    if (!fromApp(e)) return;
    rendererReady = true;
    flush();
  });

  async function chooseImport(): Promise<void> {
    if (!win) return;
    const r = await dialog.showOpenDialog(win, {
      title: "Import",
      properties: ["openFile"],
      filters: [
        { name: "Anki deck package", extensions: ["apkg", "colpkg"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (!r.canceled && r.filePaths[0]) openFiles([r.filePaths[0]]);
  }

  function buildMenu(): void {
    const isMac = process.platform === "darwin";
    const dev = !app.isPackaged;
    const template: MenuItemConstructorOptions[] = [
      ...(isMac ? [{ role: "appMenu" as const }] : []),
      {
        label: "&File",
        submenu: [
          { id: "import", label: "&Import…", accelerator: "CmdOrCtrl+O", click: () => void chooseImport() },
          { id: "export", label: "&Export…", accelerator: "CmdOrCtrl+Shift+E", click: () => send({ type: "export" }) },
          { type: "separator" },
          isMac ? { role: "close" } : { role: "quit" },
        ],
      },
      { role: "editMenu" },
      {
        label: "&View",
        submenu: [
          { role: "reload" },
          ...(dev ? [{ role: "forceReload" as const }, { role: "toggleDevTools" as const }] : []),
          { type: "separator" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          // Ctrl+= as in browsers (the role's own accelerator is Ctrl+Plus, i.e. Ctrl+Shift+= on most layouts)
          { role: "zoomIn", accelerator: "CmdOrCtrl+=", visible: false, acceleratorWorksWhenHidden: true },
          { role: "zoomOut" },
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
      { role: "windowMenu" },
      {
        role: "help",
        submenu: [
          { label: "wengu.dev", click: () => void shell.openExternal(WEBSITE) },
          ...(isMac ? [] : [{ role: "about" as const }]),
        ],
      },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }

  function createWindow(): void {
    const state = loadWindowState(app.getPath("userData"));
    const dark = nativeTheme.shouldUseDarkColors;
    win = new BrowserWindow({
      ...initialBounds(state),
      minWidth: MIN_SIZE.width,
      minHeight: MIN_SIZE.height,
      show: false,
      title: DISPLAY_NAME,
      titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
      // On Linux pure transparent black falls back to the system title-bar background.
      titleBarOverlay: process.platform === "linux" ? { color: "#01000000", symbolColor: dark ? "#efece4" : "#5b5850", height: 68 } : true,
      autoHideMenuBar: true,
      backgroundColor: dark ? "#141311" : "#f7f4ee",
      ...(process.platform === "linux" ? { icon: path.join(__dirname, "../resources/icons/512x512.png") } : {}),
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        additionalArguments: [`--wengu-app-origin=${devUrl ? devUrl.origin : APP_ORIGIN}`, `--wengu-agent-command=${JSON.stringify(mcpCommand())}`],
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        nodeIntegrationInSubFrames: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        experimentalFeatures: false,
        webviewTag: false,
        navigateOnDragDrop: false,
        spellcheck: false,
        safeDialogs: true,
        enableWebSQL: false,
        devTools: !app.isPackaged || process.env.WENGU_DEVTOOLS === "1",
      },
    });
    trackWindowState(win, app.getPath("userData"));
    const appBase = devUrl ? devUrl.origin : APP_ORIGIN;
    watchCardFrames(win, (u) => u.startsWith(`${appBase}/card-frame.html`), (m) => console.warn(`[wengu] ${m}`), debug);
    if (state.maximized) win.maximize();
    if (state.fullscreen) win.setFullScreen(true);

    const wc = win.webContents;
    wc.on("did-start-navigation", (details) => {
      if (details.isMainFrame && !details.isSameDocument) {
        rendererReady = false;
        failCalls("Wengu reloaded; try again.");
      }
    });
    wc.on("render-process-gone", () => {
      rendererReady = false;
      failCalls("Wengu's window stopped; try again.");
    });
    win.once("ready-to-show", () => {
      win?.show();
      if (process.env.WENGU_TIMING === "1") console.log(`[wengu] ready-to-show ${Date.now() - t0} ms after main start`);
    });
    win.on("closed", () => {
      win = null;
      rendererReady = false;
    });
    void win.loadURL(startUrl);
  }

  /** How agents start the MCP server for this profile: [executable, ...args]. */
  function mcpCommand(): string[] {
    const args = app.isPackaged ? [] : [app.getAppPath()];
    // AppImage: the stable path is the image, not the temporary mount the process runs from
    const exe = process.env.APPIMAGE ?? process.execPath;
    // Linux: no display needed (agents may run over SSH), and no Chromium sandbox: this process loads no web content,
    // and the sandbox is unavailable outside the .deb on many hosts, where it would abort the start.
    const linux = process.platform === "linux" ? ["--no-sandbox", "--ozone-platform=headless"] : [];
    return [exe, ...args, "--mcp", ...linux, ...(profileDir ? [`--wengu-profile=${app.getPath("userData")}`] : [])];
  }

  app.on("window-all-closed", () => app.quit());
  app.on("activate", () => {
    if (!win && app.isReady()) createWindow();
  });

  app.whenReady().then(async () => {
    app.setAboutPanelOptions({ applicationName: DISPLAY_NAME, applicationVersion: app.getVersion(), website: WEBSITE, copyright: "AGPL-3.0-or-later" });
    if (!devUrl) handleAppScheme(webRoot);
    app.on("session-created", (ses) => void hardenSession(ses, origins));
    await hardenSession(session.defaultSession, origins);
    // Every web contents (our window, and anything that should never exist: webviews, popups) gets the same policy.
    app.on("web-contents-created", (_e, contents) => hardenWebContents(contents, origins));
    buildMenu();
    createWindow();
  });
}
