import type { ComponentManifest, Mode, SourceReference } from '@wengu/runtime';
import type { Usage } from './provider/types.ts';

/** What the generator is asked to teach. */
export interface KnowledgePoint {
  /** Stable id, e.g. "physics.mechanics.pendulum". */
  id: string;
  title: string;
  subject: string;
  /** The content to teach, in the learner's language. Facts the component must get right. */
  content: string;
  sources?: SourceReference[];
  /** BCP 47 language of all text the learner sees. Default "zh-CN". */
  language?: string;
}

export interface GenerationInput {
  knowledgePoint: KnowledgePoint;
  modes: Mode[];
}

/** One scripted interaction step, run against the component frame by the self-check. */
export interface ReviewStep {
  action: 'click' | 'clickAt' | 'fill' | 'press' | 'drag' | 'wait';
  /** CSS selector inside the component (click, fill, and optionally press). */
  selector: string | null;
  /** clickAt / drag start: fractions [0,1] of the root element's box. */
  x: number | null;
  y: number | null;
  /** drag end, fractions of the root box. */
  x2: number | null;
  y2: number | null;
  /** fill: text; press: key name (e.g. "Enter"); wait: milliseconds as a string. */
  value: string | null;
}

/** How the self-check answers the review question: once correctly, once incorrectly. */
export interface ReviewTest {
  correct: ReviewStep[];
  incorrect: ReviewStep[];
}

/** What the model returns (structured output). */
export interface ModelOutput {
  title: string;
  /** One paragraph: what the learner sees and does, and why it teaches the point. */
  design: string;
  /** The ES module source. */
  source: string;
  reviewTest: ReviewTest | null;
}

export interface Candidate {
  manifest: ComponentManifest;
  source: string;
  design: string;
  reviewTest: ReviewTest | null;
}

export type Stage = 'generate' | 'parse' | 'static' | 'sandbox' | 'review' | 'judge' | 'budget';

export interface Finding {
  stage: Stage;
  /** error: blocks acceptance. warning: reported, does not block. */
  severity: 'error' | 'warning';
  code: string;
  message: string;
  /** Run in which it was observed, e.g. "learn/dark". */
  where?: string;
}

export interface CallRecord {
  purpose: 'generate' | 'judge';
  model: string;
  durationMs: number;
  usage: Usage;
  costUsd: number;
  incomplete?: string;
}

export interface Screenshot {
  /** Path relative to the output directory. */
  file: string;
  label: string;
  mode: Mode;
  scheme: 'light' | 'dark';
  /** Share of pixels that differ from the dominant colour; ~0 means blank. */
  inkRatio: number;
  width: number;
  height: number;
}

export interface SandboxRunLog {
  mode: Mode;
  ready: boolean;
  mountMs: number | null;
  /** Host events other than heartbeats and resizes. */
  events: Array<Record<string, unknown>>;
  consoleErrors: string[];
  results: Array<{ step: 'before-interaction' | 'correct' | 'incorrect'; outcome: string | null; detail?: string }>;
  finalHeight: number | null;
}

export interface SandboxReport {
  findings: Finding[];
  screenshots: Screenshot[];
  runs: SandboxRunLog[];
  durationMs: number;
}

export interface JudgeScores {
  conveysIdea: number;
  correctness: number;
  legibility: number;
  visualQuality: number;
  /** null when review mode was not requested. */
  reviewQuestion: number | null;
}

export interface JudgeIssue {
  severity: 'blocker' | 'major' | 'minor';
  where: string;
  problem: string;
  fix: string;
}

export interface JudgeVerdict {
  accept: boolean;
  scores: JudgeScores;
  issues: JudgeIssue[];
  summary: string;
}

export interface AttemptRecord {
  n: number;
  startedAt: string;
  durationMs: number;
  calls: CallRecord[];
  /** Relative path of this attempt's module source (absent if the model output could not be parsed). */
  sourceFile?: string;
  design?: string;
  findings: Finding[];
  sandbox?: Omit<SandboxReport, 'findings'>;
  judge?: JudgeVerdict;
  passed: boolean;
}

export interface GenerationReport {
  schemaVersion: 1;
  knowledgePoint: KnowledgePoint;
  modes: Mode[];
  provider: string;
  generatorModel: string;
  judgeModel: string;
  reasoningEffort: { generate: string; judge: string };
  accepted: boolean;
  /** Attempt whose output is in component.js (the accepted one, or the last that produced code). */
  finalAttempt: number | null;
  attempts: AttemptRecord[];
  totals: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    costUsd: number;
    wallMs: number;
    calls: number;
  };
  /** Files in the output directory, relative paths. */
  files: { source?: string; manifest?: string; props?: string; screenshots: string[] };
  startedAt: string;
  finishedAt: string;
  stoppedReason: 'accepted' | 'max-attempts' | 'budget' | 'deadline';
}
