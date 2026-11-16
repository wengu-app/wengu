// Measures how much a misbehaving component disturbs the host page, per browser mode and sandbox delivery.
//
//   corepack pnpm measure:jank      (needs the dev server and sandbox server; `corepack pnpm test` starts them, or run
//                                     `corepack pnpm dev` and `corepack pnpm sandbox-server` yourself)
//   node scripts/measure-jank.mjs --quick
//
// For each configuration it records, on the HOST page, for a 6 s window:
//   - requestAnimationFrame pacing (fps, p95 / max frame interval, frames longer than 50 ms)
//   - input delay: a real mouse click (CDP Input) on a host button every ~100 ms; delay = handler time - event.timeStamp
// and from the browser process (CDP): renderer process count before/after mounting and whether the component frame is
// an out-of-process iframe (OOPIF) target.
// It also mounts a component that loops forever and measures how long the watchdog takes to kill it and whether the
// looping process actually stops burning CPU afterwards.

import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = 'http://localhost:5173/harness.html';
const ARGS = ['--host-resolver-rules=MAP *.wengu-test 127.0.0.1', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const quick = process.argv.includes('--quick');
const WINDOW_MS = quick ? 4000 : 6000;

const BROWSERS = [
  { name: 'headless-shell', launch: { args: ARGS } },
  { name: 'chromium new-headless', launch: { channel: 'chromium', args: ARGS } },
  { name: 'chromium new-headless, IsolateSandboxedIframes off', launch: { channel: 'chromium', args: [...ARGS, '--disable-features=IsolateSandboxedIframes'] } },
];
const DELIVERIES = ['srcdoc', 'url-same-site', 'url-cross-site'];
const SCENARIOS = [
  { name: 'idle (control)', component: 'busy', props: { delayMs: 1e9 } },
  { name: 'busy loop 4 s', component: 'busy', props: { delayMs: 300, blockMs: 4000 } },
  { name: 'heavy GPU scene', component: 'heavy', props: { kind: 'gpu' } },
  { name: 'heavy CPU per frame (40 ms)', component: 'heavy', props: { kind: 'cpu', cpuMsPerFrame: 40 } },
];

const pct = (arr, p) => {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const r1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : x);

async function rendererCount(cdp) {
  const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
  return processInfo.filter((p) => p.type === 'renderer').length;
}

async function rendererCpu(cdp) {
  const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
  return processInfo.filter((p) => p.type === 'renderer').map((p) => ({ id: p.id, cpu: p.cpuTime }));
}

async function oopifTargets(cdp) {
  const { targetInfos } = await cdp.send('Target.getTargets');
  return targetInfos.filter((t) => t.type === 'iframe').map((t) => t.url);
}

async function measure(browser, cdp, delivery, scenario) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  await page.goto(BASE);
  await page.waitForFunction(() => document.getElementById('status')?.textContent === 'harness-ready');
  const before = await rendererCount(cdp);
  await page.evaluate(
    (o) => window.harness.mount(o),
    { component: scenario.component, delivery, props: scenario.props, watchdog: false },
  );
  await page.waitForFunction(() => window.harness.status() === 'ready', null, { timeout: 30_000 });
  const after = await rendererCount(cdp);
  const oopif = (await oopifTargets(cdp)).filter((u) => u.includes('sandbox.html') || u === 'about:srcdoc');

  await page.evaluate(() => window.harness.startRecording());
  const t0 = Date.now();
  const clickRtt = [];
  const box = await page.locator('#probe').boundingBox();
  while (Date.now() - t0 < WINDOW_MS) {
    const c0 = Date.now();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    clickRtt.push(Date.now() - c0);
    await new Promise((r) => setTimeout(r, 100));
  }
  const { frames, probes } = await page.evaluate(() => window.harness.stopRecording());
  await page.close();

  const intervals = frames.slice(1).map((t, i) => t - frames[i]);
  const span = frames.length > 1 ? frames[frames.length - 1] - frames[0] : NaN;
  return {
    delivery,
    scenario: scenario.name,
    renderers: `${before}->${after}`,
    oopif: oopif.length > 0,
    fps: r1((intervals.length / span) * 1000),
    frameP95: r1(pct(intervals, 95)),
    frameMax: r1(Math.max(...intervals)),
    longFrames: intervals.filter((x) => x > 50).length,
    inputP50: r1(pct(probes, 50)),
    inputMax: r1(Math.max(...probes)),
    clicks: probes.length,
    clickRttMax: Math.max(...clickRtt),
  };
}

/** Infinite loop: how fast is it detected and killed, and does the looping process stop? */
async function measureKill(browser, cdp, delivery) {
  const page = await browser.newPage();
  await page.goto(BASE);
  await page.waitForFunction(() => document.getElementById('status')?.textContent === 'harness-ready');
  await page.evaluate((d) => window.harness.mount({ component: 'busy', delivery: d, props: { delayMs: 300, blockMs: -1 } }), delivery);
  await page.waitForFunction(() => window.harness.status() === 'ready', null, { timeout: 30_000 });
  const oopif = (await oopifTargets(cdp)).some((u) => u.includes('sandbox.html') || u === 'about:srcdoc');
  if (!oopif) {
    await page.close().catch(() => {});
    return { delivery, result: 'skipped: frame shares the host process, an infinite loop would freeze the host page itself' };
  }
  const readyAt = await page.evaluate(() => performance.now());
  // While the frame loops, the host must stay responsive. Probe it during the wait.
  const probeRtt = [];
  let killedAt = null;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const c0 = Date.now();
    await page.locator('#probe').click({ timeout: 5000 });
    probeRtt.push(Date.now() - c0);
    const ev = await page.evaluate(() => window.harness.events().find((e) => e.type === 'killed'));
    if (ev) {
      killedAt = ev.t;
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  // Is anything still burning CPU after the kill?
  const a = await rendererCpu(cdp);
  await new Promise((r) => setTimeout(r, 1000));
  const b = await rendererCpu(cdp);
  const busiest = Math.max(...b.map((p) => p.cpu - (a.find((q) => q.id === p.id)?.cpu ?? 0)));
  const renderersAfter = b.length;
  await page.close();
  return {
    delivery,
    result: killedAt ? 'killed' : 'NOT killed',
    detectMs: killedAt ? Math.round(killedAt - readyAt - 300) : null,
    hostClickRttMax: Math.max(...probeRtt),
    busiestRendererCpuSecPerSecAfterKill: r1(busiest),
    renderersAfter,
  };
}

// Every scenario runs in its own child process with a hard timeout, so a starved or hung browser cannot stall the run.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const oneIdx = process.argv.indexOf('--one');
if (oneIdx >= 0) {
  const [bi, delivery, si] = process.argv.slice(oneIdx + 1);
  const b = BROWSERS[Number(bi)];
  const browser = await chromium.launch(b.launch);
  const cdp = await browser.newBrowserCDPSession();
  const r = si === 'kill' ? await measureKill(browser, cdp, delivery) : await measure(browser, cdp, delivery, SCENARIOS[Number(si)]);
  process.stdout.write('RESULT ' + JSON.stringify({ browser: b.name, version: browser.version(), ...r }) + '\n');
  await race(browser.close(), 10_000, 'close').catch(() => {});
  process.exit(0);
}

function runChild(args, ms) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--one', ...args, ...(quick ? ['--quick'] : [])], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let timedOut = false;
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    }, ms);
    child.on('exit', () => {
      clearTimeout(timer);
      const line = out.split('\n').find((l) => l.startsWith('RESULT '));
      if (line) resolve(JSON.parse(line.slice(7)));
      else resolve({ error: timedOut ? `no result within ${ms / 1000} s (host starved or hung), killed` : out.trim().split('\n').slice(-2).join(' ') });
    });
  });
}

const results = { measuredAt: new Date().toISOString(), windowMs: WINDOW_MS, runs: [], kills: [] };
for (const [bi, b] of BROWSERS.entries()) {
  console.log(`\n## ${b.name}\n`);
  console.log('| delivery | scenario | renderers | OOPIF | host fps | frame p95 ms | frame max ms | frames >50ms | input p50 ms | input max ms | clicks |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const delivery of DELIVERIES) {
    for (const [si, s] of (quick ? SCENARIOS.slice(0, 2) : SCENARIOS).entries()) {
      const r = await runChild([String(bi), delivery, String(si)], 60_000);
      results.runs.push({ browser: b.name, delivery, scenario: s.name, ...r });
      if (r.error) console.log(`| ${delivery} | ${s.name} | ${r.error} |`);
      else console.log(`| ${r.delivery} | ${r.scenario} | ${r.renderers} | ${r.oopif ? 'yes' : 'no'} | ${r.fps} | ${r.frameP95} | ${r.frameMax} | ${r.longFrames} | ${r.inputP50} | ${r.inputMax} | ${r.clicks} |`);
    }
  }
  console.log('\nInfinite loop + watchdog (ping 500 ms, timeout 3000 ms):\n');
  for (const delivery of DELIVERIES) {
    const k = await runChild([String(bi), delivery, 'kill'], 45_000);
    results.kills.push({ browser: b.name, ...k, delivery });
    console.log(`- ${delivery}: ${JSON.stringify(k)}`);
  }
}

mkdirSync('test-results', { recursive: true });
writeFileSync('test-results/jank.json', JSON.stringify(results, null, 2));
console.log('\nwritten test-results/jank.json');
