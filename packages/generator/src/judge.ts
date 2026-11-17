/**
 * Visual review: a vision model looks at the self-check screenshots against the knowledge point and reports
 * rendering problems, legibility, factual errors and whether the visual teaches. Acceptance is decided here from its
 * scores and issues, not from its own `accept` alone.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Mode } from '@wengu/runtime';
import type { ContentPart, ModelProvider, ReasoningEffort } from './provider/types.ts';
import type { CallRecord, Candidate, Finding, JudgeVerdict, KnowledgePoint, SandboxReport, Screenshot } from './types.ts';

export const JUDGE_SYSTEM = `You review interactive learning visualizations for Wengu, a spaced-repetition learning app.
You get a knowledge point, the author's description of the design, and screenshots of the component as rendered in the
real sandbox (light and dark theme; learn mode; review mode before and after scripted answers). You are a demanding
reviewer: a component is shown to learners only if it is correct, legible and actually teaches.

Check, looking closely at every screenshot:
1. Rendering: blank areas where content should be, broken or cut-off drawing, elements outside the frame, WebGL/canvas
   that failed, content clipped at the bottom/right, a theme where text or lines become invisible (dark on dark,
   light on light), visible error text.
2. Text: overlapping labels, labels colliding with the drawing, text too small or too low-contrast to read, truncated
   text, text in a different language than the knowledge point's.
3. Correctness: anything that contradicts the knowledge point or standard textbook facts (wrong numbers, wrong
   labels, wrong directions, wrong structure, misleading proportions not marked as schematic).
4. Teaching: does the visual itself carry the idea (would the picture still show the mechanism with the text covered),
   or is it decoration next to text? Is the key relationship visible in the initial state?
5. Review mode (if present): is it a genuine recall question about this knowledge point? Is the answer hidden before
   answering (not given away by labels/values on screen)? After the scripted answers, is the feedback clear and
   correct (right vs wrong, the correct answer revealed)?

Scores are 1-5 (5 = excellent, 4 = good with small flaws, 3 = acceptable but clearly flawed, 2 = poor, 1 = broken/absent).
List concrete issues with where they are (which screenshot, which element) and a concrete fix the author can apply.
Severity: blocker = must not be shown (broken, wrong facts, unreadable); major = a learner would be confused or
misled, or the visual doesn't teach; minor = polish. Do not invent problems you cannot see; do not pad the list.`;

export const JUDGE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['scores', 'issues', 'summary', 'accept'],
  properties: {
    scores: {
      type: 'object',
      additionalProperties: false,
      required: ['conveysIdea', 'correctness', 'legibility', 'visualQuality', 'reviewQuestion'],
      properties: {
        conveysIdea: { type: 'integer' },
        correctness: { type: 'integer' },
        legibility: { type: 'integer' },
        visualQuality: { type: 'integer' },
        reviewQuestion: { type: ['integer', 'null'] },
      },
    },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'where', 'problem', 'fix'],
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          where: { type: 'string' },
          problem: { type: 'string' },
          fix: { type: 'string' },
        },
      },
    },
    summary: { type: 'string' },
    accept: { type: 'boolean' },
  },
};

/** Which screenshots the judge sees, in order. */
const JUDGE_SHOTS = ['learn-light', 'learn-dark', 'learn-dark-interacted', 'review-light', 'review-correct-light', 'review-incorrect-dark'];

export function pickScreenshots(shots: Screenshot[]): Screenshot[] {
  const byName = (s: Screenshot) => path.basename(s.file, '.png');
  return JUDGE_SHOTS.map((n) => shots.find((s) => byName(s) === n)).filter((s): s is Screenshot => !!s);
}

export const THRESHOLDS = { conveysIdea: 4, correctness: 4, legibility: 4, visualQuality: 3, reviewQuestion: 4 } as const;

/** Turns a verdict into findings; errors block acceptance. */
export function verdictFindings(v: JudgeVerdict, modes: Mode[]): Finding[] {
  const out: Finding[] = [];
  for (const i of v.issues) {
    out.push({
      stage: 'judge',
      severity: i.severity === 'minor' ? 'warning' : 'error',
      code: `judge-${i.severity}`,
      message: `${i.problem} → fix: ${i.fix}`,
      where: i.where,
    });
  }
  for (const [k, min] of Object.entries(THRESHOLDS)) {
    if (k === 'reviewQuestion' && !modes.includes('review')) continue;
    const s = v.scores[k as keyof typeof v.scores];
    if (typeof s !== 'number' || s < min) {
      out.push({ stage: 'judge', severity: 'error', code: `low-${k}`, message: `reviewer scored ${k} ${String(s)}/5 (needs ${min}): ${v.summary}` });
    }
  }
  if (!v.accept && !out.some((f) => f.severity === 'error')) {
    out.push({ stage: 'judge', severity: 'error', code: 'judge-rejected', message: `reviewer did not accept: ${v.summary}` });
  }
  return out;
}

export function parseVerdict(text: string): JudgeVerdict | null {
  try {
    const v = JSON.parse(text) as JudgeVerdict;
    if (!v || typeof v !== 'object' || !v.scores || !Array.isArray(v.issues)) return null;
    return v;
  } catch {
    return null;
  }
}

export async function judge(
  provider: ModelProvider,
  kp: KnowledgePoint,
  modes: Mode[],
  cand: Candidate,
  sandbox: SandboxReport,
  baseDir: string,
  opts: { reasoningEffort?: ReasoningEffort; imageDetail?: 'low' | 'high' | 'auto' } = {},
): Promise<{ verdict: JudgeVerdict | null; findings: Finding[]; call: CallRecord }> {
  const shots = pickScreenshots(sandbox.screenshots);
  const reviewLog = sandbox.runs
    .flatMap((r) => r.results)
    .map((r) => `${r.step}: ${r.outcome ?? 'no result'}${r.detail ? ` (detail: ${r.detail})` : ''}`)
    .join('\n');
  const content: ContentPart[] = [
    {
      type: 'text',
      text: `Knowledge point (${kp.subject}, language ${kp.language ?? 'zh-CN'}):
# ${kp.title}
${kp.content}

Modes implemented: ${modes.join(', ')}.
Author's design description: ${cand.design || '(none)'}
${modes.includes('review') ? `\nResults reported by the component for the scripted answers:\n${reviewLog || '(none)'}\n` : ''}
Screenshots follow (frame width 720 px, device scale 1), each preceded by its label.`,
    },
  ];
  for (const s of shots) {
    const data = await readFile(path.join(baseDir, s.file));
    content.push({ type: 'text', text: `Screenshot: ${s.label}` });
    content.push({ type: 'image', mediaType: 'image/png', dataBase64: data.toString('base64'), detail: opts.imageDetail ?? 'high' });
  }
  const res = await provider.complete({
    purpose: 'judge',
    system: JUDGE_SYSTEM,
    messages: [{ role: 'user', content }],
    jsonSchema: { name: 'review', schema: JUDGE_SCHEMA },
    maxOutputTokens: 16_000,
    reasoningEffort: opts.reasoningEffort ?? 'medium',
  });
  const call: CallRecord = {
    purpose: 'judge',
    model: res.model,
    durationMs: Math.round(res.durationMs),
    usage: res.usage,
    costUsd: provider.cost(res.usage),
    ...(res.incomplete ? { incomplete: res.incomplete } : {}),
  };
  const verdict = parseVerdict(res.text);
  if (!verdict) {
    return {
      verdict: null,
      call,
      findings: [{ stage: 'judge', severity: 'error', code: 'judge-unparseable', message: `the reviewer's answer could not be parsed${res.incomplete ? ` (${res.incomplete})` : ''}` }],
    };
  }
  return { verdict, findings: verdictFindings(verdict, modes), call };
}
