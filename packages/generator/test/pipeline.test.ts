import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { Budget, runPipeline, type SandboxRunner } from '../src/pipeline.ts';
import { MockProvider } from '../src/provider/mock.ts';
import type { CompletionRequest } from '../src/provider/types.ts';
import type { Candidate, Finding, GenerationInput, JudgeVerdict, ModelOutput, SandboxReport } from '../src/types.ts';

const good = readFileSync(new URL('./fixtures/good.js', import.meta.url), 'utf8');
const click = (selector: string) => ({ action: 'click' as const, selector, x: null, y: null, x2: null, y2: null, value: null });
const output = (source: string): string =>
  JSON.stringify({ title: '角的大小', design: 'two angles', source, reviewTest: { correct: [click('#opt-a')], incorrect: [click('#opt-b')] } } satisfies ModelOutput);
const verdict = (over: Partial<JudgeVerdict> = {}): string =>
  JSON.stringify({
    accept: true,
    scores: { conveysIdea: 5, correctness: 5, legibility: 5, visualQuality: 4, reviewQuestion: 4 },
    issues: [],
    summary: 'fine',
    ...over,
  } satisfies JudgeVerdict);

const input: GenerationInput = {
  knowledgePoint: { id: 'test.angles', title: '角', subject: '数学', content: '左边的角更大。', language: 'zh-CN' },
  modes: ['learn', 'review'],
};

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'wengu-gen-test-'));

function png(): Buffer {
  const p = new PNG({ width: 4, height: 4 });
  p.data.fill(200);
  return PNG.sync.write(p);
}

/** Fake sandbox: writes one screenshot and returns the given findings. */
function fakeSandbox(findingsPerCall: Finding[][]): SandboxRunner & { calls: number } {
  let calls = 0;
  const fn = (async (_cand: Candidate, opts: Parameters<SandboxRunner>[1]) => {
    const findings = findingsPerCall[calls++] ?? [];
    await writeFile(path.join(opts.outDir, 'learn-light.png'), png());
    return {
      findings,
      screenshots: [{ file: `${opts.relPrefix}learn-light.png`, label: 'learn, light', mode: 'learn', scheme: 'light', inkRatio: 0.2, width: 4, height: 4 }],
      runs: [],
      durationMs: 5,
    } satisfies SandboxReport;
  }) as unknown as SandboxRunner & { calls: number };
  Object.defineProperty(fn, 'calls', { get: () => calls });
  return fn;
}

const lastUserText = (req: CompletionRequest) => {
  const m = req.messages.at(-1)!;
  return typeof m.content === 'string' ? m.content : m.content.map((c) => (c.type === 'text' ? c.text : '[image]')).join('\n');
};

describe('repair loop', () => {
  it('feeds static findings back and accepts the repaired attempt', async () => {
    const out = tmp();
    const provider = new MockProvider({
      generate: [output('export function mount(root, ctx) {'), output(good)],
      judge: [verdict()],
    });
    const sandbox = fakeSandbox([[]]);
    const r = await runPipeline(input, { provider, sandbox, outDir: out });

    expect(r.accepted).toBe(true);
    expect(r.stoppedReason).toBe('accepted');
    expect(r.attempts.map((a) => a.passed)).toEqual([false, true]);
    expect(r.attempts[0]!.findings.map((f) => f.code)).toContain('syntax-error');
    expect(sandbox.calls).toBe(1); // attempt 1 never reached the sandbox

    // The repair request carries the previous output and the concrete findings.
    const repair = provider.requests[1]!;
    expect(repair.purpose).toBe('generate');
    expect(repair.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(repair.messages[1]!.content).toContain('export function mount(root, ctx) {');
    expect(lastUserText(repair)).toMatch(/\[static\] syntax-error: module does not parse/);
    // The system prompt is identical across calls (cacheable) and carries the runtime contract verbatim.
    expect(provider.requests[0]!.system).toBe(repair.system);
    expect(repair.system).toContain('export interface ComponentContext');
    expect(repair.system).toContain('--wg-color-accent: #3a5fcd  (dark: #8aa6ff)');

    // The judge saw the screenshot as an image.
    const judgeReq = provider.requests[2]!;
    expect(judgeReq.purpose).toBe('judge');
    const parts = judgeReq.messages[0]!.content;
    expect(Array.isArray(parts) && parts.some((p) => p.type === 'image')).toBe(true);

    expect(readFileSync(path.join(out, 'component.js'), 'utf8')).toBe(good);
    expect(existsSync(path.join(out, 'screenshots/learn-light.png'))).toBe(true);
  });

  it('sends reviewer issues back and stops after max attempts', async () => {
    const out = tmp();
    const bad = verdict({
      accept: false,
      scores: { conveysIdea: 2, correctness: 5, legibility: 3, visualQuality: 3, reviewQuestion: 4 },
      issues: [{ severity: 'major', where: 'learn-light', problem: 'labels overlap the arc', fix: 'move labels outside' }],
      summary: 'decorative',
    });
    const provider = new MockProvider({ generate: [output(good), output(good)], judge: [bad, bad] });
    const r = await runPipeline(input, { provider, sandbox: fakeSandbox([[], []]), outDir: out, maxAttempts: 2 });

    expect(r.accepted).toBe(false);
    expect(r.stoppedReason).toBe('max-attempts');
    expect(r.finalAttempt).toBe(2); // latest attempt that ran cleanly in the sandbox
    const codes = r.attempts[0]!.findings.map((f) => f.code);
    expect(codes).toEqual(['judge-major', 'low-conveysIdea', 'low-legibility']);
    expect(lastUserText(provider.requests[2]!)).toContain('labels overlap the arc → fix: move labels outside');
  });

  it('skips the visual review when the sandbox fails', async () => {
    const provider = new MockProvider({ generate: [output(good), output(good)], judge: [verdict()] });
    const crash: Finding = { stage: 'sandbox', severity: 'error', code: 'mount-error', message: 'TypeError: x is undefined', where: 'learn/light' };
    const r = await runPipeline(input, { provider, sandbox: fakeSandbox([[crash], []]), outDir: tmp() });
    expect(r.accepted).toBe(true);
    expect(provider.requests.map((q) => q.purpose)).toEqual(['generate', 'generate', 'judge']);
    expect(lastUserText(provider.requests[1]!)).toContain('[sandbox · learn/light] mount-error: TypeError: x is undefined');
  });

  it('repairs unparseable output', async () => {
    const provider = new MockProvider({ generate: ['not json', output(good)], judge: [verdict()] });
    const r = await runPipeline(input, { provider, sandbox: fakeSandbox([[]]), outDir: tmp() });
    expect(r.attempts[0]!.findings[0]!.code).toBe('output-invalid');
    expect(r.accepted).toBe(true);
  });

  it('stops when the budget would be exceeded', async () => {
    // Each mock call costs 1000*1 + 500*2 per 1M = $0.002.
    const provider = new MockProvider({ generate: [output('syntax error ('), output(good)], judge: [] });
    const r = await runPipeline(input, {
      provider,
      sandbox: fakeSandbox([]),
      outDir: tmp(),
      budget: new Budget(0.003),
      attemptReserveUsd: 0.002,
    });
    expect(r.stoppedReason).toBe('budget');
    expect(r.attempts).toHaveLength(1);
    expect(r.totals.costUsd).toBeCloseTo(0.002, 6);
  });

  it('stops on provider errors without retrying the model', async () => {
    const provider = new MockProvider({ generate: [] });
    const r = await runPipeline(input, { provider, sandbox: fakeSandbox([]), outDir: tmp() });
    expect(r.attempts).toHaveLength(1);
    expect(r.attempts[0]!.findings[0]!.code).toBe('provider-error');
    expect(r.finalAttempt).toBeNull();
  });
});

describe('report format', () => {
  it('writes report.json with totals, per-attempt calls and files', async () => {
    const out = tmp();
    const provider = new MockProvider({ generate: [output('nope('), output(good)], judge: [verdict()] });
    const r = await runPipeline(input, { provider, sandbox: fakeSandbox([[]]), outDir: out });
    const onDisk = JSON.parse(readFileSync(path.join(out, 'report.json'), 'utf8')) as typeof r;
    expect(onDisk).toEqual(JSON.parse(JSON.stringify(r)));

    expect(Object.keys(onDisk).sort()).toEqual(
      [
        'schemaVersion',
        'knowledgePoint',
        'modes',
        'provider',
        'generatorModel',
        'judgeModel',
        'reasoningEffort',
        'accepted',
        'finalAttempt',
        'attempts',
        'totals',
        'files',
        'startedAt',
        'finishedAt',
        'stoppedReason',
      ].sort(),
    );
    expect(onDisk.schemaVersion).toBe(1);
    expect(onDisk.generatorModel).toBe('mock-model');
    expect(onDisk.finalAttempt).toBe(2);
    expect(onDisk.totals).toMatchObject({ inputTokens: 3000, outputTokens: 1500, reasoningTokens: 300, calls: 3, costUsd: 0.006 });
    expect(onDisk.totals.wallMs).toBeGreaterThanOrEqual(0);
    expect(onDisk.files).toEqual({ source: 'component.js', manifest: 'manifest.json', props: 'props.json', screenshots: ['screenshots/learn-light.png'] });
    const [a1, a2] = onDisk.attempts;
    expect(a1).toMatchObject({ n: 1, passed: false, sourceFile: 'attempts/1/component.js' });
    expect(a1!.calls.map((c) => c.purpose)).toEqual(['generate']);
    expect(a2!.calls.map((c) => c.purpose)).toEqual(['generate', 'judge']);
    expect(a2!.calls[0]).toMatchObject({ model: 'mock-model', usage: { inputTokens: 1000, cachedInputTokens: 0, outputTokens: 500, reasoningTokens: 100 } });
    expect(a2!.judge?.scores.conveysIdea).toBe(5);
    expect(a2!.sandbox?.screenshots[0]!.file).toBe('attempts/2/learn-light.png');
    expect(JSON.parse(readFileSync(path.join(out, 'manifest.json'), 'utf8'))).toMatchObject({ id: 'gen.test.angles', apiVersion: 1 });
    expect(JSON.parse(readFileSync(path.join(out, 'props.json'), 'utf8'))).toEqual({
      knowledgePointId: 'test.angles',
      title: '角',
      subject: '数学',
      language: 'zh-CN',
    });
  });
});
