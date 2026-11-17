/**
 * generate -> static check -> sandbox run -> visual review, repeated with the concrete findings until a candidate
 * passes or the attempt/budget limit is hit. Every attempt is recorded in report.json.
 */

import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { LibraryId, Mode } from '@wengu/runtime';
import { judge } from './judge.ts';
import { allowedSpecifiers } from './libraries.ts';
import { buildMessages, OUTPUT_SCHEMA, systemPrompt } from './prompt.ts';
import type { ModelProvider, ReasoningEffort, Usage } from './provider/types.ts';
import { parseModelOutput, staticCheck } from './static-check.ts';
import type { AttemptRecord, Candidate, Finding, GenerationInput, GenerationReport, ModelOutput, SandboxReport } from './types.ts';

export type SandboxRunner = (
  cand: Candidate,
  opts: { modes: Mode[]; props: Record<string, string>; outDir: string; relPrefix: string },
) => Promise<SandboxReport>;

/** Shared spend tracker, so a batch (evaluation) can stop before it exceeds its budget. */
export class Budget {
  spentUsd = 0;
  readonly limitUsd: number;
  constructor(limitUsd = Infinity) {
    this.limitUsd = limitUsd;
  }
  add(usd: number) {
    this.spentUsd += usd;
  }
  /** True if spending `nextEstimateUsd` more would exceed the limit. */
  exceeded(nextEstimateUsd = 0) {
    return this.spentUsd + nextEstimateUsd > this.limitUsd;
  }
}

export interface PipelineOptions {
  provider: ModelProvider;
  /** Defaults to `provider`. */
  judgeProvider?: ModelProvider;
  sandbox: SandboxRunner;
  outDir: string;
  maxAttempts?: number;
  budget?: Budget;
  /** Cost reserved before starting an attempt (rough upper estimate of one generate + judge). */
  attemptReserveUsd?: number;
  reasoningEffort?: { generate?: ReasoningEffort; judge?: ReasoningEffort };
  /** Do not start a new attempt after this many ms of wall time. */
  deadlineMs?: number;
  /** Skip the visual review (e.g. for a quick local run). */
  skipJudge?: boolean;
  /** Allowed import specifiers; default: the built library bundles. */
  allowed?: Map<string, LibraryId>;
  log?: (msg: string) => void;
}

export function propsFor(input: GenerationInput): Record<string, string> {
  const kp = input.knowledgePoint;
  return { knowledgePointId: kp.id, title: kp.title, subject: kp.subject, language: kp.language ?? 'zh-CN' };
}

const addUsage = (a: Usage, b: Usage): Usage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  reasoningTokens: a.reasoningTokens + b.reasoningTokens,
});

export async function runPipeline(input: GenerationInput, opts: PipelineOptions): Promise<GenerationReport> {
  const t0 = performance.now();
  const startedAt = new Date().toISOString();
  const { knowledgePoint: kp, modes } = input;
  const log = opts.log ?? (() => {});
  const judgeProvider = opts.judgeProvider ?? opts.provider;
  const maxAttempts = opts.maxAttempts ?? 3;
  const budget = opts.budget ?? new Budget();
  const effort = { generate: opts.reasoningEffort?.generate ?? 'medium', judge: opts.reasoningEffort?.judge ?? 'medium' } as const;
  const allowed = opts.allowed ?? allowedSpecifiers();
  const props = propsFor(input);
  const system = systemPrompt();
  await mkdir(opts.outDir, { recursive: true });

  const attempts: AttemptRecord[] = [];
  const candidates = new Map<number, { cand: Candidate; sandbox?: SandboxReport; sandboxOk: boolean }>();
  let previous: { output: ModelOutput | string; findings: Finding[]; attempt: number; earlier: Finding[] } | undefined;
  let stoppedReason: GenerationReport['stoppedReason'] = 'max-attempts';
  let acceptedAttempt: number | null = null;

  const report = (): GenerationReport => {
    let usage: Usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 };
    let cost = 0;
    let calls = 0;
    for (const a of attempts)
      for (const c of a.calls) {
        usage = addUsage(usage, c.usage);
        cost += c.costUsd;
        calls++;
      }
    return {
      schemaVersion: 1,
      knowledgePoint: kp,
      modes,
      provider: opts.provider.name,
      generatorModel: opts.provider.model,
      judgeModel: opts.skipJudge ? '(skipped)' : judgeProvider.model,
      reasoningEffort: { generate: effort.generate, judge: effort.judge },
      accepted: acceptedAttempt !== null,
      finalAttempt: null,
      attempts,
      totals: { ...usage, costUsd: Number(cost.toFixed(4)), wallMs: Math.round(performance.now() - t0), calls },
      files: { screenshots: [] },
      startedAt,
      finishedAt: new Date().toISOString(),
      stoppedReason,
    };
  };
  const saveReport = (r: GenerationReport) => writeFile(path.join(opts.outDir, 'report.json'), JSON.stringify(r, null, 2) + '\n');

  for (let n = 1; n <= maxAttempts; n++) {
    if (budget.exceeded(opts.attemptReserveUsd ?? 0)) {
      stoppedReason = 'budget';
      log(`budget: $${budget.spentUsd.toFixed(2)} spent of $${budget.limitUsd}; not starting attempt ${n}`);
      break;
    }
    if (opts.deadlineMs !== undefined && performance.now() - t0 > opts.deadlineMs) {
      stoppedReason = 'deadline';
      log(`deadline: ${Math.round((performance.now() - t0) / 1000)} s elapsed; not starting attempt ${n}`);
      break;
    }
    const at0 = performance.now();
    const rec: AttemptRecord = { n, startedAt: new Date().toISOString(), durationMs: 0, calls: [], findings: [], passed: false };
    attempts.push(rec);
    const dir = path.join(opts.outDir, 'attempts', String(n));
    const rel = `attempts/${n}/`;
    await mkdir(dir, { recursive: true });
    const finish = async () => {
      rec.durationMs = Math.round(performance.now() - at0);
      await saveReport(report());
    };

    // ---------------------------------------------------------------- generate
    log(`attempt ${n}: generating with ${opts.provider.model} (effort ${effort.generate}) ...`);
    let text: string;
    try {
      const res = await opts.provider.complete({
        purpose: 'generate',
        system,
        messages: buildMessages(kp, modes, previous),
        jsonSchema: { name: 'component', schema: OUTPUT_SCHEMA },
        maxOutputTokens: 64_000,
        reasoningEffort: effort.generate,
      });
      const cost = opts.provider.cost(res.usage);
      budget.add(cost);
      rec.calls.push({
        purpose: 'generate',
        model: res.model,
        durationMs: Math.round(res.durationMs),
        usage: res.usage,
        costUsd: cost,
        ...(res.incomplete ? { incomplete: res.incomplete } : {}),
      });
      log(`  generated in ${(res.durationMs / 1000).toFixed(0)} s, ${res.usage.outputTokens} output tokens, $${cost.toFixed(3)}`);
      text = res.text;
      if (res.incomplete) rec.findings.push({ stage: 'generate', severity: 'error', code: 'output-truncated', message: `output incomplete: ${res.incomplete}` });
    } catch (e) {
      rec.findings.push({ stage: 'generate', severity: 'error', code: 'provider-error', message: (e as Error).message.slice(0, 1000) });
      await finish();
      log(`  provider error: ${(e as Error).message.slice(0, 200)}`);
      // A provider failure is not something the model can repair; stop.
      break;
    }

    // ---------------------------------------------------------------- parse + static
    const parsed = parseModelOutput(text);
    if (!parsed.ok) {
      rec.findings.push(parsed.finding);
      await writeFile(path.join(dir, 'output.txt'), text);
      previous = { output: text.slice(0, 200_000), findings: rec.findings, attempt: n, earlier: attempts.slice(0, -1).flatMap((a) => a.findings) };
      log(`  unparseable output`);
      await finish();
      continue;
    }
    const output = parsed.value;
    await writeFile(path.join(dir, 'component.js'), output.source);
    rec.sourceFile = `${rel}component.js`;
    rec.design = output.design;
    await writeFile(path.join(dir, 'output.json'), JSON.stringify({ ...output, source: `(see component.js)` }, null, 2));

    const st = staticCheck(kp, output, { modes, allowed });
    rec.findings.push(...st.findings);
    const next = (fs: Finding[]) => {
      previous = { output, findings: fs, attempt: n, earlier: attempts.slice(0, -1).flatMap((a) => a.findings) };
    };
    if (!st.candidate) {
      log(`  static check failed: ${st.findings.filter((f) => f.severity === 'error').map((f) => f.code).join(', ')}`);
      next(rec.findings);
      await finish();
      continue;
    }
    const cand = st.candidate;
    await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(cand.manifest, null, 2) + '\n');

    // ---------------------------------------------------------------- sandbox
    log(`  running in the sandbox ...`);
    const sb = await opts.sandbox(cand, { modes, props, outDir: dir, relPrefix: rel });
    rec.findings.push(...sb.findings);
    rec.sandbox = { screenshots: sb.screenshots, runs: sb.runs, durationMs: Math.round(sb.durationMs) };
    const sandboxOk = !sb.findings.some((f) => f.severity === 'error');
    candidates.set(n, { cand, sandbox: sb, sandboxOk });
    if (!sandboxOk) {
      log(`  sandbox failed: ${sb.findings.filter((f) => f.severity === 'error').map((f) => `${f.code}@${f.where ?? ''}`).join(', ')}`);
      next(rec.findings);
      await finish();
      continue;
    }

    // ---------------------------------------------------------------- visual review
    if (!opts.skipJudge) {
      if (budget.exceeded()) {
        stoppedReason = 'budget';
        rec.findings.push({ stage: 'budget', severity: 'error', code: 'budget-exhausted', message: 'budget exhausted before the visual review' });
        await finish();
        break;
      }
      log(`  visual review with ${judgeProvider.model} ...`);
      try {
        const j = await judge(judgeProvider, kp, modes, cand, sb, opts.outDir, { reasoningEffort: effort.judge });
        budget.add(j.call.costUsd);
        rec.calls.push(j.call);
        rec.findings.push(...j.findings);
        if (j.verdict) rec.judge = j.verdict;
        if (j.verdict) {
          const s = j.verdict.scores;
          log(`  review: idea ${s.conveysIdea} correct ${s.correctness} legible ${s.legibility} visual ${s.visualQuality} review ${s.reviewQuestion ?? '-'}; ${j.verdict.issues.length} issue(s), $${j.call.costUsd.toFixed(3)}`);
        }
      } catch (e) {
        rec.findings.push({ stage: 'judge', severity: 'error', code: 'provider-error', message: (e as Error).message.slice(0, 1000) });
        await finish();
        break;
      }
    }
    rec.passed = !rec.findings.some((f) => f.severity === 'error');
    if (rec.passed) {
      acceptedAttempt = n;
      stoppedReason = 'accepted';
      log(`  accepted`);
      await finish();
      break;
    }
    next(rec.findings);
    await finish();
  }

  // ---------------------------------------------------------------- final output
  const final = report();
  // The accepted attempt, else the latest one that ran cleanly in the sandbox, else the latest that got that far.
  const pick =
    acceptedAttempt ??
    [...candidates.entries()].reverse().find(([, c]) => c.sandboxOk)?.[0] ??
    [...candidates.keys()].pop() ??
    null;
  final.finalAttempt = pick;
  if (pick !== null) {
    const c = candidates.get(pick)!;
    await writeFile(path.join(opts.outDir, 'component.js'), c.cand.source);
    await writeFile(path.join(opts.outDir, 'manifest.json'), JSON.stringify(c.cand.manifest, null, 2) + '\n');
    await writeFile(path.join(opts.outDir, 'props.json'), JSON.stringify(props, null, 2) + '\n');
    const shotsDir = path.join(opts.outDir, 'screenshots');
    await mkdir(shotsDir, { recursive: true });
    const shots: string[] = [];
    for (const s of c.sandbox?.screenshots ?? []) {
      const dest = `screenshots/${path.basename(s.file)}`;
      await copyFile(path.join(opts.outDir, s.file), path.join(opts.outDir, dest));
      shots.push(dest);
    }
    final.files = { source: 'component.js', manifest: 'manifest.json', props: 'props.json', screenshots: shots };
  }
  await saveReport(final);
  return final;
}
