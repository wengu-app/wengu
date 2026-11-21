/**
 * Host <-> component wire protocol, version 1.
 *
 * Transport:
 *  1. The host creates the sandboxed iframe. When it fires `load`, the host posts ONE message on the iframe's window,
 *     `{ type: 'wengu:connect', v: 1 }`, transferring a MessagePort. Target origin must be '*': the frame's origin is opaque.
 *  2. All further traffic goes over that dedicated MessagePort, one port per component instance. The host never
 *     listens on `window` for component traffic, so other frames (or the component posting to `parent`) cannot inject.
 *  3. Every message carries `v` (protocol version) and `type`. Receivers validate and drop anything else.
 *
 * Trust: the host is trusted by the frame. Nothing from the frame is trusted by the host — the in-frame bootstrap
 * runs in the same realm as the untrusted component, which can patch globals and send arbitrary messages on the port.
 */

import { SHORTCUT_KEYS, type Mode, type Phase, type ReviewResult, type ShortcutKey } from './component-api.ts';
import type { ComponentManifest } from './manifest.ts';
import type { Theme, DesignTokens } from './tokens.ts';
import { cloneJson, isPlainObject, type JsonObject } from './json.ts';

export const PROTOCOL_VERSION = 1 as const;

export interface ConnectMessage {
  type: 'wengu:connect';
  v: typeof PROTOCOL_VERSION;
}

/** A library made available to components via the frame's import map. */
export interface LibraryBundle {
  id: string;
  version: string;
  /** Bare specifier -> self-contained ES module source. E.g. 'three', 'three/addons/controls/OrbitControls.js'. */
  modules: Record<string, string>;
  /** CSS injected into the frame before the component loads (e.g. KaTeX). */
  styles?: string[];
}

// ---------------------------------------------------------------------------------------------- host -> frame

export interface InitMessage {
  v: 1;
  type: 'init';
  manifest: ComponentManifest;
  source: string;
  libraries: LibraryBundle[];
  props: JsonObject;
  theme: Theme;
  mode: Mode;
  phase?: Phase;
}

/** Theme changed: the frame updates CSS variables and notifies onThemeChange listeners. No remount. */
export interface ThemeMessage {
  v: 1;
  type: 'theme';
  theme: Theme;
}

/** Phase changed ('question' <-> 'reveal'): notifies onPhaseChange listeners in place. No remount. */
export interface PhaseMessage {
  v: 1;
  type: 'phase';
  phase: Phase;
}

/** Mode or props changed: the frame runs the component's cleanup and calls mount again with a fresh context. */
export interface RemountMessage {
  v: 1;
  type: 'remount';
  props: JsonObject;
  mode: Mode;
  phase?: Phase;
}

/** Liveness probe. The frame answers `pong` from its main thread; no answer means the thread is blocked. */
export interface PingMessage {
  v: 1;
  type: 'ping';
  seq: number;
}

export type HostToFrameMessage = InitMessage | ThemeMessage | PhaseMessage | RemountMessage | PingMessage;

// ---------------------------------------------------------------------------------------------- frame -> host

/** The component's mount() returned (or its promise resolved). */
export interface ReadyMessage {
  v: 1;
  type: 'ready';
  /** Time spent in import + mount, ms, as measured inside the frame. Informational only. */
  mountMs: number;
}

/** The document's content height changed. */
export interface ResizeMessage {
  v: 1;
  type: 'resize';
  height: number;
}

export interface ResultMessage {
  v: 1;
  type: 'result';
  result: ReviewResult;
}

export interface RevealRequestMessage {
  v: 1;
  type: 'reveal-request';
}

export interface ShortcutMessage {
  v: 1;
  type: 'shortcut';
  code: ShortcutKey;
}

export type ErrorPhase = 'load' | 'mount' | 'runtime' | 'policy';

export interface ErrorMessage {
  v: 1;
  type: 'error';
  phase: ErrorPhase;
  message: string;
  stack?: string;
}

export interface PongMessage {
  v: 1;
  type: 'pong';
  seq: number;
}

export type FrameToHostMessage =
  | ReadyMessage
  | ResizeMessage
  | ResultMessage
  | RevealRequestMessage
  | ShortcutMessage
  | ErrorMessage
  | PongMessage;

// ---------------------------------------------------------------------------------------------- validation

export const LIMITS = {
  maxHeight: 20_000,
  maxMessage: 2_000,
  maxStack: 4_000,
  maxDetail: 500,
} as const;

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s);

/**
 * Validates a message received from the frame. Returns a fresh, normalised object (never the original),
 * or null if the message is malformed. Never throws, whatever it is given.
 */
export function parseFrameMessage(data: unknown): FrameToHostMessage | null {
  try {
    if (!isPlainObject(data) || data.v !== PROTOCOL_VERSION || typeof data.type !== 'string') return null;
    switch (data.type) {
      case 'ready': {
        const mountMs = typeof data.mountMs === 'number' && Number.isFinite(data.mountMs) ? Math.max(0, data.mountMs) : 0;
        return { v: 1, type: 'ready', mountMs };
      }
      case 'resize': {
        const h = data.height;
        if (typeof h !== 'number' || !Number.isFinite(h) || h < 0) return null;
        return { v: 1, type: 'resize', height: Math.min(Math.ceil(h), LIMITS.maxHeight) };
      }
      case 'result': {
        const r = data.result;
        if (!isPlainObject(r)) return null;
        if (r.outcome !== 'correct' && r.outcome !== 'incorrect') return null;
        const result: ReviewResult = { outcome: r.outcome };
        if (r.score !== undefined) {
          if (typeof r.score !== 'number' || !(r.score >= 0 && r.score <= 1)) return null;
          result.score = r.score;
        }
        if (r.detail !== undefined) {
          if (typeof r.detail !== 'string') return null;
          result.detail = clip(r.detail, LIMITS.maxDetail);
        }
        if (r.response !== undefined) {
          const response = cloneJson(r.response, { maxDepth: 8, maxNodes: 500, maxStringLength: 2_000 });
          if (response === undefined) return null;
          result.response = response;
        }
        return { v: 1, type: 'result', result };
      }
      case 'reveal-request':
        return { v: 1, type: 'reveal-request' };
      case 'shortcut': {
        if (typeof data.code !== 'string' || !SHORTCUT_KEYS.includes(data.code as ShortcutKey)) return null;
        return { v: 1, type: 'shortcut', code: data.code as ShortcutKey };
      }
      case 'error': {
        const phases: ErrorPhase[] = ['load', 'mount', 'runtime', 'policy'];
        if (!phases.includes(data.phase as ErrorPhase) || typeof data.message !== 'string') return null;
        const msg: ErrorMessage = { v: 1, type: 'error', phase: data.phase as ErrorPhase, message: clip(data.message, LIMITS.maxMessage) };
        if (typeof data.stack === 'string') msg.stack = clip(data.stack, LIMITS.maxStack);
        return msg;
      }
      case 'pong': {
        if (typeof data.seq !== 'number' || !Number.isSafeInteger(data.seq)) return null;
        return { v: 1, type: 'pong', seq: data.seq };
      }
      default:
        return null;
    }
  } catch {
    // Getters/proxies cannot survive structured clone, but be defensive anyway.
    return null;
  }
}

function isTheme(t: unknown): t is Theme {
  return isPlainObject(t) && (t.scheme === 'light' || t.scheme === 'dark') && isPlainObject(t.tokens) && isPlainObject((t.tokens as unknown as DesignTokens).color);
}

const isMode = (m: unknown): m is Mode => m === 'learn' || m === 'review';

const isPhase = (p: unknown): p is Phase => p === 'question' || p === 'reveal';

/** Validates a message received by the frame from the host. */
export function parseHostMessage(data: unknown): HostToFrameMessage | null {
  if (!isPlainObject(data) || data.v !== PROTOCOL_VERSION || typeof data.type !== 'string') return null;
  switch (data.type) {
    case 'init':
      if (typeof data.source !== 'string' || !isPlainObject(data.manifest) || !Array.isArray(data.libraries)) return null;
      if (!isPlainObject(data.props) || !isTheme(data.theme) || !isMode(data.mode)) return null;
      if (data.phase !== undefined && !isPhase(data.phase)) return null;
      for (const lib of data.libraries) if (!isPlainObject(lib) || !isPlainObject(lib.modules)) return null;
      return data as unknown as InitMessage;
    case 'theme':
      return isTheme(data.theme) ? (data as unknown as ThemeMessage) : null;
    case 'phase':
      return isPhase(data.phase) ? (data as unknown as PhaseMessage) : null;
    case 'remount':
      if (data.phase !== undefined && !isPhase(data.phase)) return null;
      return isPlainObject(data.props) && isMode(data.mode) ? (data as unknown as RemountMessage) : null;
    case 'ping':
      return typeof data.seq === 'number' ? (data as unknown as PingMessage) : null;
    default:
      return null;
  }
}

export function isConnectMessage(data: unknown): data is ConnectMessage {
  return isPlainObject(data) && data.type === 'wengu:connect' && data.v === PROTOCOL_VERSION;
}
