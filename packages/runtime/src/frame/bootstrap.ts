/**
 * In-frame runtime. Bundled to a classic-script IIFE and inlined into the sandbox document (see scripts/build-frame.mjs).
 *
 * This code runs in the same realm as the untrusted component. It is a convenience layer for component authors,
 * NOT a security boundary: the component can patch anything here. The boundary is the iframe sandbox + CSP, and
 * the host's validation of every message.
 */

import {
  SHORTCUT_KEYS,
  type Cleanup,
  type ComponentContext,
  type Mode,
  type MountFunction,
  type Phase,
  type ReviewResult,
  type ShortcutKey,
} from '../component-api.ts';
import { CARD_PRIMITIVE_JS } from '../generated/card-primitive.ts';
import type { JsonObject } from '../json.ts';
import { SUPPORTED_API_VERSIONS } from '../manifest.ts';
import {
  isConnectMessage,
  parseHostMessage,
  PROTOCOL_VERSION,
  type ErrorPhase,
  type FrameToHostMessage,
  type InitMessage,
} from '../protocol.ts';
import { tokensToCssVariables, type Theme } from '../tokens.ts';

(() => {
  // Capture built-ins before component code runs, so accidental monkey-patching by a component or library
  // does not break the runtime. (Deliberate tampering is out of scope here; the host does not trust us.)
  const postOnPort = MessagePort.prototype.postMessage;
  const now = () => performance.now();

  let port: MessagePort | null = null;
  let mountFn: MountFunction | null = null;
  let theme: Theme | null = null;
  let phase: Phase = 'question';
  let revealRequested = false;
  const themeListeners = new Set<(t: Theme) => void>();
  const phaseListeners = new Set<(p: Phase) => void>();
  let current: { cleanup: Cleanup | null; abort: AbortController } | null = null;
  let errorsSent = 0;

  const send = (msg: FrameToHostMessage) => {
    if (port) postOnPort.call(port, msg);
  };

  const sendError = (phase: ErrorPhase, err: unknown) => {
    if (errorsSent++ >= 50) return;
    const e = err instanceof Error ? err : null;
    const msg = {
      v: PROTOCOL_VERSION,
      type: 'error',
      phase,
      message: e ? `${e.name}: ${e.message}` : String(err),
    } as const;
    send(e?.stack ? { ...msg, stack: e.stack } : msg);
  };

  const rootEl = () => document.getElementById('wg-root') as HTMLElement;

  // ------------------------------------------------------------------ global error reporting
  addEventListener('error', (ev) => sendError('runtime', ev.error ?? ev.message));
  addEventListener('unhandledrejection', (ev) => sendError('runtime', ev.reason));
  // CSP violations are expected for misbehaving components; forwarding them helps self-checking after generation.
  addEventListener('securitypolicyviolation', (ev) =>
    sendError('policy', `${ev.effectiveDirective} blocked ${ev.blockedURI || '(inline)'}`),
  );

  // ------------------------------------------------------------------ theme & phase
  const applyTheme = (t: Theme) => {
    theme = t;
    const de = document.documentElement;
    for (const [k, v] of Object.entries(tokensToCssVariables(t.tokens))) de.style.setProperty(k, v);
    de.style.colorScheme = t.scheme;
    de.dataset.theme = t.scheme;
    for (const l of [...themeListeners]) {
      try {
        l(t);
      } catch (e) {
        sendError('runtime', e);
      }
    }
  };

  const applyPhase = (next: Phase) => {
    phase = next;
    revealRequested = false;
    document.documentElement.dataset.phase = next;
    for (const l of [...phaseListeners]) {
      try {
        l(next);
      } catch (e) {
        sendError('runtime', e);
      }
    }
  };

  // ------------------------------------------------------------------ keyboard shortcut forwarding
  const isEditable = (el: EventTarget | null): boolean => {
    if (!(el instanceof Element)) return false;
    if (el instanceof HTMLElement && el.isContentEditable) return true;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  };

  addEventListener('keydown', (ev) => {
    if (ev.defaultPrevented || ev.ctrlKey || ev.metaKey || ev.altKey || ev.repeat) return;
    if (isEditable(ev.target) || isEditable(document.activeElement)) return;
    if (!SHORTCUT_KEYS.includes(ev.code as ShortcutKey)) return;
    const code = ev.code as ShortcutKey;
    const interactiveTarget = ev.target instanceof Element && ev.target.closest('button, a');
    if (code === 'Space' && !interactiveTarget) {
      ev.preventDefault();
    }
    send({ v: PROTOCOL_VERSION, type: 'shortcut', code });
  });

  // ------------------------------------------------------------------ size reporting
  let lastHeight = -1;
  let resizeQueued = false;
  const measure = () => {
    resizeQueued = false;
    const r = rootEl();
    const h = Math.ceil(Math.max(r.scrollHeight, r.getBoundingClientRect().height));
    if (h !== lastHeight) {
      lastHeight = h;
      send({ v: PROTOCOL_VERSION, type: 'resize', height: h });
    }
  };
  const queueMeasure = () => {
    if (!resizeQueued) {
      resizeQueued = true;
      requestAnimationFrame(measure);
    }
  };

  // ------------------------------------------------------------------ mounting
  const unmount = () => {
    if (!current) return;
    const { cleanup, abort } = current;
    current = null;
    abort.abort();
    try {
      cleanup?.();
    } catch (e) {
      sendError('runtime', e);
    }
    themeListeners.clear();
    phaseListeners.clear();
    rootEl().replaceChildren();
  };

  const mount = async (props: JsonObject, mode: Mode, initialPhase: Phase, startedAt: number) => {
    unmount();
    applyPhase(initialPhase);
    const abort = new AbortController();
    const slot: { cleanup: Cleanup | null; abort: AbortController } = { cleanup: null, abort };
    current = slot;
    let submitted = false;
    const ctx: ComponentContext = Object.freeze({
      apiVersion: 1 as const,
      mode,
      get phase() {
        return phase;
      },
      props: Object.freeze(structuredClone(props)),
      get theme() {
        return theme!;
      },
      onThemeChange(listener: (t: Theme) => void) {
        themeListeners.add(listener);
        return () => void themeListeners.delete(listener);
      },
      onPhaseChange(listener: (p: Phase) => void) {
        phaseListeners.add(listener);
        return () => void phaseListeners.delete(listener);
      },
      requestReveal() {
        if (revealRequested || abort.signal.aborted || phase === 'reveal') return;
        revealRequested = true;
        send({ v: PROTOCOL_VERSION, type: 'reveal-request' });
      },
      submitResult(result: ReviewResult) {
        if (submitted || abort.signal.aborted) return;
        submitted = true;
        send({ v: PROTOCOL_VERSION, type: 'result', result: structuredClone(result) });
      },
      signal: abort.signal,
    });
    try {
      const ret = await mountFn!(rootEl(), ctx);
      if (typeof ret === 'function') {
        if (current === slot) slot.cleanup = ret;
        else ret(); // unmounted while mounting
      }
    } catch (e) {
      sendError('mount', e);
      return;
    }
    if (current !== slot) return;
    send({ v: PROTOCOL_VERSION, type: 'ready', mountMs: now() - startedAt });
    queueMeasure();
  };

  const load = async (msg: InitMessage) => {
    const t0 = now();
    if (!SUPPORTED_API_VERSIONS.includes(msg.manifest.apiVersion)) {
      sendError('load', `Unsupported component apiVersion ${String(msg.manifest.apiVersion)}`);
      return;
    }
    applyTheme(msg.theme);

    // Libraries: blob URLs must be minted in this (opaque) origin; blob URLs made by the host would be unreadable.
    const imports: Record<string, string> = {
      'wengu/card': URL.createObjectURL(new Blob([CARD_PRIMITIVE_JS], { type: 'text/javascript' })),
    };
    for (const lib of msg.libraries) {
      for (const [specifier, code] of Object.entries(lib.modules)) {
        imports[specifier] = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      }
      for (const css of lib.styles ?? []) {
        const style = document.createElement('style');
        style.textContent = css;
        document.head.append(style);
      }
    }
    // The import map must be in place before the first module is imported. Nothing has been imported yet:
    // this bootstrap is a classic script.
    const map = document.createElement('script');
    map.type = 'importmap';
    map.textContent = JSON.stringify({ imports });
    document.head.append(map);

    const url = URL.createObjectURL(new Blob([msg.source], { type: 'text/javascript' }));
    let ns: { mount?: unknown };
    try {
      ns = (await import(/* @vite-ignore */ url)) as { mount?: unknown };
    } catch (e) {
      sendError('load', e);
      return;
    }
    if (typeof ns.mount !== 'function') {
      sendError('load', 'Component module must export a function named `mount`');
      return;
    }
    mountFn = ns.mount as MountFunction;
    new ResizeObserver(queueMeasure).observe(rootEl());
    await mount(msg.props, msg.mode, msg.phase ?? 'question', t0);
  };

  // ------------------------------------------------------------------ host messages
  const onHostMessage = (ev: MessageEvent) => {
    const msg = parseHostMessage(ev.data);
    if (!msg) return;
    switch (msg.type) {
      case 'ping':
        send({ v: PROTOCOL_VERSION, type: 'pong', seq: msg.seq });
        break;
      case 'init':
        if (!mountFn) void load(msg);
        break;
      case 'theme':
        applyTheme(msg.theme);
        break;
      case 'phase':
        applyPhase(msg.phase);
        break;
      case 'remount':
        if (mountFn) void mount(msg.props, msg.mode, msg.phase ?? 'question', now());
        break;
    }
  };

  // ------------------------------------------------------------------ handshake: accept exactly one port from the parent
  const onConnect = (ev: MessageEvent) => {
    if (ev.source !== parent || !isConnectMessage(ev.data) || ev.ports.length !== 1) return;
    removeEventListener('message', onConnect);
    port = ev.ports[0]!;
    port.onmessage = onHostMessage;
  };
  addEventListener('message', onConnect);
})();
