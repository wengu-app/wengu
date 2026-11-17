/**
 * Session and web-contents hardening. The app needs no network at all and runs untrusted deck code (templates) in a
 * sandboxed iframe, so the defaults here are "deny everything that is not the app's own files".
 */
import { app, shell, type Session, type WebContents } from "electron";

import { SCHEME, HOST } from "./protocol.ts";

/** The origin the app is served from: wengu://app, or the Vite dev server in `dev` against it. */
export interface AppOrigins {
  app: string;
  /** http(s) origin of a dev server, if the shell was started against one (development only). */
  dev: string | null;
}

export function isAppUrl(raw: string, origins: AppOrigins): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol === `${SCHEME}:` && u.host === HOST) return true;
  return origins.dev !== null && u.origin === origins.dev;
}

/** Links the app itself shows (website, docs) may open in the system browser; nothing else ever is handed to the OS. */
export function isExternalLink(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" || u.protocol === "mailto:";
  } catch {
    return false;
  }
}

/** Process-wide switches. Must run before `app` is ready. */
export function applyCommandLineHardening(origins: AppOrigins): void {
  // Every renderer is sandboxed, whatever a BrowserWindow says.
  app.enableSandbox();
  // No DNS at all: no prefetch, no preconnect, no WebRTC STUN/TURN name lookups, no DNS-based exfiltration.
  // (The dev server is reached by IP literal; localhost stays resolvable only in development.)
  app.commandLine.appendSwitch("host-resolver-rules", origins.dev ? "MAP * ~NOTFOUND, EXCLUDE localhost" : "MAP * ~NOTFOUND");
  // WebRTC may only use proxied connections; the session proxy below is a dead end, so it has no route out.
  app.commandLine.appendSwitch("force-webrtc-ip-handling-policy", "disable_non_proxied_udp");
  // Sandboxed iframes (deck templates) in their own renderer process, so a deck script that loops forever cannot
  // freeze the app (Chromium's default on desktop; stated explicitly so an Electron/Chromium change cannot undo it).
  app.commandLine.appendSwitch("enable-features", "IsolateSandboxedIframes");
}

/** Session-wide policy. Must run after `app` is ready, before any page loads. */
export async function hardenSession(ses: Session, origins: AppOrigins): Promise<void> {
  // Permissions: none. Camera, microphone, geolocation, notifications, MIDI, clipboard read, HID/USB/serial,
  // fullscreen, pointer lock, idle detection, storage access… are all refused, for the app and the card frame alike.
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    if (process.env.WENGU_DEBUG === "1") console.log(`[wengu] permission request denied: ${permission} from ${details.requestingUrl}`);
    callback(false);
  });
  ses.setPermissionCheckHandler((_wc, permission, origin) => {
    if (process.env.WENGU_DEBUG === "1") console.log(`[wengu] permission check denied: ${permission} from ${origin}`);
    return false;
  });
  ses.setDevicePermissionHandler(() => false);
  ses.setDisplayMediaRequestHandler((_request, callback) => callback({}));
  ses.setBluetoothPairingHandler((_details, callback) => callback({ confirmed: false }));
  ses.setUSBProtectedClassesHandler(() => []);
  for (const ev of ["select-hid-device", "select-serial-port", "select-usb-device"] as const) {
    ses.on(ev as "select-hid-device", (event, _details, callback) => {
      event.preventDefault();
      (callback as (id?: string | null) => void)(null);
    });
  }
  // No spellchecker, and no hunspell dictionary download from Google's CDN (Windows/Linux would fetch one).
  ses.setSpellCheckerEnabled(false);
  ses.setSpellCheckerDictionaryDownloadURL("https://spellcheck.invalid/");
  if (process.platform !== "darwin") {
    try {
      ses.setSpellCheckerLanguages([]);
    } catch {
      /* not supported here */
    }
  }

  // Network: the app is served from its own scheme and never talks to anything. Every http(s)/ws(s)/ftp request is
  // cancelled before it starts (the dev server excepted in development).
  ses.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*", "ftp://*/*"] }, (details, callback) => {
    const allowed = origins.dev !== null && (() => {
      try {
        const u = new URL(details.url);
        return u.host === new URL(origins.dev!).host;
      } catch {
        return false;
      }
    })();
    callback({ cancel: !allowed });
  });
  // A proxy that goes nowhere: anything that would bypass webRequest (WebRTC TCP/TURN candidates under the
  // disable_non_proxied_udp policy) has no route.
  await ses.setProxy(
    origins.dev
      ? { mode: "fixed_servers", proxyRules: "http=127.0.0.1:9;https=127.0.0.1:9;socks=127.0.0.1:9", proxyBypassRules: new URL(origins.dev).host }
      : { mode: "fixed_servers", proxyRules: "127.0.0.1:9;socks=127.0.0.1:9", proxyBypassRules: "<-loopback>" },
  );
  await ses.closeAllConnections();

  // Downloads: only the app's own exports (blob: URLs it created). Nothing from the card frame or elsewhere.
  ses.on("will-download", (event, item) => {
    const url = item.getURL();
    if (process.env.WENGU_DEBUG === "1") console.log(`[wengu] download ${url} ${item.getFilename()}`);
    const ok = url.startsWith(`blob:${origins.app}/`) || (origins.dev !== null && url.startsWith(`blob:${origins.dev}/`));
    if (!ok) {
      event.preventDefault();
      return;
    }
    const name = item.getFilename().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_") || "wengu.apkg";
    const dir = process.env.WENGU_DOWNLOAD_DIR;
    if (dir) item.setSavePath(`${dir.replace(/[\\/]+$/, "")}/${name}`);
    else
      item.setSaveDialogOptions({
        defaultPath: `${app.getPath("downloads")}/${name}`,
        filters: name.toLowerCase().endsWith(".apkg") ? [{ name: "Anki deck package", extensions: ["apkg"] }] : [],
      });
  });
}

/** Per-window policy: no navigation away from the app, no new windows, no webviews. */
export function hardenWebContents(wc: WebContents, origins: AppOrigins): void {
  wc.setWebRTCIPHandlingPolicy("disable_non_proxied_udp");

  wc.on("will-frame-navigate", (event) => {
    if (isAppUrl(event.url, origins)) return;
    event.preventDefault();
    // A link the app's own page navigates to (e.g. the website) goes to the system browser. A navigation started by
    // the card frame never does: deck code must not be able to make the OS open a URL carrying data.
    const by = event.initiator;
    const fromAppPage = by !== null && by !== undefined && by.processId === wc.mainFrame.processId && by.routingId === wc.mainFrame.routingId;
    if (event.isMainFrame && fromAppPage && isExternalLink(event.url)) void shell.openExternal(event.url);
  });
  wc.on("will-redirect", (event) => {
    if (!isAppUrl(event.url, origins)) event.preventDefault();
  });
  wc.setWindowOpenHandler((details) => {
    // Only the app page can open windows at all (the card frame's sandbox has no allow-popups). Its target=_blank
    // links go to the system browser; the app never opens a second Electron window.
    if (isExternalLink(details.url) && isAppUrl(wc.getURL(), origins)) void shell.openExternal(details.url);
    return { action: "deny" };
  });
  wc.on("will-attach-webview", (event) => event.preventDefault());
}
