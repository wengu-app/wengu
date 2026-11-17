/**
 * wengu generator CLI.
 *
 *   generate --input kp.json --out <dir> [--max-attempts 3] [--budget-usd 3] [--deadline-s N] [--no-judge]
 *   evaluate --out <dir> [--budget-usd 9] [--max-attempts 3] kp1.json kp2.json ...
 *   view [--dir <dir>] [--port 5290]
 *
 * Environment (also read from the repo's git-ignored .env):
 *   OPENAI_API_KEY          required for generate/evaluate
 *   WENGU_MODEL             generator model, default gpt-6-astra
 *   WENGU_JUDGE_MODEL       visual-review model, default = WENGU_MODEL
 *   WENGU_EFFORT            generator reasoning effort, default medium
 *   WENGU_JUDGE_EFFORT      reviewer reasoning effort, default medium
 *
 * Relative paths are resolved against the directory pnpm was invoked from (INIT_CWD).
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadDotEnv } from './env.ts';
import { parseInput } from './knowledge.ts';
import { Budget, runPipeline } from './pipeline.ts';
import { OpenAIProvider } from './provider/openai.ts';
import type { ReasoningEffort } from './provider/types.ts';
import { openSandboxEnv, runSandbox, type SandboxEnv } from './sandbox/run.ts';
import { startServers } from './sandbox/server.ts';
import { PKG_ROOT } from './libraries.ts';
import type { GenerationReport } from './types.ts';

const DEFAULT_MODEL = 'gpt-6-astra';
const baseDir = process.env.INIT_CWD ?? process.cwd();
const resolve = (p: string) => path.resolve(baseDir, p);

function providers() {
  loadDotEnv(PKG_ROOT);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set (environment or .env)');
  const model = process.env.WENGU_MODEL || DEFAULT_MODEL;
  const judgeModel = process.env.WENGU_JUDGE_MODEL || model;
  const provider = new OpenAIProvider({ apiKey, model });
  const judgeProvider = judgeModel === model ? provider : new OpenAIProvider({ apiKey, model: judgeModel });
  const effort = {
    generate: (process.env.WENGU_EFFORT || 'medium') as ReasoningEffort,
    judge: (process.env.WENGU_JUDGE_EFFORT || 'medium') as ReasoningEffort,
  };
  return { provider, judgeProvider, effort };
}

const log = (m: string) => console.log(m);

async function generateOne(
  env: SandboxEnv,
  inputFile: string,
  outDir: string,
  o: { maxAttempts: number; budget: Budget; skipJudge: boolean; deadlineMs?: number },
): Promise<GenerationReport> {
  const input = parseInput(JSON.parse(await readFile(inputFile, 'utf8')));
  const { provider, judgeProvider, effort } = providers();
  log(`\n== ${input.knowledgePoint.title} (${input.knowledgePoint.id}) -> ${outDir}`);
  const report = await runPipeline(input, {
    provider,
    judgeProvider,
    reasoningEffort: effort,
    sandbox: (cand, so) => runSandbox(env, cand, so),
    outDir,
    maxAttempts: o.maxAttempts,
    budget: o.budget,
    attemptReserveUsd: 0.6,
    skipJudge: o.skipJudge,
    ...(o.deadlineMs ? { deadlineMs: o.deadlineMs } : {}),
    log,
  });
  log(
    `== ${report.accepted ? 'ACCEPTED' : 'NOT ACCEPTED'} after ${report.attempts.length} attempt(s), ` +
      `${(report.totals.wallMs / 1000).toFixed(0)} s, $${report.totals.costUsd.toFixed(3)} (total so far $${o.budget.spentUsd.toFixed(3)})`,
  );
  return report;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      input: { type: 'string' },
      out: { type: 'string' },
      dir: { type: 'string' },
      port: { type: 'string' },
      'max-attempts': { type: 'string' },
      'budget-usd': { type: 'string' },
      'no-judge': { type: 'boolean' },
      'deadline-s': { type: 'string' },
    },
  });
  const maxAttempts = Number(values['max-attempts'] ?? 3);

  if (cmd === 'generate') {
    if (!values.input || !values.out) throw new Error('usage: generate --input kp.json --out <dir>');
    const env = await openSandboxEnv();
    try {
      const budget = new Budget(Number(values['budget-usd'] ?? 3));
      const r = await generateOne(env, resolve(values.input), resolve(values.out), { maxAttempts, budget, skipJudge: !!values['no-judge'], ...(values['deadline-s'] ? { deadlineMs: Number(values['deadline-s']) * 1000 } : {}) });
      process.exitCode = r.accepted ? 0 : 2;
    } finally {
      await env.close();
    }
    return;
  }

  if (cmd === 'evaluate') {
    if (!values.out || positionals.length === 0) throw new Error('usage: evaluate --out <dir> kp1.json kp2.json ...');
    const outRoot = resolve(values.out);
    await mkdir(outRoot, { recursive: true });
    const budget = new Budget(Number(values['budget-usd'] ?? 9));
    const env = await openSandboxEnv();
    const rows: Array<Record<string, unknown>> = [];
    try {
      for (const f of positionals) {
        const name = path.basename(f, '.json');
        if (budget.exceeded(1)) {
          log(`budget nearly exhausted ($${budget.spentUsd.toFixed(2)}); skipping ${name}`);
          rows.push({ name, skipped: 'budget' });
          continue;
        }
        const r = await generateOne(env, resolve(f), path.join(outRoot, name), { maxAttempts, budget, skipJudge: !!values['no-judge'] });
        const last = r.attempts.at(-1);
        rows.push({
          name,
          title: r.knowledgePoint.title,
          subject: r.knowledgePoint.subject,
          accepted: r.accepted,
          attempts: r.attempts.length,
          wallSeconds: Math.round(r.totals.wallMs / 1000),
          inputTokens: r.totals.inputTokens,
          cachedInputTokens: r.totals.cachedInputTokens,
          outputTokens: r.totals.outputTokens,
          reasoningTokens: r.totals.reasoningTokens,
          costUsd: r.totals.costUsd,
          finalScores: r.attempts.find((a) => a.n === r.finalAttempt)?.judge?.scores ?? null,
          lastFindings: last?.findings.filter((x) => x.severity === 'error').map((x) => `${x.stage}/${x.code}`) ?? [],
        });
        await writeFile(
          path.join(outRoot, 'evaluation.json'),
          JSON.stringify({ model: process.env.WENGU_MODEL || DEFAULT_MODEL, judgeModel: process.env.WENGU_JUDGE_MODEL || process.env.WENGU_MODEL || DEFAULT_MODEL, totalCostUsd: Number(budget.spentUsd.toFixed(4)), rows }, null, 2) + '\n',
        );
      }
    } finally {
      await env.close();
    }
    console.table(rows.map((r) => ({ name: r.name, accepted: r.accepted, attempts: r.attempts, s: r.wallSeconds, usd: r.costUsd })));
    log(`total estimated spend: $${budget.spentUsd.toFixed(3)}`);
    return;
  }

  if (cmd === 'view') {
    const dir = resolve(values.dir ?? path.join(PKG_ROOT, 'examples'));
    const servers = await startServers({ componentsDir: dir, appPort: Number(values.port ?? 5290) });
    log(`viewer: ${servers.appUrl}/  (components from ${dir}; sandbox ${servers.sandboxUrl}). Ctrl-C to stop.`);
    const stop = () => void servers.close().then(() => process.exit(0));
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    return;
  }

  throw new Error(`unknown command ${cmd ?? '(none)'}; use generate | evaluate | view`);
}

main().catch((e: unknown) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
