import { expect, type Frame, type Page } from '@playwright/test';
import type { MountOptions } from '../demo/src/harness.ts';

/**
 * Opens the test harness. By default it is served like any page that embeds components should be: with the host-page
 * CSP from hostPageCsp(). `hostCsp: false` serves it without, only for the unprotected controls.
 */
export async function openHarness(page: Page, opts: { hostCsp?: boolean } = {}) {
  await page.goto(`/harness.html${opts.hostCsp === false ? '?hostcsp=0' : ''}`);
  await expect(page.locator('#status')).toHaveText('harness-ready');
}

export async function mount(page: Page, opts: MountOptions) {
  // Serialise by hand: Playwright's recursive argument types choke on the recursive JsonValue type.
  await page.evaluate((json) => window.harness.mount(JSON.parse(json)), JSON.stringify(opts));
}

export function componentFrame(page: Page): Frame {
  const f = page.frames().find((fr) => fr !== page.mainFrame());
  if (!f) throw new Error('no component frame');
  return f;
}

export async function waitForStatus(page: Page, status: string, timeout = 15_000) {
  await expect.poll(() => page.evaluate(() => window.harness.status()), { timeout }).toBe(status);
}

/** Reads the hostile component's JSON report from inside the frame. */
export async function readReport(page: Page): Promise<Record<string, string>> {
  await waitForStatus(page, 'ready', 30_000);
  const report = componentFrame(page).locator('#report[data-done="1"]');
  await expect(report).toBeAttached({ timeout: 30_000 });
  return JSON.parse(await report.innerText()) as Record<string, string>;
}

export type HarnessEvent = Awaited<ReturnType<Window['harness']['events']>>[number];
export const events = (page: Page) => page.evaluate(() => window.harness.events());
