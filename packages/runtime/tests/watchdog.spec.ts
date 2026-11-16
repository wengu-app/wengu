// Hung components: detection and kill. Requires the frame to be out-of-process (true for every delivery mode in
// full Chromium, measured); with an in-process frame an infinite loop would freeze the host page too and nothing in
// the page could recover.
import { test, expect } from '@playwright/test';
import { openHarness, mount, waitForStatus, events } from './helpers.ts';

for (const delivery of ['srcdoc', 'url-cross-site'] as const) {
  test(`${delivery}: while(true) is detected and killed; the host stays responsive throughout`, async ({ page, browser }) => {
    const cdp = await browser.newBrowserCDPSession();
    const oopif = (await cdp.send('Target.getTargets')).targetInfos;
    await openHarness(page);
    await mount(page, { component: 'busy', delivery, props: { delayMs: 300, blockMs: -1 } });
    await waitForStatus(page, 'ready');
    const targets = (await cdp.send('Target.getTargets')).targetInfos.filter((t) => t.type === 'iframe');
    expect(targets.length, 'component frame must be an out-of-process iframe').toBeGreaterThan(oopif.filter((t) => t.type === 'iframe').length);

    // The host keeps handling input while the component spins.
    const clickTimes: number[] = [];
    const start = Date.now();
    while ((await page.evaluate(() => window.harness.status())) !== 'killed') {
      const t = Date.now();
      await page.locator('#probe').click({ timeout: 2000 });
      clickTimes.push(Date.now() - t);
      expect(Date.now() - start).toBeLessThan(10_000);
      await page.waitForTimeout(100);
    }
    const detectMs = Date.now() - start;
    const killed = (await events(page)).find((e) => e.type === 'killed') as { reason: string };
    expect(killed.reason).toBe('unresponsive');
    // ping every 500 ms, kill after 3000 ms without a pong -> roughly 3-4 s after the loop starts.
    expect(detectMs).toBeLessThan(5000);
    expect(Math.max(...clickTimes)).toBeLessThan(500);
    test.info().annotations.push({ type: 'measured', description: `killed after ${detectMs} ms; slowest host click ${Math.max(...clickTimes)} ms` });

    // The looping process is gone: no renderer keeps burning a full core.
    const cpu = async () => (await cdp.send('SystemInfo.getProcessInfo')).processInfo.filter((p) => p.type === 'renderer');
    await page.waitForTimeout(500);
    const a = await cpu();
    await page.waitForTimeout(1000);
    const b = await cpu();
    const busiest = Math.max(...b.map((p) => p.cpuTime - (a.find((q) => q.id === p.id)?.cpuTime ?? 0)));
    expect(busiest).toBeLessThan(0.5);

    // And a new component mounts fine afterwards.
    await mount(page, { component: 'theme-probe', delivery });
    await waitForStatus(page, 'ready');
  });
}
