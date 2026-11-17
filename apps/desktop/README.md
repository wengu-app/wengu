# @wengu/desktop

Wengu (温故) as a desktop app: the finished web app (`apps/web`) in an Electron shell. The shell adds a native window
and menu, file associations for `.apkg`/`.colpkg`, and a much tighter sandbox for the untrusted code that Anki deck
templates contain. Everything the app does is still the web app; the shell has no features of its own.

Status: Linux (AppImage, deb) is built and run-tested. macOS (separate Apple silicon and Intel dmg + zip) and Windows (NSIS)
build in the CI workflow but are unsigned and have **never been run on a real machine**.

## Commands

Run from `apps/desktop` (or with `corepack pnpm --filter @wengu/desktop run <script>` from the repo root). First:
`corepack pnpm install --filter @wengu/desktop...` (installs the web app and its packages too).

| Command | What it does |
|---|---|
| `corepack pnpm dev` | Bundles the shell and runs it against `apps/web/dist` (builds the web app first if missing). Arguments after `--` go to Electron, e.g. a path to an `.apkg`. |
| `corepack pnpm dev:vite` | Starts the web app's Vite dev server (port `VITE_PORT`, default 5173) and points the shell at it. Hot reload; no response-header CSP. |
| `corepack pnpm build` | Builds the web app and bundles the shell (`out/main.cjs`, `out/preload.cjs`). |
| `corepack pnpm pack` | Build, then an unpacked app in `dist/<platform>-unpacked/` (quick to try). |
| `corepack pnpm dist:linux` | Build, then `dist/Wengu-<version>-x86_64.AppImage` and `dist/wengu_<version>_amd64.deb`. |
| `corepack pnpm dist:mac` | Build, then a `dmg` and `zip` each for Apple silicon (arm64) and Intel (x64) (on macOS only). |
| `corepack pnpm dist:win` | Build, then an NSIS installer (on Windows, or Linux with wine; untested). |
| `corepack pnpm test` | End-to-end tests against the dev shell. |
| `WENGU_APP_EXECUTABLE=… corepack pnpm test:packaged` | The same tests against a packaged binary (AppImage, or `opt/Wengu/wengu` from the deb). |
| `corepack pnpm icons` | Regenerates `resources/` icons from `apps/web/public/favicon.svg` (needs a CJK serif font). |

Packaging goes through `scripts/package.mjs`, which always passes `--publish never` and, where pnpm only exists via
corepack, puts a `pnpm` shim on PATH for electron-builder. Build output (`out/`, `dist/`) is git-ignored.

On Linux hosts that forbid unprivileged user namespaces (Ubuntu 23.10+), Chromium's sandbox needs an AppArmor
profile. The `.deb` installs one (electron-builder's postinst). The AppImage and the dev shell do not have one: there
they abort with "No usable sandbox" unless started with `--no-sandbox` (`corepack pnpm dev -- --no-sandbox`). The app
never turns the sandbox off by itself. The tests take `WENGU_TEST_NO_SANDBOX=1` for such hosts. AppImages also need
`libfuse2`; without it run them with `--appimage-extract-and-run`.

Useful environment variables: `WENGU_USER_DATA_DIR` (profile location), `WENGU_DOWNLOAD_DIR` (save exports there
without a dialog), `WENGU_DEVTOOLS=1` (DevTools in a packaged build), `WENGU_DEBUG=1`, `WENGU_TIMING=1`.

## How it fits together

- `src/protocol.ts` serves `apps/web/dist` (inside `app.asar` when packaged) at `wengu://app/`, a privileged scheme
  (standard, secure, fetch, streaming, code cache). The page is a secure context with its own origin, so OPFS, Web
  Locks and module workers work as on https. Only files inside the web build are served.
- `src/main.ts` creates the window, menu, single-instance lock and file handling. Files opened from the OS (command
  line, file association, a second launch, macOS `open-file`) and File → Import… (native open dialog) are read by the
  main process and handed to the page.
- `src/preload.ts` exposes one function to the app's top-level page: `window.wenguDesktop.onCommand(cb)`. The web app
  subscribes in `apps/web/src/lib/desktop.ts` (and does nothing when it is absent, i.e. in a browser).
- Exports are ordinary browser downloads (`blob:` from the app), saved through a native save dialog.
- `src/frameWatchdog.ts` recovers from deck scripts that never yield (see below).

## Security model

Deck templates are untrusted HTML/JS. The web app runs them in `<iframe sandbox="allow-scripts">` (opaque origin, no
app data) loading `card-frame.html` with a no-network CSP. The shell adds:

- **Renderer**: `contextIsolation`, `sandbox` (also forced for all renderers with `app.enableSandbox()`), no
  `nodeIntegration` (also not in workers or subframes), `webSecurity` on, no insecure content, no experimental or
  Blink features, no `<webview>`, no spellchecker, no navigation on file drop. DevTools only in development.
- **Preload**: one function, only in the top-level frame, only when the page's origin is the app's. IPC handlers check
  that the sender is the main frame of the app window at the app origin.
- **CSP as response headers**: `index.html` gets the app policy, `card-frame.html` the frame policy (both imported
  from `apps/web/src/frame/csp.ts`, the same strings as the build's `<meta>` tags), scripts get a worker policy.
  Plus `Permissions-Policy` denying device APIs, `nosniff`, `no-referrer`.
- **Navigation and windows**: every navigation (any frame) and redirect away from `wengu://app` is cancelled. Links
  the app page itself follows, and its `window.open`, go to the system browser (http/https/mailto only); a navigation
  started by the card frame is never handed to the OS. No second Electron window can open.
- **Permissions**: all permission requests and checks are denied (camera, microphone, geolocation, notifications,
  clipboard read, MIDI, HID/USB/serial/Bluetooth, display capture, …).
- **No network at all**: every http(s)/ws(s)/ftp request is cancelled (`webRequest`); host resolution is disabled
  (`--host-resolver-rules=MAP * ~NOTFOUND`, which also stops DNS prefetch/preconnect); WebRTC is restricted to
  proxied connections (`disable_non_proxied_udp`) and the session proxy is a dead end (`127.0.0.1:9`), so WebRTC
  has no route out (in plain Chromium the same deck reaches STUN/TURN servers and arbitrary peers).
- **Card frames in their own process**: sandboxed iframes are site-isolated (`IsolateSandboxedIframes`), so a deck
  script that loops forever only blocks its own renderer. The app's watchdog cannot revive such a frame by itself
  (Chromium can send a reload to the same busy process), so the shell kills a card-frame renderer that has not answered
  for 3.5 s (never one that hosts the app page). The page's 5 s watchdog removes and reinserts the iframe to create a
  fresh browsing context, then replays the latest card after the handshake. Missing load/ready messages also time out;
  advancing to another card does not wait for a broken frame. A template that always loops still cannot be displayed,
  but it does not prevent the learner from continuing to a working card.
- **Downloads**: only `blob:` URLs created by the app page.
- **Fuses**: `RunAsNode`, `EnableNodeOptionsEnvironmentVariable`, `EnableNodeCliInspectArguments` and
  `GrantFileProtocolExtraPrivileges` off; `EnableCookieEncryption`, `EnableEmbeddedAsarIntegrityValidation` (macOS,
  Windows) and `OnlyLoadAppFromAsar` on.

`tests/hostile.spec.ts` builds hostile decks (fetch, XHR, images, CSS, fonts, media, WebSocket, EventSource, beacon,
WebTransport, prefetch/preload/preconnect/dns-prefetch, popups, forms, top navigation, nested frames, workers,
permissions, WebRTC with STUN/TURN and with a forged peer, frame navigations, an endless loop) and checks what
reaches local test servers and Chromium's net log.

## Where the data lives

The collection is in Chromium's Origin Private File System for `wengu://app`, inside the profile directory:

- Linux: `~/.config/Wengu/`
- macOS: `~/Library/Application Support/Wengu/`
- Windows: `%APPDATA%\Wengu\`

The SQLite database and media files are under `File System/` with opaque numbered names (the database file has a
4 KiB header from SQLite's OPFS pool in front of it); settings are in `Local Storage/`. To back up or move a
collection, either export an `.apkg` with progress (File → Export…) and import it on the other machine, or quit the
app and copy the whole profile directory. Uninstalling does not remove the profile.

## Auto-update

Not included. The build already emits what electron-updater needs (`latest*.yml`, blockmaps, a mac `zip`; a generic
publish URL under https://wengu.dev/download/ is configured as a placeholder) so it can be added without changing
targets; macOS updates additionally need a signed app.
