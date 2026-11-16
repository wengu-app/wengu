// Network and data isolation. A hostile component runs a battery of exfiltration attempts; "evil" servers record
// every request that actually leaves the browser. Each battery runs twice: with the frame CSP (must leak nothing) and
// without it (positive control: proves the detection works and shows which attacks the CSP, specifically, stops).
import { test, expect } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { startEvilServers, type EvilServers } from './servers.ts';
import { openHarness, mount, readReport, events } from './helpers.ts';

let evil: EvilServers;
test.beforeAll(async () => {
  evil = await startEvilServers();
});
test.afterAll(async () => evil.close());
test.beforeEach(() => evil.reset());

const matrix: Record<string, unknown> = {};
test.afterAll(() => {
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/isolation-matrix.json', JSON.stringify(matrix, null, 2));
});

for (const delivery of ['srcdoc', 'url-cross-site'] as const) {
  test.describe(`battery · ${delivery}`, () => {
    test('with frame CSP: nothing leaves the browser, no host data is readable', async ({ page }) => {
      await openHarness(page);
      await mount(page, { component: 'hostile', delivery, props: { attack: 'battery', evil: evil.evil, pre: evil.pre, udp: evil.udpPort } });
      const report = await readReport(page);
      await page.waitForTimeout(1000);
      const udp = evil.udpPackets();
      matrix[`${delivery}/csp`] = { report, hits: evil.names(), preconnect: evil.preConnections(), udpPackets: udp.length, udpContainsSecret: udp.some((b) => b.includes('S3CR3T')) };

      // Network: no HTTP request, WebSocket upgrade, or preconnect reached the evil servers.
      expect(evil.hits).toEqual([]);
      expect(evil.preConnections()).toBe(0);

      // Opaque origin: no storage, no cookies, no host DOM.
      expect(report.origin).toBe('null');
      expect(report['parent-document']).toMatch(/^threw SecurityError/);
      expect(report['parent-localStorage']).toMatch(/^threw SecurityError/);
      expect(report['top-location-read']).toMatch(/^threw SecurityError/);
      expect(report.localStorage).toMatch(/^threw SecurityError/);
      expect(report.sessionStorage).toMatch(/^threw SecurityError/);
      expect(report['cookie-read']).toMatch(/^threw SecurityError/);
      expect(report['cookie-write']).toMatch(/^threw SecurityError/);
      expect(report.indexedDB).toMatch(/^threw SecurityError/);
      expect(report.caches).toMatch(/^threw SecurityError/);
      expect(report.serviceWorker).toMatch(/^threw/);
      // Popups are blocked by the sandbox (no allow-popups).
      expect(report['window-open']).toBe('returned null');
      // Modal dialogs are ignored (no allow-modals), so alert() cannot block the thread for long.
      expect(report.alert).toMatch(/returned after \d+ ms/);
      expect(Number(/(\d+) ms/.exec(report.alert!)![1])).toBeLessThan(100);

      // Forged messages on window and BroadcastChannel reached nothing that acts on them.
      expect(await page.evaluate(() => window.harness.broadcasts())).toBe(0);
      const evs = await events(page);
      expect(evs.filter((e) => e.type === 'result')).toEqual([]);
      // The harness page still has its data.
      expect(await page.evaluate(() => window.harness.storage())).toEqual({ local: 'host-local-storage-secret', cookie: 'secret=host-cookie-secret' });
    });

    test('control without frame CSP: the same attacks do leak (detection works)', async ({ page }) => {
      await openHarness(page);
      await mount(page, { component: 'hostile', delivery, csp: false, props: { attack: 'battery', evil: evil.evil, pre: evil.pre, udp: evil.udpPort } });
      const report = await readReport(page);
      await page.waitForTimeout(1000);
      const udp = evil.udpPackets();
      matrix[`${delivery}/no-csp`] = { report, hits: evil.names(), preconnect: evil.preConnections(), udpPackets: udp.length, udpContainsSecret: udp.some((b) => b.includes('S3CR3T')) };
      // srcdoc mode: there is no frame CSP; the frame inherits the harness's host CSP, but that only restricts frames.
      // url mode: the sandbox server sends the CSP header regardless, so the control only removes the <meta>.
      if (delivery === 'srcdoc') {
        expect(evil.names()).toEqual(expect.arrayContaining(['fetch', 'xhr', 'img', 'script', 'stylesheet']));
      } else {
        expect(evil.hits).toEqual([]);
      }
      // The sandbox (not the CSP) is what blocks popups and forms.
      expect(evil.names()).not.toContain('window-open');
      expect(evil.names()).not.toContain('anchor-blank');
      expect(evil.names()).not.toContain('form');
    });
  });
}
