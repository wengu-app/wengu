// The host-page CSP (hostPageCsp) and ComponentHost's startup check for it (hostCspCheck).
// The leak itself, and that the policy blocks it, is in navigation.spec.ts.
import { test, expect, type Page } from '@playwright/test';
import { hostPageCsp, hostFrameSrc } from '../src/host-csp.ts';
import { startEvilServers, type EvilServers } from './servers.ts';
import { openHarness, mount, waitForStatus, events } from './helpers.ts';

let evil: EvilServers;
test.beforeAll(async () => {
  evil = await startEvilServers();
});
test.afterAll(async () => evil.close());
test.beforeEach(() => evil.reset());

const DELIVERIES = ['srcdoc', 'url-cross-site'] as const;

function consoleErrors(page: Page): string[] {
  const out: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && m.text().includes('[wengu/runtime]')) out.push(m.text());
  });
  return out;
}

test('hostPageCsp: frame-src limited to self and the sandbox origin(s)', () => {
  expect(hostPageCsp()).toBe("frame-src 'self'");
  expect(hostPageCsp({ sandboxOrigin: 'https://sb.example.net/sandbox.html?x=1' })).toBe("frame-src 'self' https://sb.example.net");
  expect(hostPageCsp({ sandboxOrigin: ['http://127.0.0.1:5174', 'http://127.0.0.1:5174/', 'http://localhost:5174'] })).toBe(
    "frame-src 'self' http://127.0.0.1:5174 http://localhost:5174",
  );
  expect(hostFrameSrc({ allowSelf: false })).toBe("frame-src 'none'");
  expect(() => hostPageCsp({ sandboxOrigin: '*' })).toThrow();
  expect(() => hostPageCsp({ sandboxOrigin: 'https:' })).toThrow();
  expect(() => hostPageCsp({ sandboxOrigin: 'https://*.example.net' })).toThrow();
  expect(() => hostPageCsp({ sandboxOrigin: 'data:text/html,x' })).toThrow();
});

test('the harness is served with hostPageCsp() by default, and without it only on request', async ({ page }) => {
  await openHarness(page);
  expect(await page.evaluate(() => window.harness.hostCsp())).toEqual([
    hostPageCsp({ sandboxOrigin: ['http://127.0.0.1:5174', 'http://localhost:5174'] }),
  ]);
  await openHarness(page, { hostCsp: false });
  expect(await page.evaluate(() => window.harness.hostCsp())).toEqual([]);
});

for (const delivery of DELIVERIES) {
  test.describe(delivery, () => {
    test('default setup: the check passes, components work, no warning', async ({ page }) => {
      const errors = consoleErrors(page);
      await openHarness(page);
      await mount(page, { component: 'molecule', delivery, hostCspCheck: 'enforce' });
      await waitForStatus(page, 'ready');
      await page.waitForTimeout(500);
      expect((await events(page)).filter((e) => e.type === 'unprotected')).toEqual([]);
      expect(errors).toEqual([]);
    });

    test('UNPROTECTED page, default (warn): the component loads, but the host reports it loudly', async ({ page }) => {
      const errors = consoleErrors(page);
      await openHarness(page, { hostCsp: false });
      await mount(page, { component: 'molecule', delivery });
      await waitForStatus(page, 'ready');
      await expect.poll(async () => (await events(page)).filter((e) => e.type === 'unprotected').length).toBe(1);
      const ev = (await events(page)).find((e) => e.type === 'unprotected') as { enforced: boolean; detail: string };
      expect(ev.enforced).toBe(false);
      expect(ev.detail).toMatch(/not blocked/);
      expect(errors.join('\n')).toMatch(/UNSAFE HOST PAGE/);
    });

    test('UNPROTECTED page, enforce: the component is never loaded, so nothing can leak', async ({ page }) => {
      const errors = consoleErrors(page);
      await openHarness(page, { hostCsp: false });
      await mount(page, { component: 'hostile', delivery, hostCspCheck: 'enforce', props: { attack: 'nav-location', evil: evil.evil } });
      await waitForStatus(page, 'error');
      await page.waitForTimeout(1000);
      const evs = await events(page);
      expect(evs.find((e) => e.type === 'unprotected')).toMatchObject({ enforced: true });
      expect(evs.find((e) => e.type === 'error')).toMatchObject({ phase: 'load' });
      expect(evs.filter((e) => e.type === 'ready')).toEqual([]);
      expect(page.frames().filter((f) => f !== page.mainFrame())).toEqual([]);
      expect(evil.hits).toEqual([]);
      expect(errors.join('\n')).toMatch(/UNSAFE HOST PAGE.*not loaded/);
    });
  });
}

test('the check itself sends nothing over the network when the page is unprotected', async ({ page }) => {
  const failures: string[] = [];
  page.on('requestfailed', (r) => failures.push(`${r.url()} ${r.failure()?.errorText}`));
  await openHarness(page, { hostCsp: false });
  await mount(page, { component: 'theme-probe' });
  await waitForStatus(page, 'ready');
  await expect.poll(async () => (await events(page)).some((e) => e.type === 'unprotected')).toBe(true);
  // Blocked locally (port 1 is on the browser's blocked-port list): no DNS lookup, no connection.
  expect(failures).toEqual(['https://wengu-csp-probe.invalid:1/ net::ERR_UNSAFE_PORT']);
});
