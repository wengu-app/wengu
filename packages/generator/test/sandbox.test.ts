// Runs hand-written components through the real self-check (headless Chromium + @wengu/runtime). No network, no key.
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Mode } from '@wengu/runtime';
import { openSandboxEnv, runSandbox, type SandboxEnv } from '../src/sandbox/run.ts';
import type { Candidate, ReviewTest } from '../src/types.ts';

const good = readFileSync(new URL('./fixtures/good.js', import.meta.url), 'utf8');
const click = (selector: string) => ({ action: 'click' as const, selector, x: null, y: null, x2: null, y2: null, value: null });
const reviewTest: ReviewTest = { correct: [click('#opt-a')], incorrect: [click('#opt-b')] };

let env: SandboxEnv;
beforeAll(async () => {
  env = await openSandboxEnv();
});
afterAll(async () => {
  await env?.close();
});

function cand(source: string, modes: Mode[] = ['learn', 'review'], rt: ReviewTest | null = reviewTest, libraries: Candidate['manifest']['libraries'] = []): Candidate {
  return {
    manifest: { id: 'test.c', title: 'test', apiVersion: 1, libraries, knowledgePoints: [], sources: [], modes },
    source,
    design: '',
    reviewTest: rt,
  };
}

const run = (c: Candidate) => {
  const outDir = mkdtempSync(path.join(os.tmpdir(), 'wengu-sbx-'));
  return runSandbox(env, c, { modes: c.manifest.modes, props: {}, outDir, relPrefix: '', settleMs: 300 });
};
const errors = (r: Awaited<ReturnType<typeof run>>) => r.findings.filter((f) => f.severity === 'error').map((f) => `${f.code}@${f.where}`);

describe('sandbox self-check', () => {
  it('passes a correct component and verifies both review answers', async () => {
    const r = await run(cand(good));
    expect(errors(r)).toEqual([]);
    expect(r.screenshots.map((s) => s.file)).toEqual([
      'learn-light.png',
      'learn-dark.png',
      'learn-dark-interacted.png',
      'review-light.png',
      'review-dark.png',
      'review-correct-light.png',
      'review-incorrect-dark.png',
    ]);
    expect(r.screenshots.every((s) => s.width === 720 && s.inkRatio > 0.003)).toBe(true);
    const review = r.runs.find((x) => x.mode === 'review')!;
    expect(review.results.map((x) => [x.step, x.outcome])).toEqual([
      ['before-interaction', null],
      ['correct', 'correct'],
      ['incorrect', 'incorrect'],
    ]);
  });

  it('runs three.js through the injected library (WebGL)', async () => {
    const src = `import * as THREE from 'three';
      export function mount(root, ctx) {
        const r = new THREE.WebGLRenderer({ antialias: true }); r.setSize(root.clientWidth, 300); root.append(r.domElement);
        const scene = new THREE.Scene(); scene.background = new THREE.Color(ctx.theme.tokens.color.surface);
        const cam = new THREE.PerspectiveCamera(50, root.clientWidth / 300, 0.1, 100); cam.position.z = 4;
        scene.add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 1.5), new THREE.MeshNormalMaterial()));
        r.render(scene, cam);
        ctx.onThemeChange((t) => { scene.background = new THREE.Color(t.tokens.color.surface); r.render(scene, cam); });
        return () => r.dispose();
      }`;
    const r = await run(cand(src, ['learn'], null, ['three']));
    expect(errors(r)).toEqual([]);
    expect(r.screenshots[0]!.inkRatio).toBeGreaterThan(0.02);
  });

  it('reports a mount error', async () => {
    const r = await run(cand('export function mount() { null.x; }', ['learn'], null));
    expect(errors(r)).toEqual(['mount-error@learn/light']);
  });

  it('reports runtime errors and console errors after mount', async () => {
    const r = await run(cand(`export function mount(root) { root.textContent = 'hello world'.repeat(20); console.error('oops'); setTimeout(() => { throw new Error('later'); }, 50); }`, ['learn'], null));
    const e = errors(r);
    expect(e).toContain('runtime-error@learn/light');
    expect(r.findings.some((f) => f.code === 'console-error' && f.message.includes('oops'))).toBe(true);
  });

  it('reports a blank render', async () => {
    const r = await run(cand(`export function mount(root) { const d = document.createElement('div'); d.style.height = '300px'; root.append(d); }`, ['learn'], null));
    expect(errors(r)).toContain('blank-render@learn/light');
  });

  it('reports a hung component killed by the watchdog', async () => {
    const r = await run(cand(`export function mount(root) { root.textContent = 'x'.repeat(100); setTimeout(() => { for (;;) {} }, 10); }`, ['learn'], null));
    expect(errors(r).some((e) => e.startsWith('killed-unresponsive'))).toBe(true);
  }, 90_000);

  it('reports blocked network access', async () => {
    const r = await run(cand(`export function mount(root) { root.textContent = 'net '.repeat(30); fetch('https://example.com/x').catch(() => {}); }`, ['learn'], null));
    expect(r.findings.some((f) => f.code === 'policy-error' || f.code === 'console-error')).toBe(true);
  });

  it('rejects a review that submits without interaction, and steps that do not lead to a result', async () => {
    const early = good.replace("root.append(wrap);", "root.append(wrap); if (ctx.mode === 'review') ctx.submitResult({ outcome: 'correct' });");
    const r1 = await run(cand(early));
    expect(errors(r1)).toContain('result-without-interaction@review/light');

    const r2 = await run(cand(good, ['review'], { correct: [click('#nope')], incorrect: [click('#opt-a')] }));
    const e2 = errors(r2);
    expect(e2).toContain('no-result@review/correct');
    expect(e2).toContain('wrong-outcome@review/incorrect');
    expect(r2.findings.find((f) => f.code === 'no-result')!.message).toContain('"#nope" matches nothing');
  });
});
