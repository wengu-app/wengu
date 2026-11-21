// Protocol robustness and the host<->component contract.
import { test, expect } from '@playwright/test';
import { openHarness, mount, waitForStatus, events, componentFrame, type HarnessEvent } from './helpers.ts';

const byType = (evs: HarnessEvent[], type: string) => evs.filter((e) => e.type === type);
/**
 * Software GL (SwiftShader) can stall a WebGL component, and the host shortly after page load, for 2-3 s while shaders
 * compile (measured; see report). Real GPUs do not. Use a lenient watchdog for the WebGL component here.
 */
const SLOW_GL_WATCHDOG = { intervalMs: 500, timeoutMs: 20_000 };

/** Labels are positioned by the first rendered frame; wait for it before clicking atoms. */
async function waitForFirstRender(frame: import('@playwright/test').Frame) {
  await expect.poll(() => frame.locator('.mv-label').first().evaluate((el) => (el as HTMLElement).style.transform), { timeout: 15_000 }).toContain('translate(');
}

const reasons = (evs: HarnessEvent[]) => byType(evs, 'violation').map((e) => (e as { reason: string }).reason);

for (const delivery of ['srcdoc', 'url-cross-site'] as const) {
  test.describe(delivery, () => {
    test('spam & forgery in learn mode: nothing accepted, everything validated, flood kills the component', async ({ page }) => {
      await openHarness(page);
      await mount(page, { component: 'hostile', delivery, mode: 'learn', props: { attack: 'spam' } });
      await waitForStatus(page, 'killed', 20_000);
      const evs = await events(page);
      expect(byType(evs, 'result')).toEqual([]);
      const r = reasons(evs);
      expect(r).toContain('malformed message');
      expect(r).toContain('result outside review mode');
      expect(r).toContain('pong for unknown ping');
      expect(r).toContain('unexpected ready');
      const killed = byType(evs, 'killed')[0] as { reason: string };
      expect(killed.reason).toBe('flood');
      // Oversized fields were clipped, absurd sizes clamped.
      const err = byType(evs, 'error').find((e) => (e as { message: string }).message.startsWith('xxx')) as { message: string };
      expect(err.message.length).toBeLessThanOrEqual(2001);
      expect(Math.max(...byType(evs, 'resize').map((e) => (e as { height: number }).height))).toBeLessThanOrEqual(2000);
      // Forged window messages reached the page but the host ignores window traffic entirely.
      expect(await page.evaluate(() => window.harness.windowMessages())).toBeGreaterThanOrEqual(50);
      // The host page is fine.
      await page.locator('#probe').click({ timeout: 2000 });
    });

    test('KNOWN LIMIT forged results in review mode: only the first is accepted, but it cannot be told apart from a real one', async ({ page }) => {
      await openHarness(page);
      await mount(page, { component: 'hostile', delivery, mode: 'review', props: { attack: 'spam', floodDelayMs: 300 } });
      await waitForStatus(page, 'killed', 20_000);
      const evs = await events(page);
      const results = byType(evs, 'result') as Array<{ result: { detail?: string } }>;
      expect(results).toHaveLength(1);
      expect(results[0]!.result.detail).toBe('forged 0');
      expect(reasons(evs).filter((x) => x === 'duplicate result')).toHaveLength(2);
    });

    test('molecule review: clicking the oxygen atom reports a correct result', async ({ page }) => {
      await openHarness(page);
      await mount(page, { component: 'molecule', delivery, mode: 'review', watchdog: SLOW_GL_WATCHDOG });
      await waitForStatus(page, 'ready');
      const frame = componentFrame(page);
      const o = frame.locator('.mv-label', { hasText: /^O$/ });
      await waitForFirstRender(frame);
      // Re-read the position and retry if a click lands while the view is still settling (a miss is not an answer).
      await expect
        .poll(async () => {
          const box = (await o.boundingBox())!;
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          await page.waitForTimeout(300);
          return byType(await events(page), 'result').length;
        }, { timeout: 15_000 })
        .toBe(1);
      const res = byType(await events(page), 'result')[0] as unknown as { result: { outcome: string; response: { picked: string } } };
      expect(res.result.outcome).toBe('correct');
      expect(res.result.response.picked).toBe('O');
      await expect(frame.locator('.mv-feedback.ok')).toBeVisible();
    });

    test('molecule review: clicking a carbon atom reports incorrect; later clicks are ignored', async ({ page }) => {
      await openHarness(page);
      await mount(page, { component: 'molecule', delivery, mode: 'review', watchdog: SLOW_GL_WATCHDOG });
      await waitForStatus(page, 'ready');
      const frame = componentFrame(page);
      await waitForFirstRender(frame);
      const carbon = frame.locator('.mv-label', { hasText: /^C$/ }).first();
      await expect
        .poll(async () => {
          const c = (await carbon.boundingBox())!;
          await page.mouse.click(c.x + c.width / 2, c.y + c.height / 2);
          await page.waitForTimeout(300);
          return byType(await events(page), 'result').length;
        }, { timeout: 15_000 })
        .toBe(1);
      const o = (await frame.locator('.mv-label', { hasText: /^O$/ }).boundingBox())!;
      await page.mouse.click(o.x + o.width / 2, o.y + o.height / 2);
      await page.waitForTimeout(500);
      const results = byType(await events(page), 'result') as Array<{ result: { outcome: string } }>;
      expect(results.map((r) => r.result.outcome)).toEqual(['incorrect']);
    });
  });
}

test('theme: CSS variables and ctx.theme update live; mode change remounts with cleanup', async ({ page }) => {
  await openHarness(page);
  await mount(page, { component: 'theme-probe', mode: 'learn' });
  await waitForStatus(page, 'ready');
  const frame = componentFrame(page);
  await expect(frame.locator('#probe')).toHaveText('light #3a5fcd');
  await page.evaluate(() => window.harness.setTheme('dark'));
  await expect(frame.locator('#probe')).toHaveText('dark #8aa6ff');
  await page.evaluate(() => window.harness.setMode('review'));
  await expect(frame.locator('#probe')).toHaveAttribute('data-mode', 'review');
  await expect(frame.locator('html')).toHaveAttribute('data-cleaned', 'learn');
  await waitForStatus(page, 'ready');
});

test('content height drives the iframe height', async ({ page }) => {
  await openHarness(page);
  await mount(page, { component: 'molecule' });
  await waitForStatus(page, 'ready');
  await expect.poll(() => page.evaluate(() => window.harness.iframeHeight())).toBe('480px');
});

test('errors: syntax error, throwing mount and missing export are reported with the right phase', async ({ page }) => {
  await openHarness(page);
  for (const [component, phase, text] of [
    ['syntax-error', 'load', /SyntaxError/],
    ['mount-throws', 'mount', /boom/],
    ['no-mount', 'load', /export a function named `mount`/],
  ] as const) {
    await mount(page, { component });
    await waitForStatus(page, 'error');
    const err = byType(await events(page), 'error')[0] as { phase: string; message: string };
    expect(err.phase).toBe(phase);
    expect(err.message).toMatch(text);
  }
});

test('unsupported apiVersion is rejected before anything runs', async ({ page }) => {
  await openHarness(page);
  const msg = await page.evaluate(() => {
    try {
      window.harness.mount({ component: 'theme-probe', apiVersion: 2 });
      return 'mounted';
    } catch (e) {
      return String(e);
    }
  });
  expect(msg).toMatch(/apiVersion 2 not supported/);
});

test('phase: in-place transition updates ctx.phase and dataset without remounting or losing state; requestReveal notifies host', async ({
  page,
}) => {
  await openHarness(page);
  await mount(page, { component: 'phase-probe', mode: 'review', phase: 'question' });
  await waitForStatus(page, 'ready');
  const frame = componentFrame(page);
  const box = frame.locator('#phase-probe');
  await expect(box).toHaveAttribute('data-phase', 'question');
  await expect(frame.locator('html')).toHaveAttribute('data-phase', 'question');
  const token = await box.getAttribute('data-token');
  expect(token).toBeTruthy();

  // Clicking the check button calls ctx.requestReveal() while in question phase.
  await frame.locator('#ask-reveal').click();
  await expect
    .poll(async () => byType(await events(page), 'reveal-request').length)
    .toBe(1);

  // Transition in-place to reveal: no cleanup runs, stateToken is preserved, mount count stays 1.
  await page.evaluate(() => window.harness.setPhase('reveal'));
  await expect(box).toHaveAttribute('data-phase', 'reveal');
  await expect(box).toHaveText(`reveal:${token}`);
  await expect(frame.locator('html')).toHaveAttribute('data-phase', 'reveal');
  await expect(frame.locator('html')).toHaveAttribute('data-mounts', '1');
  expect(await frame.locator('html').getAttribute('data-cleaned-phase')).toBeNull();
  expect(await page.evaluate(() => window.harness.status())).toBe('ready');

  // Calling requestReveal while already in reveal phase does not emit another reveal-request.
  await frame.locator('#ask-reveal').click();
  await page.waitForTimeout(100);
  expect(byType(await events(page), 'reveal-request')).toHaveLength(1);
});

test('shortcuts: Space and 1-4 inside focused iframe forward to host; typing inside input is not forwarded', async ({
  page,
}) => {
  await openHarness(page);
  await mount(page, { component: 'shortcut-probe', mode: 'review' });
  await waitForStatus(page, 'ready');
  const frame = componentFrame(page);

  await frame.locator('#stage').click();
  await page.keyboard.press('Space');
  await page.keyboard.press('Digit1');
  await page.keyboard.press('Digit3');

  await expect
    .poll(async () =>
      byType(await events(page), 'shortcut').map((e) => (e as unknown as { code: string }).code),
    )
    .toEqual(['Space', 'Digit1', 'Digit3']);

  // Typing inside an input element inside the sandbox must NOT forward shortcuts.
  const input = frame.locator('#text-input');
  await input.click();
  await page.keyboard.press('Space');
  await page.keyboard.press('Digit2');
  await page.keyboard.press('Digit4');
  await page.waitForTimeout(150);

  expect(
    byType(await events(page), 'shortcut').map((e) => (e as unknown as { code: string }).code),
  ).toEqual(['Space', 'Digit1', 'Digit3']);
  await expect(input).toHaveValue(' 24');
});

test('primitives: wengu/card and wengu/scene3d mount, render label, handle phase/theme transitions cleanly', async ({
  page,
}) => {
  await openHarness(page);
  await mount(page, {
    component: 'primitives-probe',
    mode: 'review',
    phase: 'question',
    watchdog: SLOW_GL_WATCHDOG,
  });
  await waitForStatus(page, 'ready');
  const frame = componentFrame(page);

  const shell = frame.locator('.wg-card');
  await expect(shell).toHaveAttribute('data-phase', 'question');
  await expect(shell).toHaveAttribute('data-step', 'before');
  await expect(shell).toHaveAttribute('data-step-index', '0');

  const label = frame.locator('.wg-scene3d-label', { hasText: 'Target Sphere' });
  await expect.poll(() => label.evaluate((el) => (el as HTMLElement).style.transform), { timeout: 15_000 }).toContain('translate(');
  await expect(label).toHaveClass(/hidden/);

  // Flip phase in place to reveal, plus theme change.
  await page.evaluate(() => {
    window.harness.setPhase('reveal');
    window.harness.setTheme('dark');
  });

  await expect(shell).toHaveAttribute('data-phase', 'reveal');
  await expect(shell).toHaveAttribute('data-step', 'after');
  await expect(shell).toHaveAttribute('data-step-index', '1');
  await expect(label).not.toHaveClass(/hidden/);
  await expect(label).toHaveClass(/highlighted/);
  await expect(frame.locator('.wg-card-feedback.show')).toBeVisible();
  await expect(frame.locator('html')).toHaveAttribute('data-theme', 'dark');

  expect(byType(await events(page), 'error')).toEqual([]);
});
