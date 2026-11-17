// Browser side of the self-check (bundled by server.ts, served as /host.js on a page that carries hostPageCsp()).
// Playwright drives it through `window.wg`. Uses the runtime's real ComponentHost with `url` delivery from a
// cross-site sandbox origin, so the frame gets its own process and the watchdog can see a hung component.
import { ComponentHost, themeFor, type ComponentManifest, type HostEvent, type LibraryBundle, type Mode } from '@wengu/runtime';

declare global {
  interface Window {
    wg: typeof wg;
    WG_CONFIG: { sandboxUrl: string };
  }
}

let libraries: Record<string, LibraryBundle> = {};
let host: ComponentHost | null = null;
let events: Array<HostEvent & { t: number }> = [];

async function loadLibraries(ids: string[]) {
  for (const id of ids) {
    if (libraries[id]) continue;
    const r = await fetch(`/libs/${id}.json`);
    libraries[id] = (await r.json()) as LibraryBundle;
  }
}

const wg = {
  async mount(o: { manifest: ComponentManifest; source: string; props: Record<string, string>; mode: Mode; scheme: 'light' | 'dark' }) {
    host?.destroy();
    events = [];
    await loadLibraries(o.manifest.libraries);
    const slot = document.getElementById('slot')!;
    slot.replaceChildren();
    host = new ComponentHost({
      container: slot,
      component: { manifest: o.manifest, source: o.source },
      libraries,
      props: o.props,
      theme: themeFor(o.scheme),
      mode: o.mode,
      delivery: { kind: 'url', url: window.WG_CONFIG.sandboxUrl },
      hostCspCheck: 'enforce',
      onEvent: (e) => {
        events.push({ ...e, t: performance.now() });
        if (e.type === 'status') document.body.dataset.status = e.status;
      },
    });
  },
  setTheme(scheme: 'light' | 'dark') {
    host?.setTheme(themeFor(scheme));
    document.body.dataset.scheme = scheme;
  },
  status: () => host?.status ?? 'none',
  events: () => events.map((e) => ({ ...e })),
  height: () => (host ? parseFloat(host.iframe.style.height) || null : null),
  destroy() {
    host?.destroy();
    host = null;
  },
};

window.wg = wg;
document.body.dataset.wg = 'ready';
