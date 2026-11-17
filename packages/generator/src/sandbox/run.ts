/**
 * Runs a candidate for real: headless Chromium, the runtime's ComponentHost on a page protected by hostPageCsp(),
 * `url` delivery from a cross-site sandbox origin. For each requested mode: mount in light, screenshot, switch to dark
 * while mounted, screenshot. Learn mode is then poked at (buttons, sliders, drags); review mode's scripted answers are
 * replayed on fresh mounts and must produce the expected submitResult.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { PNG } from 'pngjs';
import type { Mode } from '@wengu/runtime';
import type { Candidate, Finding, ReviewStep, SandboxReport, SandboxRunLog, Screenshot } from '../types.ts';
import { startServers, type Servers } from './server.ts';

/** Same flags as packages/runtime/playwright.config.ts (WebGL via SwiftShader in headless Chromium). */
const CHROMIUM_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

export interface SandboxEnv {
  browser: Browser;
  servers: Servers;
  close(): Promise<void>;
}

export async function openSandboxEnv(): Promise<SandboxEnv> {
  const servers = await startServers();
  // Full Chromium (new headless), not the headless shell: the shell has no site isolation.
  const browser = await chromium.launch({ channel: 'chromium', headless: true, args: CHROMIUM_ARGS });
  return {
    browser,
    servers,
    async close() {
      await browser.close().catch(() => {});
      await servers.close();
    },
  };
}

export interface RunOptions {
  modes: Mode[];
  props: Record<string, string>;
  /** Directory screenshots are written to. */
  outDir: string;
  /** Path prefix of screenshots relative to the report's directory, e.g. "attempts/2/". */
  relPrefix: string;
  /** Time to let the component settle after ready before the first screenshot. */
  settleMs?: number;
}

const SETTLE_MS = 1500;
/**
 * Console messages that are expected and not the component's fault:
 *  - the host-CSP probe's frame-src violation (README of @wengu/runtime: "that is expected");
 *  - Chromium's warning about the runtime's own forward-looking `webrtc 'block'` CSP directive (frame-document.ts).
 */
const EXPECTED_CONSOLE = [/wengu-csp-probe\.invalid/, /Unrecognized Content-Security-Policy directive 'webrtc'/, /ResizeObserver loop/];

type WgEvent = { type: string; t: number; [k: string]: unknown };

/** Share of pixels that differ clearly from the image's dominant colour. */
export function inkRatio(png: Buffer): { ratio: number; width: number; height: number } {
  const img = PNG.sync.read(png);
  const { data, width, height } = img;
  const counts = new Map<number, number>();
  const step = 4 * 3;
  for (let i = 0; i < data.length; i += step) {
    const key = ((data[i]! >> 3) << 10) | ((data[i + 1]! >> 3) << 5) | (data[i + 2]! >> 3);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let dom = 0;
  let best = -1;
  for (const [k, c] of counts) if (c > best) [dom, best] = [k, c];
  const dr = ((dom >> 10) & 31) << 3;
  const dg = ((dom >> 5) & 31) << 3;
  const db = (dom & 31) << 3;
  let ink = 0;
  let total = 0;
  for (let i = 0; i < data.length; i += step) {
    total++;
    const d = Math.max(Math.abs(data[i]! - dr), Math.abs(data[i + 1]! - dg), Math.abs(data[i + 2]! - db));
    if (d > 32) ink++;
  }
  return { ratio: total ? ink / total : 0, width, height };
}

class Run {
  readonly findings: Finding[] = [];
  readonly screenshots: Screenshot[] = [];
  readonly consoleErrors: Array<{ where: string; text: string }> = [];
  /** Host events already turned into findings. */
  private eventsSeen = 0;
  private context!: BrowserContext;
  page!: Page;
  where = '';

  private readonly env: SandboxEnv;
  private readonly cand: Candidate;
  private readonly opts: RunOptions;

  constructor(env: SandboxEnv, cand: Candidate, opts: RunOptions) {
    this.env = env;
    this.cand = cand;
    this.opts = opts;
  }

  async open() {
    this.context = await this.env.browser.newContext({ viewport: { width: 1000, height: 900 }, deviceScaleFactor: 1 });
    this.page = await this.context.newPage();
    this.page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const text = m.text();
      if (EXPECTED_CONSOLE.some((re) => re.test(text))) return;
      this.consoleErrors.push({ where: this.where, text: text.slice(0, 500) });
    });
    // Uncaught errors (Playwright reports those of the component frame here too).
    this.page.on('pageerror', (e) => this.consoleErrors.push({ where: this.where, text: `${e.name}: ${e.message}`.slice(0, 500) }));
    await this.page.goto(`${this.env.servers.appUrl}/host.html`);
    await this.page.waitForFunction(() => document.body.dataset.wg === 'ready');
  }

  async close() {
    await this.context.close().catch(() => {});
  }

  add(severity: Finding['severity'], stage: Finding['stage'], code: string, message: string) {
    this.findings.push({ stage, severity, code, message, where: this.where });
  }

  async mount(mode: Mode, scheme: 'light' | 'dark') {
    await this.page.evaluate(
      (json) => (window as unknown as WgWindow).wg.mount(JSON.parse(json)),
      JSON.stringify({ manifest: this.cand.manifest, source: this.cand.source, props: this.opts.props, mode, scheme }),
    );
    try {
      await this.page.waitForFunction(() => ['ready', 'error', 'killed'].includes((window as unknown as WgWindow).wg.status()), undefined, { timeout: 20_000 });
    } catch {
      /* reported below */
    }
    return this.page.evaluate(() => (window as unknown as WgWindow).wg.status());
  }

  events(): Promise<WgEvent[]> {
    return this.page.evaluate(() => (window as unknown as WgWindow).wg.events()) as Promise<WgEvent[]>;
  }

  async screenshot(name: string, label: string, mode: Mode, scheme: 'light' | 'dark') {
    const iframe = this.page.locator('#slot iframe');
    if ((await iframe.count()) === 0) return;
    const buf = await iframe.screenshot({ animations: 'allow', timeout: 10_000 }).catch(() => null);
    if (!buf) {
      this.add('error', 'sandbox', 'screenshot-failed', `could not screenshot ${label}`);
      return;
    }
    const file = `${name}.png`;
    await writeFile(path.join(this.opts.outDir, file), buf);
    const ink = inkRatio(buf);
    this.screenshots.push({ file: this.opts.relPrefix + file, label, mode, scheme, inkRatio: Number(ink.ratio.toFixed(4)), width: ink.width, height: ink.height });
    if (ink.ratio < 0.003) this.add('error', 'sandbox', 'blank-render', `${label}: the frame is (almost) blank (${(ink.ratio * 100).toFixed(2)}% ink)`);
  }

  /** Turns host events not yet reported (errors, kills, protocol violations) into findings attributed to `where`. */
  async flushEvents(mode: Mode): Promise<WgEvent[]> {
    const evs = await this.events();
    if (evs.length < this.eventsSeen) this.eventsSeen = 0; // a new mount reset the list
    const fresh = evs.slice(this.eventsSeen);
    this.eventsSeen = evs.length;
    for (const e of fresh) {
      if (e.type === 'error') {
        // Chromium reports this when a ResizeObserver callback changes layout; harmless unless it repeats forever
        // (which would show up as a flood kill), so it does not block acceptance.
        const benign = /ResizeObserver loop/.test(String(e.message));
        this.add(benign ? 'warning' : 'error', 'sandbox', `${String(e.phase)}-error`, String(e.message).slice(0, 600));
      }
      else if (e.type === 'killed') this.add('error', 'sandbox', `killed-${String(e.reason)}`, `the host killed the component: ${String(e.detail)}`);
      else if (e.type === 'unprotected') this.add('error', 'sandbox', 'host-unprotected', String(e.detail));
      // Dropped messages (e.g. submitResult in learn mode, a second result) do no harm: the host ignores them.
      else if (e.type === 'violation') {
        if (mode === 'review' && String(e.reason) === 'result before ready') {
          this.add('error', 'review', 'result-without-interaction', 'submitResult was called during mount, before the learner could act');
        } else this.add('warning', 'sandbox', 'protocol-violation', `${mode}: ${String(e.reason)}`);
      }
    }
    return evs;
  }

  async rootBox() {
    const fl = this.page.frameLocator('#slot iframe');
    return fl.locator('#wg-root').boundingBox();
  }

  async runStep(s: ReviewStep): Promise<string | null> {
    const fl = this.page.frameLocator('#slot iframe');
    const box = async () => {
      const b = await this.rootBox();
      if (!b) throw new Error('component root not visible');
      return b;
    };
    try {
      switch (s.action) {
        case 'click': {
          const loc = fl.locator(s.selector!);
          const n = await loc.count();
          if (n === 0) return `selector ${JSON.stringify(s.selector)} matches nothing`;
          await loc.first().click({ timeout: 4000 });
          return n > 1 ? `selector ${JSON.stringify(s.selector)} matches ${n} elements (clicked the first)` : null;
        }
        case 'fill': {
          const loc = fl.locator(s.selector!).first();
          if ((await fl.locator(s.selector!).count()) === 0) return `selector ${JSON.stringify(s.selector)} matches nothing`;
          const type = await loc.getAttribute('type', { timeout: 2000 });
          if (type === 'range') {
            await loc.evaluate((el, v) => {
              const input = el as HTMLInputElement;
              input.value = v;
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
            }, s.value!);
          } else {
            await loc.fill(s.value!, { timeout: 4000 });
          }
          return null;
        }
        case 'press':
          if (s.selector) await fl.locator(s.selector).first().press(s.value!, { timeout: 4000 });
          else await this.page.keyboard.press(s.value!);
          return null;
        case 'clickAt': {
          const b = await box();
          await this.page.mouse.click(b.x + s.x! * b.width, b.y + s.y! * b.height);
          return null;
        }
        case 'drag': {
          const b = await box();
          await this.page.mouse.move(b.x + s.x! * b.width, b.y + s.y! * b.height);
          await this.page.mouse.down();
          await this.page.mouse.move(b.x + s.x2! * b.width, b.y + s.y2! * b.height, { steps: 12 });
          await this.page.mouse.up();
          return null;
        }
        case 'wait':
          await this.page.waitForTimeout(Math.min(5000, Number(s.value) || 0));
          return null;
      }
    } catch (e) {
      return `${s.action}${s.selector ? ` ${JSON.stringify(s.selector)}` : ''} failed: ${explain(e as Error)}`;
    }
  }

  /** Learn-mode robustness: press a few buttons, move sliders, drag across the middle. */
  async poke() {
    const fl = this.page.frameLocator('#slot iframe');
    const buttons = fl.locator('button:visible, [role=button]:visible');
    const nb = Math.min(await buttons.count().catch(() => 0), 6);
    for (let i = 0; i < nb; i++) await buttons.nth(i).click({ timeout: 1500 }).catch(() => {});
    const ranges = fl.locator('input[type=range]:visible');
    const nr = Math.min(await ranges.count().catch(() => 0), 4);
    for (let i = 0; i < nr; i++) {
      await ranges
        .nth(i)
        .evaluate((el) => {
          const input = el as HTMLInputElement;
          const min = Number(input.min || 0);
          const max = Number(input.max || 100);
          input.value = String(min + (max - min) * 0.8);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        })
        .catch(() => {});
    }
    const b = await this.rootBox().catch(() => null);
    if (b) {
      await this.page.mouse.move(b.x + b.width * 0.4, b.y + Math.min(b.height, 400) * 0.5);
      await this.page.mouse.down();
      await this.page.mouse.move(b.x + b.width * 0.6, b.y + Math.min(b.height, 400) * 0.4, { steps: 8 });
      await this.page.mouse.up();
    }
  }
}

export async function runSandbox(env: SandboxEnv, cand: Candidate, opts: RunOptions): Promise<SandboxReport> {
  const t0 = performance.now();
  await mkdir(opts.outDir, { recursive: true });
  const settle = opts.settleMs ?? SETTLE_MS;
  const findings: Finding[] = [];
  const screenshots: Screenshot[] = [];
  const runs: SandboxRunLog[] = [];

  for (const mode of opts.modes) {
    const run = new Run(env, cand, opts);
    const log: SandboxRunLog = { mode, ready: false, mountMs: null, events: [], consoleErrors: [], results: [], finalHeight: null };
    const allEvents: WgEvent[] = [];
    const keep = (evs: WgEvent[]) => allEvents.push(...evs.filter((e) => e.type !== 'heartbeat' && e.type !== 'resize'));
    try {
      await run.open();
      run.where = `${mode}/light`;
      const status = await run.mount(mode, 'light');
      let evs = await run.flushEvents(mode);
      const ready = evs.find((e) => e.type === 'ready');
      log.ready = status === 'ready';
      log.mountMs = ready ? Number(ready.mountMs) : null;
      if (status !== 'ready') {
        if (!run.findings.some((f) => f.severity === 'error')) run.add('error', 'sandbox', 'not-ready', `component did not become ready (status ${status})`);
      } else {
        await run.page.waitForTimeout(settle);
        await run.screenshot(`${mode}-light`, `${mode} mode, light theme`, mode, 'light');
        await run.flushEvents(mode);
        run.where = `${mode}/dark`;
        await run.page.evaluate(() => (window as unknown as WgWindow).wg.setTheme('dark'));
        await run.page.waitForTimeout(800);
        await run.screenshot(`${mode}-dark`, `${mode} mode, after switching to the dark theme while mounted`, mode, 'dark');
        evs = await run.flushEvents(mode);

        if (mode === 'review') {
          const early = evs.find((e) => e.type === 'result');
          log.results.push({ step: 'before-interaction', outcome: early ? String((early.result as { outcome: string }).outcome) : null });
          if (early) run.add('error', 'review', 'result-without-interaction', 'submitResult was called before the learner did anything');
        } else {
          run.where = `${mode}/dark/interaction`;
          await run.poke();
          await run.page.waitForTimeout(800);
          await run.screenshot(`${mode}-dark-interacted`, `${mode} mode, dark, after automated clicks/slider moves/drag`, mode, 'dark');
          evs = await run.flushEvents(mode);
        }
      }
      keep(evs);
      log.finalHeight = await run.page.evaluate(() => (window as unknown as WgWindow).wg.height());

      // Review: replay the scripted answers on fresh mounts.
      if (mode === 'review' && status === 'ready') {
        for (const [which, scheme] of [
          ['correct', 'light'],
          ['incorrect', 'dark'],
        ] as const) {
          const steps = cand.reviewTest?.[which];
          run.where = `review/${which}`;
          if (!steps?.length) {
            run.add('error', 'review', 'review-test-missing', `no ${which} steps`);
            continue;
          }
          const st = await run.mount('review', scheme);
          if (st !== 'ready') {
            keep(await run.flushEvents('review'));
            run.add('error', 'review', 'not-ready', `remount for the ${which} answer did not become ready (${st})`);
            continue;
          }
          await run.page.waitForTimeout(settle);
          const problems: string[] = [];
          for (const s of steps) {
            const p = await run.runStep(s);
            if (p) problems.push(p);
            await run.page.waitForTimeout(150);
          }
          try {
            await run.page.waitForFunction(() => (window as unknown as WgWindow).wg.events().some((e) => e.type === 'result'), undefined, { timeout: 3000 });
          } catch {
            /* no result */
          }
          await run.page.waitForTimeout(700);
          await run.screenshot(`review-${which}-${scheme}`, `review mode, ${scheme}, after the scripted ${which} answer`, 'review', scheme);
          const rEvs = await run.flushEvents('review');
          keep(rEvs);
          const res = rEvs.find((e) => e.type === 'result')?.result as { outcome?: string; detail?: string } | undefined;
          log.results.push({ step: which, outcome: res?.outcome ?? null, ...(res?.detail ? { detail: res.detail } : {}) });
          if (!res) {
            run.add(
              'error',
              'review',
              'no-result',
              `the scripted ${which} answer did not produce submitResult${problems.length ? `; step problems: ${problems.join('; ')}` : ' (all steps ran without error)'}`,
            );
          } else if (res.outcome !== which) {
            run.add('error', 'review', 'wrong-outcome', `the scripted ${which} answer was reported as '${res.outcome}'`);
          } else if (problems.length) {
            for (const p of problems) run.add('warning', 'review', 'step-problem', p);
          }
        }
      }
    } catch (e) {
      run.add('error', 'sandbox', 'harness-error', `self-check harness failed: ${(e as Error).message.split('\n')[0]}`);
    } finally {
      log.events = allEvents.map((e) => ({ ...e }));
      log.consoleErrors = run.consoleErrors.map((c) => `${c.where}: ${c.text}`);
      await run.close();
    }
    // Console errors: dedupe, and skip those already reported as host error events.
    const reported = run.findings.map((f) => f.message.slice(0, 80));
    const seen = new Set<string>();
    for (const c of run.consoleErrors) {
      if (seen.has(c.text) || reported.some((m) => c.text.includes(m))) continue;
      seen.add(c.text);
      run.findings.push({ stage: 'sandbox', severity: 'error', code: 'console-error', message: c.text, where: c.where });
    }
    findings.push(...dedupe(run.findings));
    screenshots.push(...run.screenshots);
    runs.push(log);
  }
  return { findings, screenshots, runs, durationMs: performance.now() - t0 };
}

/** First line of a Playwright error plus the call-log lines that say why (not visible, disabled, covered, ...). */
function explain(e: Error): string {
  const lines = e.message.split('\n').map((l) => l.trim());
  const why = lines.filter((l) => /element is|intercepts pointer|not visible|not enabled|not stable|outside of the viewport|resolved to|did not match/.test(l));
  return [lines[0], ...[...new Set(why)].slice(-3)].join(' | ').slice(0, 600);
}

function dedupe(fs: Finding[]): Finding[] {
  const seen = new Set<string>();
  return fs.filter((f) => {
    const k = `${f.code}|${f.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** The API host-page.ts installs on the self-check page. */
interface WgWindow {
  wg: {
    mount(o: unknown): Promise<void>;
    setTheme(s: 'light' | 'dark'): void;
    status(): string;
    events(): Array<{ type: string; [k: string]: unknown }>;
    height(): number | null;
    destroy(): void;
  };
}
