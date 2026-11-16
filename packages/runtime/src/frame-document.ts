import { FRAME_BOOTSTRAP_JS } from './generated/frame-bootstrap.ts';

/**
 * Content-Security-Policy of the sandbox document.
 *
 * Its job is egress control, not XSS protection: the component is arbitrary code by design, so allowing inline
 * script and eval adds no capability. What matters is that every fetch-like directive allows only `data:`/`blob:`,
 * which can only carry data that is already inside the frame.
 *
 * Not covered by CSP (see tests/navigation.spec.ts, tests/webrtc-dns.spec.ts):
 *  - the frame navigating itself to an external URL: stopped only by the *host page's* `frame-src`;
 *  - WebRTC (STUN/TURN): not stoppable from the page in Chromium; needs browser/Electron-level controls.
 */
export const FRAME_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:",
  "style-src 'unsafe-inline' blob: data:",
  'img-src data: blob:',
  'font-src data: blob:',
  'media-src data: blob:',
  'connect-src data: blob:',
  'worker-src blob:',
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  // CSP3 draft directive. Not implemented by Chromium 153 (verified: WebRTC still egresses with it). Harmless; kept
  // so the policy tightens automatically if/when browsers ship it.
  "webrtc 'block'",
].join('; ');

export interface FrameDocumentOptions {
  /** For tests only: omit the CSP to show which attacks the CSP (rather than the sandbox) stops. */
  dangerouslyOmitCsp?: boolean;
}

/** The complete HTML of the sandbox document. Used as `srcdoc`, or served from a sandbox origin. */
export function buildFrameDocument(options: FrameDocumentOptions = {}): string {
  const csp = options.dangerouslyOmitCsp ? '' : `<meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}">`;
  const script = FRAME_BOOTSTRAP_JS.replace(/<\/(script)/gi, '<\\/$1');
  return `<!doctype html>
<html><head><meta charset="utf-8">${csp}
<meta name="referrer" content="no-referrer">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
/* No scrollbar: the host sizes the iframe to the content, and a transient scrollbar while it does would change the
   content width and reflow the component. */
html,body{margin:0;padding:0}
html{scrollbar-width:none}
body{background:var(--wg-color-surface,transparent);color:var(--wg-color-text,inherit);font-family:var(--wg-font-sans,system-ui,sans-serif);font-size:var(--wg-font-size-md,15px);line-height:var(--wg-line-height,1.5);-webkit-font-smoothing:antialiased}
#wg-root{display:flow-root}
</style>
<script>${script}</script>
</head><body><div id="wg-root"></div></body></html>`;
}
