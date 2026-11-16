// Navigation-based exfiltration: the component navigates its own frame (or the top window) to a URL carrying data.
// CSP3 has no directive for a document's own navigations (navigate-to was dropped), so this file pins down what
// actually stops each variant. Results are also written to test-results/navigation-matrix.json.
import { test, expect } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { startEvilServers, type EvilServers } from './servers.ts';
import { openHarness, mount, waitForStatus, events } from './helpers.ts';

let evil: EvilServers;
test.beforeAll(async () => {
  evil = await startEvilServers();
});
test.afterAll(async () => evil.close());
test.beforeEach(() => evil.reset());

const results: Record<string, unknown> = {};
test.afterAll(() => {
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/navigation-matrix.json', JSON.stringify(results, null, 2));
});

type Attack = 'nav-location' | 'nav-meta-refresh' | 'nav-anchor' | 'nav-data' | 'nav-blob' | 'nav-about-blank' | 'nav-top';
const EXTERNAL: Attack[] = ['nav-location', 'nav-meta-refresh', 'nav-anchor'];
const LOCAL_SCHEME: Attack[] = ['nav-data', 'nav-blob', 'nav-about-blank'];
const DELIVERIES = ['srcdoc', 'url-cross-site'] as const;

async function run(
  page: import('@playwright/test').Page,
  o: { attack: Attack; delivery: (typeof DELIVERIES)[number]; hostCsp: boolean; killOnNavigation: boolean; csp?: boolean },
) {
  await openHarness(page, { hostCsp: o.hostCsp });
  const topUrl = page.url();
  await mount(page, {
    component: 'hostile',
    delivery: o.delivery,
    killOnNavigation: o.killOnNavigation,
    ...(o.csp === false ? { csp: false } : {}),
    props: { attack: o.attack, evil: evil.evil },
  });
  await waitForStatus(page, 'ready');
  await page.waitForTimeout(2000);
  const frame = page.frames().find((f) => f !== page.mainFrame());
  const killed = (await events(page)).find((e) => e.type === 'killed') as { reason: string } | undefined;
  const r = {
    hits: evil.names(),
    killed: killed?.reason ?? null,
    frameUrl: frame ? frame.url().slice(0, 50) : '(frame removed)',
    topNavigated: page.url() !== topUrl,
  };
  results[`${o.attack} | ${o.delivery} | hostCsp=${o.hostCsp} | kill=${o.killOnNavigation}${o.csp === false ? ' | frameCsp=off' : ''}`] = r;
  return r;
}

for (const delivery of DELIVERIES) {
  test.describe(delivery, () => {
    for (const attack of EXTERNAL) {
      test(`KNOWN GAP ${attack}: without a host frame-src CSP, self-navigation leaks the URL; host detects and kills`, async ({ page }) => {
        const r = await run(page, { attack, delivery, hostCsp: false, killOnNavigation: true });
        // The request reaches the attacker before the host can react: detection is not prevention.
        expect(r.hits).toEqual([attack]);
        expect(r.killed).toBe('navigated');
      });

      test(`${attack}: the host page's frame-src CSP blocks it before any request is sent`, async ({ page }) => {
        const r = await run(page, { attack, delivery, hostCsp: true, killOnNavigation: false });
        expect(r.hits).toEqual([]);
        expect(r.frameUrl).toBe('chrome-error://chromewebdata/');
      });
    }

    for (const attack of LOCAL_SCHEME) {
      test(`${attack}: replacing the document does not shed the frame CSP (policy container is inherited)`, async ({ page }) => {
        const r = await run(page, { attack, delivery, hostCsp: false, killOnNavigation: false });
        expect(r.hits).toEqual([]);
        expect(r.frameUrl).toMatch(/^(data:|blob:null\/|about:blank)/);
      });
    }

    test('nav-top: blocked by the sandbox (no allow-top-navigation)', async ({ page }) => {
      const r = await run(page, { attack: 'nav-top', delivery, hostCsp: false, killOnNavigation: false });
      expect(r.topNavigated).toBe(false);
      expect(r.hits).toEqual([]);
    });
  });
}

test('control: with the frame CSP removed, a data: document does leak (so the CSP is what stops it above)', async ({ page }) => {
  const r = await run(page, { attack: 'nav-data', delivery: 'srcdoc', hostCsp: false, killOnNavigation: false, csp: false });
  expect(r.hits).toEqual(expect.arrayContaining(['nav-data-img']));
});
