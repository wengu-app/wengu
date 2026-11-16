// Test harness page (no React). Playwright drives it through `window.harness`.
//   ?hostcsp=1  adds a host-page CSP restricting frame-src (see tests: frame self-navigation).
import { ComponentHost, themeFor, type HostEvent, type JsonObject, type Mode } from '../../src/index.ts';
import { libraries, moleculeViewer, ethanolProps } from './catalog.ts';
import hostile from '../../components/test/hostile.js?raw';
import busy from '../../components/test/busy.js?raw';
import heavy from '../../components/test/heavy.js?raw';

const params = new URLSearchParams(location.search);
export const SANDBOX_PORT = 5174;
const SANDBOX_CROSS_SITE = `http://127.0.0.1:${SANDBOX_PORT}/sandbox.html`;
const SANDBOX_SAME_SITE = `http://localhost:${SANDBOX_PORT}/sandbox.html`;

if (params.get('hostcsp') === '1') {
  const meta = document.createElement('meta');
  meta.httpEquiv = 'Content-Security-Policy';
  meta.content = `frame-src 'self' http://127.0.0.1:${SANDBOX_PORT} http://localhost:${SANDBOX_PORT}`;
  document.head.prepend(meta);
}

// Things a hostile component would like to steal.
try {
  localStorage.setItem('secret', 'host-local-storage-secret');
  document.cookie = 'secret=host-cookie-secret; SameSite=Lax';
  indexedDB.open('wengu').onupgradeneeded = (e) => (e.target as IDBOpenDBRequest).result.createObjectStore('cards');
} catch {
  /* ignore */
}

const sources: Record<string, { source: string; libraries: Array<'three'>; modes: Mode[] }> = {
  hostile: { source: hostile, libraries: [], modes: ['learn', 'review'] },
  busy: { source: busy, libraries: [], modes: ['learn'] },
  heavy: { source: heavy, libraries: ['three'], modes: ['learn'] },
  'syntax-error': { source: 'export function mount(root, ctx) {', libraries: [], modes: ['learn'] },
  'mount-throws': { source: 'export function mount() { throw new Error("boom") }', libraries: [], modes: ['learn'] },
  'no-mount': { source: 'export const x = 1;', libraries: [], modes: ['learn'] },
  'theme-probe': {
    source: `export function mount(root, ctx) {
      const d = document.createElement('div'); d.id = 'probe'; root.append(d);
      const show = (t) => { d.textContent = t.scheme + ' ' + getComputedStyle(document.documentElement).getPropertyValue('--wg-color-accent').trim(); };
      show(ctx.theme); ctx.onThemeChange(show);
      d.dataset.mode = ctx.mode;
      return () => { document.documentElement.dataset.cleaned = ctx.mode; };
    }`,
    libraries: [],
    modes: ['learn', 'review'],
  },
};

export interface MountOptions {
  component: 'hostile' | 'busy' | 'heavy' | 'molecule' | 'syntax-error' | 'mount-throws' | 'no-mount' | 'theme-probe';
  apiVersion?: number;
  delivery?: 'srcdoc' | 'url-cross-site' | 'url-same-site';
  mode?: Mode;
  props?: JsonObject;
  csp?: boolean;
  watchdog?: { intervalMs: number; timeoutMs: number } | false;
  killOnNavigation?: boolean;
}

const events: Array<HostEvent & { t: number }> = [];
const windowMessages: unknown[] = [];
const broadcasts: unknown[] = [];
const probes: number[] = [];
let host: ComponentHost | null = null;

addEventListener('message', (e) => windowMessages.push(e.data));
new BroadcastChannel('wengu-test').onmessage = (e) => broadcasts.push(e.data);

// Input responsiveness probe: how late does the host's main thread see a click?
document.getElementById('probe')!.addEventListener('click', (e) => {
  probes.push(performance.now() - e.timeStamp);
});

// Frame pacing recorder.
let frames: number[] = [];
let recording = false;
const rafLoop = (t: number) => {
  if (recording) frames.push(t);
  requestAnimationFrame(rafLoop);
};
requestAnimationFrame(rafLoop);

const harness = {
  mount(o: MountOptions) {
    host?.destroy();
    events.length = 0;
    const slot = document.getElementById('slot')!;
    const component =
      o.component === 'molecule'
        ? moleculeViewer
        : {
            manifest: {
              id: `test.${o.component}`,
              title: o.component,
              apiVersion: (o.apiVersion ?? 1) as 1,
              libraries: sources[o.component]!.libraries,
              knowledgePoints: [],
              sources: [],
              modes: sources[o.component]!.modes,
            },
            source: sources[o.component]!.source,
          };
    const delivery =
      o.delivery === 'url-cross-site'
        ? ({ kind: 'url', url: SANDBOX_CROSS_SITE } as const)
        : o.delivery === 'url-same-site'
          ? ({ kind: 'url', url: SANDBOX_SAME_SITE } as const)
          : ({ kind: 'srcdoc' } as const);
    host = new ComponentHost({
      container: slot,
      component,
      libraries,
      props: o.component === 'molecule' ? { ...ethanolProps, ...o.props } : (o.props ?? {}),
      theme: themeFor('light'),
      mode: o.mode ?? 'learn',
      delivery,
      ...(o.watchdog !== undefined ? { watchdog: o.watchdog } : {}),
      dangerouslyOmitFrameCsp: o.csp === false,
      ...(o.killOnNavigation !== undefined ? { killOnNavigation: o.killOnNavigation } : {}),
      onEvent: (e) => {
        events.push({ ...e, t: performance.now() });
        if (e.type === 'status') document.getElementById('status')!.textContent = e.status;
      },
    });
  },
  status: () => host?.status ?? 'none',
  events: () => events.map((e) => ({ ...e })),
  windowMessages: () => windowMessages.length,
  broadcasts: () => broadcasts.length,
  storage: () => ({ local: localStorage.getItem('secret'), cookie: document.cookie }),
  setMode: (mode: Mode) => host?.remount({ mode }),
  setTheme: (scheme: 'light' | 'dark') => host?.setTheme(themeFor(scheme)),
  iframeHeight: () => host?.iframe.style.height,
  kill: () => host?.kill('manual'),
  frameUrl: () => host?.iframe.src ?? null,
  startRecording() {
    frames = [];
    probes.length = 0;
    recording = true;
  },
  stopRecording() {
    recording = false;
    return { frames: [...frames], probes: [...probes] };
  },
};

declare global {
  interface Window {
    harness: typeof harness;
  }
}
window.harness = harness;
document.getElementById('status')!.textContent = 'harness-ready';
