/**
 * Content-Security-Policies of the app page and of the card frame. Dependency-free (imported by vite.config.ts).
 *
 * Card frame (deck templates are untrusted code): no network at all. Scripts and styles may be inline (Anki templates
 * need that) or blob: (media files the template references, created inside the frame from Blobs the app posts in).
 * Images, audio and fonts only from blob:/data:. No forms, no <base>, no plugins, no nested frames.
 *
 * App page: only its own files. `frame-src 'self'` also stops the card frame from navigating itself to another origin
 * (a sandboxed frame can still navigate itself; the embedding page's frame-src is what blocks that).
 */
export const FRAME_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' blob:",
  "style-src 'unsafe-inline' blob: data:",
  "img-src blob: data:",
  "media-src blob: data:",
  "font-src blob: data:",
  "connect-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

/** Matches @wengu/runtime sandbox document CSP: offline blob/wasm ESM execution without network egress. */
export const VISUAL_FRAME_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:",
  "style-src 'unsafe-inline' blob: data:",
  "img-src data: blob:",
  "font-src data: blob:",
  "media-src data: blob:",
  "connect-src data: blob:",
  "worker-src blob:",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

export const HOST_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "media-src 'self' blob: data:",
  "font-src 'self' data:",
  "connect-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");
