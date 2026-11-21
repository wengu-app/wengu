// Test harness page (no React). Playwright drives it through `window.harness`.
//   The page is served with the host-page CSP from hostPageCsp() (injected by vite.config.ts), like the demo.
//   ?hostcsp=0  serves it WITHOUT that CSP: the unprotected control in tests/navigation.spec.ts.
import {
  ComponentHost,
  themeFor,
  type HostCspCheck,
  type HostEvent,
  type JsonObject,
  type Mode,
  type Phase,
} from '../../src/index.ts';
import { libraries, moleculeViewer, ethanolProps } from './catalog.ts';
import hostile from '../../components/test/hostile.js?raw';
import busy from '../../components/test/busy.js?raw';
import heavy from '../../components/test/heavy.js?raw';

export const SANDBOX_PORT = 5174;
const SANDBOX_CROSS_SITE = `http://127.0.0.1:${SANDBOX_PORT}/sandbox.html`;
const SANDBOX_SAME_SITE = `http://localhost:${SANDBOX_PORT}/sandbox.html`;

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
  'phase-probe': {
    source: `export function mount(root, ctx) {
      let stateToken = Math.random().toString(36).slice(2, 8);
      let mounts = Number(document.documentElement.dataset.mounts || '0') + 1;
      document.documentElement.dataset.mounts = String(mounts);
      const box = document.createElement('div');
      box.id = 'phase-probe';
      box.dataset.token = stateToken;
      box.dataset.phase = ctx.phase;
      box.textContent = ctx.phase + ':' + stateToken;
      const btn = document.createElement('button');
      btn.id = 'ask-reveal';
      btn.textContent = 'Check';
      btn.addEventListener('click', () => ctx.requestReveal());
      root.append(box, btn);
      ctx.onPhaseChange((p) => {
        box.dataset.phase = p;
        box.textContent = ctx.phase + ':' + stateToken;
      });
      return () => { document.documentElement.dataset.cleanedPhase = ctx.phase; };
    }`,
    libraries: [],
    modes: ['learn', 'review'],
  },
  'shortcut-probe': {
    source: `export function mount(root) {
      const wrap = document.createElement('div');
      const stage = document.createElement('div');
      stage.id = 'stage';
      stage.tabIndex = 0;
      stage.textContent = 'focus stage';
      const input = document.createElement('input');
      input.id = 'text-input';
      input.type = 'text';
      const btn = document.createElement('button');
      btn.id = 'action-btn';
      btn.type = 'button';
      btn.textContent = 'button';
      wrap.append(stage, input, btn);
      root.append(wrap);
    }`,
    libraries: [],
    modes: ['review'],
  },
  'primitives-probe': {
    source: `import * as THREE from 'three';
import { createCardShell, createStepController, pickVariant } from 'wengu/card';
import { createScene3D } from 'wengu/scene3d';

export function mount(root, ctx) {
  const variant = pickVariant(['alpha', 'beta'], 'seed-1');
  const shell = createCardShell(root, ctx, {
    height: 380,
    prompt: 'Identify structure (' + variant + ')',
    hint: 'Drag to rotate',
  });
  const s3d = createScene3D(shell.stage, ctx, { height: 380, cameraPosition: [0, 0.5, 4] });
  const geo = new THREE.SphereGeometry(0.6, 24, 16);
  const mat = new THREE.MeshStandardMaterial({ color: ctx.theme.tokens.color.accent });
  const mesh = new THREE.Mesh(geo, mat);
  s3d.scene.add(mesh);

  const label = s3d.addLabel('Target Sphere', [0, 0.9, 0], { visible: ctx.phase === 'reveal' });
  const steps = createStepController(ctx, {
    steps: ['before', 'after'],
    questionStep: 0,
    revealStep: 1,
    onChange: (step, idx) => {
      shell.root.dataset.step = step;
      shell.root.dataset.stepIndex = String(idx);
    },
  });
  const stepBox = document.createElement('div');
  stepBox.id = 'step-controls';
  shell.root.append(stepBox);
  steps.mountControls(stepBox);

  s3d.enablePicking(() => [mesh], {
    onClick: (hit) => { if (hit) ctx.requestReveal(); },
  });

  ctx.onThemeChange((t) => {
    mat.color.set(t.tokens.color.accent);
    s3d.requestRender();
  });

  const syncPhase = (p) => {
    label.setVisible(p === 'reveal');
    if (p === 'reveal') {
      label.setHighlighted(true);
      s3d.focusCamera([0.8, 0.9, 3.2], [0, 0, 0], 120);
      shell.showFeedback({ title: 'Revealed!', body: 'Sphere active', tone: 'success' });
    } else {
      shell.hideFeedback();
    }
  };
  syncPhase(ctx.phase);
  ctx.onPhaseChange(syncPhase);

  return () => {
    geo.dispose();
    mat.dispose();
  };
}`,
    libraries: ['three'],
    modes: ['learn', 'review'],
  },
};

export interface MountOptions {
  component:
    | 'hostile'
    | 'busy'
    | 'heavy'
    | 'molecule'
    | 'syntax-error'
    | 'mount-throws'
    | 'no-mount'
    | 'theme-probe'
    | 'phase-probe'
    | 'shortcut-probe'
    | 'primitives-probe';
  apiVersion?: number;
  delivery?: 'srcdoc' | 'url-cross-site' | 'url-same-site';
  mode?: Mode;
  phase?: Phase;
  props?: JsonObject;
  csp?: boolean;
  watchdog?: { intervalMs: number; timeoutMs: number } | false;
  killOnNavigation?: boolean;
  hostCspCheck?: HostCspCheck;
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
      phase: o.phase ?? 'question',
      delivery,
      ...(o.watchdog !== undefined ? { watchdog: o.watchdog } : {}),
      dangerouslyOmitFrameCsp: o.csp === false,
      ...(o.killOnNavigation !== undefined ? { killOnNavigation: o.killOnNavigation } : {}),
      ...(o.hostCspCheck !== undefined ? { hostCspCheck: o.hostCspCheck } : {}),
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
  setPhase: (phase: Phase) => host?.setPhase(phase),
  setTheme: (scheme: 'light' | 'dark') => host?.setTheme(themeFor(scheme)),
  iframeHeight: () => host?.iframe.style.height,
  kill: () => host?.kill('manual'),
  frameUrl: () => host?.iframe.src ?? null,
  /** Host-page CSPs delivered by <meta> (the dev server sends none as headers). */
  hostCsp: () => [...document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]')].map((m) => m.getAttribute('content')),
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
