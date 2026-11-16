/**
 * Host side of the sandbox: creates the iframe, speaks the protocol, validates everything the component sends,
 * enforces message budgets, and kills components that hang, flood, or navigate.
 *
 * Framework-agnostic: plain DOM. See react.tsx for a thin React wrapper.
 */

import type { Mode, ReviewResult } from './component-api.ts';
import { buildFrameDocument } from './frame-document.ts';
import { cloneJson, isPlainObject, type JsonObject } from './json.ts';
import { validatePackage, type ComponentPackage } from './manifest.ts';
import {
  parseFrameMessage,
  PROTOCOL_VERSION,
  type ConnectMessage,
  type ErrorPhase,
  type HostToFrameMessage,
  type LibraryBundle,
} from './protocol.ts';
import type { Theme } from './tokens.ts';

/**
 * How the sandbox document reaches the iframe.
 *  - `srcdoc`: no extra server. In Chromium the frame is (as measured) usually in the host's renderer process,
 *    so a busy component can freeze the host. It also inherits the host page's CSP.
 *  - `url`: the document is served from a dedicated sandbox origin (different *site* from the app). The frame gets
 *    its own process under site isolation, and only its own CSP.
 */
export type Delivery = { kind: 'srcdoc' } | { kind: 'url'; url: string };

export type HostStatus = 'loading' | 'ready' | 'error' | 'killed' | 'destroyed';

export type KillReason = 'unresponsive' | 'flood' | 'navigated' | 'protocol-abuse' | 'manual';

export type HostEvent =
  | { type: 'status'; status: HostStatus }
  | { type: 'ready'; mountMs: number; totalMs: number }
  | { type: 'resize'; height: number }
  | { type: 'result'; result: ReviewResult }
  | { type: 'error'; phase: ErrorPhase; message: string; stack?: string }
  | { type: 'violation'; reason: string }
  | { type: 'heartbeat'; rttMs: number }
  | { type: 'killed'; reason: KillReason; detail: string };

export interface HostOptions {
  /** Element the iframe is appended to. */
  container: HTMLElement;
  component: ComponentPackage;
  /** All libraries the app can provide. Only those named in the manifest are sent to the frame. */
  libraries: Record<string, LibraryBundle>;
  props: JsonObject;
  theme: Theme;
  mode: Mode;
  delivery?: Delivery;
  /** Liveness check. Default: ping every 500 ms, kill after 3000 ms without a pong. `false` disables. */
  watchdog?: { intervalMs: number; timeoutMs: number } | false;
  /** Message budget (token bucket). Default 120 msg/s sustained, burst 240. Exceeding it kills the component. */
  rateLimit?: { perSecond: number; burst: number };
  minHeight?: number;
  maxHeight?: number;
  onEvent?: (event: HostEvent) => void;
  /** Kill the component when its frame navigates away from the sandbox document. Default true. */
  killOnNavigation?: boolean;
  /** Test only. */
  dangerouslyOmitFrameCsp?: boolean;
}

const MAX_INVALID_MESSAGES = 50;

export class ComponentHost {
  readonly iframe: HTMLIFrameElement;
  private readonly opts: Required<Omit<HostOptions, 'onEvent' | 'dangerouslyOmitFrameCsp' | 'killOnNavigation' | 'delivery'>> &
    Pick<HostOptions, 'onEvent' | 'dangerouslyOmitFrameCsp' | 'killOnNavigation'> & { delivery: Delivery };
  private port: MessagePort | null = null;
  private _status: HostStatus = 'loading';
  private loads = 0;
  private createdAt = performance.now();
  private resultAccepted = false;
  private invalidCount = 0;
  private tokens: number;
  private lastRefill = performance.now();
  private watchdogTimer: ReturnType<typeof setInterval> | undefined;
  private pingSeq = 0;
  private pingSentAt = new Map<number, number>();
  private lastAliveAt = performance.now();

  constructor(options: HostOptions) {
    const pkg = validatePackage(options.component);
    if (!pkg.ok) throw new Error(`Invalid component: ${pkg.error}`);
    const props = cloneJson(options.props);
    if (!isPlainObject(props)) throw new Error('props must be a JSON object');

    this.opts = {
      ...options,
      component: pkg.value,
      props: props as JsonObject,
      delivery: options.delivery ?? { kind: 'srcdoc' },
      watchdog: options.watchdog ?? { intervalMs: 500, timeoutMs: 3000 },
      rateLimit: options.rateLimit ?? { perSecond: 120, burst: 240 },
      minHeight: options.minHeight ?? 120,
      maxHeight: options.maxHeight ?? 2000,
    };
    this.tokens = this.opts.rateLimit.burst;

    for (const id of pkg.value.manifest.libraries) {
      if (!options.libraries[id]) throw new Error(`Library "${id}" required by ${pkg.value.manifest.id} is not available`);
    }

    const iframe = document.createElement('iframe');
    // The only capability granted. No allow-same-origin: the frame gets an opaque origin, so it cannot touch the
    // host's DOM, storage or cookies. No allow-popups / allow-top-navigation / allow-forms / allow-modals.
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    iframe.setAttribute('title', pkg.value.manifest.title);
    iframe.style.cssText = `display:block;width:100%;border:0;height:${this.opts.minHeight}px;`;
    iframe.addEventListener('load', this.onLoad);
    if (this.opts.delivery.kind === 'srcdoc') {
      iframe.srcdoc = buildFrameDocument({ dangerouslyOmitCsp: options.dangerouslyOmitFrameCsp });
    } else {
      iframe.src = this.opts.delivery.url;
    }
    this.iframe = iframe;
    this.opts.container.append(iframe);
    this.emit({ type: 'status', status: 'loading' });
  }

  get status(): HostStatus {
    return this._status;
  }

  setTheme(theme: Theme): void {
    this.opts.theme = theme;
    this.post({ v: PROTOCOL_VERSION, type: 'theme', theme });
  }

  /** Changing mode or props remounts the component inside the same frame (its cleanup runs first). */
  remount(next: { mode?: Mode; props?: JsonObject }): void {
    if (next.mode) this.opts.mode = next.mode;
    if (next.props) {
      const p = cloneJson(next.props);
      if (!isPlainObject(p)) throw new Error('props must be a JSON object');
      this.opts.props = p as JsonObject;
    }
    if (this._status === 'killed' || this._status === 'destroyed') return;
    this.resultAccepted = false;
    this.setStatus('loading');
    this.post({ v: PROTOCOL_VERSION, type: 'remount', props: this.opts.props, mode: this.opts.mode });
  }

  /** Stop the component now: the iframe is removed, which tears down its document (and process, if it has one). */
  kill(reason: KillReason = 'manual', detail = ''): void {
    if (this._status === 'killed' || this._status === 'destroyed') return;
    this.teardown();
    this.setStatus('killed');
    this.emit({ type: 'killed', reason, detail });
  }

  destroy(): void {
    if (this._status === 'destroyed') return;
    this.teardown();
    this.setStatus('destroyed');
  }

  // ------------------------------------------------------------------------------------------ internals

  private teardown() {
    clearInterval(this.watchdogTimer);
    this.iframe.removeEventListener('load', this.onLoad);
    if (this.port) {
      this.port.onmessage = null;
      this.port.close();
      this.port = null;
    }
    this.iframe.remove();
  }

  private emit(e: HostEvent) {
    try {
      this.opts.onEvent?.(e);
    } catch (err) {
      console.error('[wengu/runtime] onEvent handler threw', err);
    }
  }

  private setStatus(s: HostStatus) {
    if (this._status === s) return;
    this._status = s;
    this.emit({ type: 'status', status: s });
  }

  private post(msg: HostToFrameMessage) {
    this.port?.postMessage(msg);
  }

  private onLoad = () => {
    this.loads++;
    if (this.loads > 1) {
      // The sandbox document only ever loads once. A second load means the frame navigated itself
      // (location = ..., meta refresh, link click). If the target was blocked, this is an error page; either way the
      // component is gone and may have tried to exfiltrate data through the URL.
      if (this.opts.killOnNavigation !== false) this.kill('navigated', 'the component frame navigated away from the sandbox document');
      else this.violation('frame navigated');
      return;
    }
    const win = this.iframe.contentWindow;
    if (!win) return;
    const channel = new MessageChannel();
    this.port = channel.port1;
    this.port.onmessage = this.onPortMessage;
    const connect: ConnectMessage = { type: 'wengu:connect', v: PROTOCOL_VERSION };
    // '*' is unavoidable (and safe): the sandboxed frame has an opaque origin that cannot be named. We only send
    // data the component is meant to have.
    win.postMessage(connect, '*', [channel.port2]);

    const { manifest, source } = this.opts.component;
    this.post({
      v: PROTOCOL_VERSION,
      type: 'init',
      manifest,
      source,
      libraries: manifest.libraries.map((id) => this.opts.libraries[id]!),
      props: this.opts.props,
      theme: this.opts.theme,
      mode: this.opts.mode,
    });
    this.lastAliveAt = performance.now();
    this.startWatchdog();
  };

  private startWatchdog() {
    const wd = this.opts.watchdog;
    if (!wd) return;
    let lastTick = performance.now();
    this.watchdogTimer = setInterval(() => {
      const t = performance.now();
      const stalled = t - lastTick > wd.intervalMs * 3;
      lastTick = t;
      if (stalled) {
        // Our own thread was blocked (e.g. the frame shares our process, or the app itself was busy): the missing
        // pongs say nothing about the component yet. Give it a fresh timeout from now.
        this.lastAliveAt = t;
      }
      if (t - this.lastAliveAt > wd.timeoutMs) {
        this.kill('unresponsive', `no heartbeat for ${Math.round(t - this.lastAliveAt)} ms`);
        return;
      }
      const seq = ++this.pingSeq;
      this.pingSentAt.set(seq, t);
      if (this.pingSentAt.size > 32) this.pingSentAt.delete(this.pingSentAt.keys().next().value!);
      this.post({ v: PROTOCOL_VERSION, type: 'ping', seq });
    }, wd.intervalMs);
  }

  private takeToken(): boolean {
    const t = performance.now();
    const { perSecond, burst } = this.opts.rateLimit;
    this.tokens = Math.min(burst, this.tokens + ((t - this.lastRefill) / 1000) * perSecond);
    this.lastRefill = t;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  private violation(reason: string) {
    this.emit({ type: 'violation', reason });
    if (++this.invalidCount > MAX_INVALID_MESSAGES) this.kill('protocol-abuse', `${this.invalidCount} invalid messages`);
  }

  private onPortMessage = (ev: MessageEvent) => {
    if (this._status === 'killed' || this._status === 'destroyed') return;
    if (!this.takeToken()) {
      this.kill('flood', `exceeded ${this.opts.rateLimit.perSecond} messages/s`);
      return;
    }
    if (ev.ports.length > 0) ev.ports.forEach((p) => p.close());
    const msg = parseFrameMessage(ev.data);
    if (!msg) {
      this.violation('malformed message');
      return;
    }
    switch (msg.type) {
      case 'pong': {
        const sentAt = this.pingSentAt.get(msg.seq);
        if (sentAt === undefined) {
          this.violation('pong for unknown ping');
          return;
        }
        this.pingSentAt.delete(msg.seq);
        this.lastAliveAt = performance.now();
        this.emit({ type: 'heartbeat', rttMs: this.lastAliveAt - sentAt });
        return;
      }
      case 'ready':
        if (this._status !== 'loading') {
          this.violation('unexpected ready');
          return;
        }
        this.setStatus('ready');
        this.emit({ type: 'ready', mountMs: msg.mountMs, totalMs: performance.now() - this.createdAt });
        return;
      case 'resize': {
        const h = Math.min(this.opts.maxHeight, Math.max(this.opts.minHeight, msg.height));
        this.iframe.style.height = `${h}px`;
        this.emit({ type: 'resize', height: h });
        return;
      }
      case 'result':
        if (this.opts.mode !== 'review') return this.violation('result outside review mode');
        if (this._status !== 'ready') return this.violation('result before ready');
        if (this.resultAccepted) return this.violation('duplicate result');
        this.resultAccepted = true;
        this.emit({ type: 'result', result: msg.result });
        return;
      case 'error':
        if (msg.phase === 'load' || msg.phase === 'mount') this.setStatus('error');
        this.emit({ type: 'error', phase: msg.phase, message: msg.message, ...(msg.stack ? { stack: msg.stack } : {}) });
        return;
    }
  };
}
