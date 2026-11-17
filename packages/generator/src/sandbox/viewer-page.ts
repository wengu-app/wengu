// Interactive viewer for generated components (served by server.ts as /viewer.js). Lists every component directory
// under the served root, mounts the chosen one in the real sandbox, and lets you switch mode and theme.
import {
  ComponentHost,
  themeFor,
  tokensToCssVariables,
  type ColorScheme,
  type ComponentManifest,
  type LibraryBundle,
  type Mode,
} from '@wengu/runtime';

declare global {
  interface Window {
    WG_CONFIG: { sandboxUrl: string };
  }
}

interface Entry {
  name: string;
  manifest: ComponentManifest;
  accepted: boolean | null;
  attempts: number | null;
  costUsd: number | null;
  model: string | null;
}

const libraries: Record<string, LibraryBundle> = {};
let host: ComponentHost | null = null;
const params = new URLSearchParams(location.search);
let scheme: ColorScheme = params.get('theme') === 'dark' ? 'dark' : 'light';
let mode: Mode = params.get('mode') === 'review' ? 'review' : 'learn';
let current: Entry | null = null;

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

function applyPageTheme() {
  const de = document.documentElement;
  for (const [k, v] of Object.entries(tokensToCssVariables(themeFor(scheme).tokens))) de.style.setProperty(k, v);
  de.style.colorScheme = scheme;
  $('#theme').textContent = scheme === 'light' ? '深色 / dark' : '浅色 / light';
}

function log(text: string, tone = '') {
  const li = document.createElement('li');
  li.textContent = `${new Date().toLocaleTimeString()}  ${text}`;
  if (tone) li.className = tone;
  $('#log').prepend(li);
}

async function mount() {
  if (!current) return;
  const e = current;
  host?.destroy();
  $('#log').replaceChildren();
  $('#result').textContent = '';
  for (const id of e.manifest.libraries) {
    if (!libraries[id]) libraries[id] = (await (await fetch(`/libs/${id}.json`)).json()) as LibraryBundle;
  }
  const source = await (await fetch(`/components/${encodeURIComponent(e.name)}/component.js`)).text();
  const propsRes = await fetch(`/components/${encodeURIComponent(e.name)}/props.json`);
  const props = propsRes.ok ? ((await propsRes.json()) as Record<string, string>) : {};
  if (!e.manifest.modes.includes(mode)) mode = e.manifest.modes[0]!;
  $('#mode').textContent = mode === 'learn' ? '学习 learn → 复习 review' : '复习 review → 学习 learn';
  ($('#mode') as HTMLButtonElement).disabled = e.manifest.modes.length < 2;
  const slot = $('#slot');
  slot.replaceChildren();
  host = new ComponentHost({
    container: slot,
    component: { manifest: e.manifest, source },
    libraries,
    props,
    theme: themeFor(scheme),
    mode,
    delivery: { kind: 'url', url: window.WG_CONFIG.sandboxUrl },
    hostCspCheck: 'enforce',
    onEvent: (ev) => {
      switch (ev.type) {
        case 'ready':
          log(`ready · mount ${ev.mountMs.toFixed(0)} ms`, 'ok');
          break;
        case 'result':
          log(`result · ${ev.result.outcome}${ev.result.detail ? ' · ' + ev.result.detail : ''}`, ev.result.outcome === 'correct' ? 'ok' : 'bad');
          $('#result').textContent = JSON.stringify(ev.result, null, 1);
          break;
        case 'error':
          log(`error[${ev.phase}] ${ev.message}`, 'bad');
          break;
        case 'killed':
          log(`killed (${ev.reason}) ${ev.detail}`, 'bad');
          break;
        case 'violation':
          log(`violation · ${ev.reason}`, 'warn');
          break;
        case 'unprotected':
          log(`unprotected host page · ${ev.detail}`, 'bad');
          break;
      }
    },
  });
  const q = new URLSearchParams({ c: e.name, mode, theme: scheme });
  history.replaceState(null, '', `?${q}`);
}

async function main() {
  applyPageTheme();
  const list = (await (await fetch('/api/components')).json()) as Entry[];
  const nav = $('#list');
  for (const e of list) {
    const b = document.createElement('button');
    b.className = 'item';
    const status = e.accepted === null ? '' : e.accepted ? '✓' : '✗';
    b.innerHTML = `<span class="st ${e.accepted ? 'ok' : 'bad'}">${status}</span><span class="t"></span><small></small>`;
    b.querySelector('.t')!.textContent = e.manifest.title;
    b.querySelector('small')!.textContent =
      `${e.name}${e.attempts ? ` · ${e.attempts} attempt(s)` : ''}${e.costUsd !== null ? ` · $${e.costUsd.toFixed(2)}` : ''}`;
    b.onclick = () => {
      current = e;
      for (const x of nav.querySelectorAll('.item')) x.classList.toggle('active', x === b);
      $('#title').textContent = e.manifest.title;
      $('#meta').innerHTML = `<a href="/components/${encodeURIComponent(e.name)}/report.json" target="_blank">report.json</a> · <a href="/components/${encodeURIComponent(e.name)}/component.js" target="_blank">component.js</a>${e.model ? ` · ${e.model}` : ''}`;
      void mount();
    };
    nav.append(b);
    if (e.name === params.get('c') || (!params.get('c') && list[0] === e)) queueMicrotask(() => b.click());
  }
  if (list.length === 0) nav.textContent = 'No components found in the served directory.';
  $('#theme').onclick = () => {
    scheme = scheme === 'light' ? 'dark' : 'light';
    applyPageTheme();
    host?.setTheme(themeFor(scheme));
  };
  $('#mode').onclick = () => {
    mode = mode === 'learn' ? 'review' : 'learn';
    void mount();
  };
  $('#remount').onclick = () => void mount();
}

void main();
