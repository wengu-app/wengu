/**
 * Checks that need no browser: the model output is well-formed, the module parses, exports `mount`, imports only
 * libraries the host provides, avoids APIs the sandbox blocks, and yields a valid manifest.
 */

import * as acorn from 'acorn';
import { MAX_SOURCE_LENGTH, validateManifest, type ComponentManifest, type LibraryId, type Mode } from '@wengu/runtime';
import type { Candidate, Finding, KnowledgePoint, ModelOutput, ReviewStep, ReviewTest } from './types.ts';

type Node = acorn.Node & Record<string, unknown>;

const err = (code: string, message: string): Finding => ({ stage: 'static', severity: 'error', code, message });
const warn = (code: string, message: string): Finding => ({ stage: 'static', severity: 'warning', code, message });

// ------------------------------------------------------------------------------------------ model output

export function parseModelOutput(text: string): { ok: true; value: ModelOutput } | { ok: false; finding: Finding } {
  const fail = (message: string): { ok: false; finding: Finding } => ({
    ok: false,
    finding: { stage: 'parse', severity: 'error', code: 'output-invalid', message },
  });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    // Tolerate a fenced block around the JSON.
    const m = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
    try {
      raw = m ? JSON.parse(m[1]!) : undefined;
    } catch {
      raw = undefined;
    }
    if (raw === undefined) return fail(`output is not JSON: ${(e as Error).message}`);
  }
  if (typeof raw !== 'object' || raw === null) return fail('output is not an object');
  const o = raw as Record<string, unknown>;
  if (typeof o.source !== 'string' || !o.source.trim()) return fail('output.source missing or empty');
  if (typeof o.title !== 'string' || !o.title.trim()) return fail('output.title missing');
  const reviewTest = o.reviewTest === null || o.reviewTest === undefined ? null : (o.reviewTest as ReviewTest);
  return {
    ok: true,
    value: { title: o.title.trim(), design: typeof o.design === 'string' ? o.design : '', source: o.source, reviewTest },
  };
}

// ------------------------------------------------------------------------------------------ manifest

export function manifestId(kpId: string): string {
  const slug = kpId
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/[.-]{2,}/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '');
  return `gen.${slug || 'component'}`.slice(0, 128).replace(/[.-]+$/, '');
}

export function buildManifest(kp: KnowledgePoint, title: string, modes: Mode[], libraries: LibraryId[]): ComponentManifest {
  return {
    id: manifestId(kp.id),
    title: title.slice(0, 200),
    apiVersion: 1,
    libraries,
    knowledgePoints: [kp.id],
    sources: kp.sources ?? [],
    modes: [...modes],
  };
}

// ------------------------------------------------------------------------------------------ module checks

function walk(node: unknown, visit: (n: Node, parent: Node | null) => void, parent: Node | null = null) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const c of node) walk(c, visit, parent);
    return;
  }
  const n = node as Node;
  if (typeof n.type !== 'string') return;
  visit(n, parent);
  for (const key of Object.keys(n)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue;
    walk(n[key], visit, n);
  }
}

const BLOCKED_GLOBALS: Record<string, string> = {
  fetch: 'network is blocked in the sandbox',
  XMLHttpRequest: 'network is blocked in the sandbox',
  WebSocket: 'network is blocked in the sandbox',
  EventSource: 'network is blocked in the sandbox',
  RTCPeerConnection: 'not allowed in components',
  localStorage: 'storage throws in the sandbox (opaque origin)',
  sessionStorage: 'storage throws in the sandbox (opaque origin)',
  indexedDB: 'storage throws in the sandbox (opaque origin)',
  importScripts: 'not available',
};
const BLOCKED_CALLS: Record<string, string> = {
  alert: 'modals are blocked in the sandbox',
  confirm: 'modals are blocked in the sandbox',
  prompt: 'modals are blocked in the sandbox',
};

export interface ModuleInfo {
  imports: string[];
  exportsMount: boolean;
}

export interface StaticCheckOptions {
  modes: Mode[];
  /** Specifier -> library id. */
  allowed: Map<string, LibraryId>;
}

export function analyzeModule(source: string, allowed: Map<string, LibraryId>): { info: ModuleInfo | null; findings: Finding[] } {
  const findings: Finding[] = [];
  if (source.length > MAX_SOURCE_LENGTH) findings.push(err('source-too-large', `source is ${source.length} chars, max ${MAX_SOURCE_LENGTH}`));
  let ast: acorn.Program;
  try {
    ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  } catch (e) {
    findings.push(err('syntax-error', `module does not parse: ${(e as Error).message}`));
    return { info: null, findings };
  }

  const imports: string[] = [];
  let exportsMount = false;
  const line = (n: Node) => (n.loc ? ` (line ${n.loc.start.line})` : '');

  walk(ast, (n, parent) => {
    switch (n.type) {
      case 'ImportDeclaration':
      case 'ExportAllDeclaration':
      case 'ExportNamedDeclaration': {
        const src = n.source as { value?: unknown } | null | undefined;
        if (src && typeof src.value === 'string') imports.push(src.value);
        if (n.type === 'ExportNamedDeclaration') {
          const decl = n.declaration as Node | null;
          if (decl?.type === 'FunctionDeclaration' && (decl.id as { name?: string } | null)?.name === 'mount') exportsMount = true;
          if (decl?.type === 'VariableDeclaration') {
            for (const d of decl.declarations as Node[]) if ((d.id as { name?: string }).name === 'mount') exportsMount = true;
          }
          for (const s of (n.specifiers as Node[]) ?? []) {
            const ex = s.exported as { name?: string; value?: string };
            if ((ex.name ?? ex.value) === 'mount' && !src) exportsMount = true;
          }
        }
        break;
      }
      case 'ImportExpression': {
        const s = n.source as Node;
        if (s.type === 'Literal' && typeof s.value === 'string') imports.push(s.value);
        else findings.push(err('dynamic-import', `dynamic import() with a computed specifier${line(n)}; only static, allowed specifiers work`));
        break;
      }
      case 'Identifier': {
        const name = n.name as string;
        if (!(name in BLOCKED_GLOBALS)) break;
        // Skip property names (obj.fetch, { fetch: ... }) and declarations of local bindings.
        if (parent?.type === 'MemberExpression' && parent.property === n && !parent.computed) break;
        if (parent?.type === 'Property' && parent.key === n && !parent.computed) break;
        if (parent?.type === 'MethodDefinition' || parent?.type === 'PropertyDefinition') break;
        findings.push(err('blocked-api', `uses ${name}${line(n)}: ${BLOCKED_GLOBALS[name]}`));
        break;
      }
      case 'CallExpression': {
        const callee = n.callee as Node;
        let name: string | undefined;
        if (callee.type === 'Identifier') name = callee.name as string;
        else if (
          callee.type === 'MemberExpression' &&
          (callee.object as Node).type === 'Identifier' &&
          ['window', 'globalThis', 'self'].includes((callee.object as Node).name as string) &&
          !callee.computed
        ) {
          name = (callee.property as Node).name as string;
          if (name === 'open') findings.push(err('blocked-api', `window.open${line(n)}: popups are blocked`));
        }
        if (name && name in BLOCKED_CALLS) findings.push(err('blocked-api', `calls ${name}()${line(n)}: ${BLOCKED_CALLS[name]}`));
        break;
      }
      case 'MemberExpression': {
        const obj = n.object as Node;
        const prop = n.property as Node;
        if (obj.type === 'Identifier' && obj.name === 'document' && !n.computed && prop.name === 'cookie') {
          findings.push(err('blocked-api', `document.cookie${line(n)}: storage throws in the sandbox`));
        }
        break;
      }
      case 'AssignmentExpression': {
        const left = n.left as Node;
        const isLocation =
          (left.type === 'Identifier' && left.name === 'location') ||
          (left.type === 'MemberExpression' &&
            (((left.object as Node).type === 'Identifier' && (left.object as Node).name === 'location') ||
              ((left.property as Node).type === 'Identifier' && (left.property as Node).name === 'location')));
        if (isLocation) findings.push(err('blocked-api', `assigns to location${line(n)}: navigation kills the component`));
        break;
      }
    }
  });

  if (!exportsMount) findings.push(err('no-mount-export', 'module must `export function mount(root, ctx)`'));
  for (const spec of new Set(imports)) {
    if (!allowed.has(spec)) {
      const hint = spec.startsWith('three/examples/') ? ` (use '${spec.replace('three/examples/jsm/', 'three/addons/')}')` : '';
      findings.push(err('import-not-allowed', `imports '${spec}', which the host does not provide${hint}`));
    }
  }
  if (/<form[\s>]/i.test(source)) findings.push(warn('form-element', 'uses a <form>; submission is blocked in the sandbox, use buttons'));
  return { info: { imports, exportsMount }, findings };
}

function checkStep(s: ReviewStep, i: number, which: string): string | null {
  const at = `${which}[${i}]`;
  const frac = (v: number | null) => typeof v === 'number' && v >= 0 && v <= 1;
  switch (s.action) {
    case 'click':
      return s.selector ? null : `${at}: click needs a selector`;
    case 'fill':
      return s.selector && s.value !== null ? null : `${at}: fill needs selector and value`;
    case 'clickAt':
      return frac(s.x) && frac(s.y) ? null : `${at}: clickAt needs x, y in [0,1]`;
    case 'drag':
      return frac(s.x) && frac(s.y) && frac(s.x2) && frac(s.y2) ? null : `${at}: drag needs x, y, x2, y2 in [0,1]`;
    case 'press':
      return s.value ? null : `${at}: press needs a key in value`;
    case 'wait':
      return s.value && Number(s.value) >= 0 && Number(s.value) <= 5000 ? null : `${at}: wait needs value 0..5000 (ms)`;
    default:
      return `${at}: unknown action ${String((s as { action: unknown }).action)}`;
  }
}

/** All static checks. Returns the candidate (with its manifest) when nothing blocks. */
export function staticCheck(
  kp: KnowledgePoint,
  output: ModelOutput,
  opts: StaticCheckOptions,
): { candidate: Candidate | null; findings: Finding[] } {
  const { info, findings } = analyzeModule(output.source, opts.allowed);
  const libraries = [...new Set((info?.imports ?? []).map((s) => opts.allowed.get(s)).filter((x): x is LibraryId => !!x))];
  const manifest = buildManifest(kp, output.title, opts.modes, libraries);
  const v = validateManifest(manifest);
  if (!v.ok) findings.push(err('manifest-invalid', v.error));

  if (opts.modes.includes('review')) {
    if (!/submitResult/.test(output.source)) findings.push(err('no-submit-result', 'review mode is requested but the module never calls ctx.submitResult'));
    const rt = output.reviewTest;
    if (!rt || !Array.isArray(rt.correct) || !Array.isArray(rt.incorrect) || rt.correct.length === 0 || rt.incorrect.length === 0) {
      findings.push(err('review-test-missing', 'reviewTest must give non-empty `correct` and `incorrect` step lists'));
    } else {
      const problems = [
        ...rt.correct.map((s, i) => checkStep(s, i, 'correct')),
        ...rt.incorrect.map((s, i) => checkStep(s, i, 'incorrect')),
      ].filter((x): x is string => !!x);
      for (const p of problems) findings.push(err('review-test-invalid', p));
    }
  }
  if (!/\bmode\b/.test(output.source)) findings.push(warn('ignores-mode', 'the module never reads ctx.mode'));

  const blocking = findings.some((f) => f.severity === 'error');
  return {
    candidate: blocking || !v.ok ? null : { manifest: v.value, source: output.source, design: output.design, reviewTest: output.reviewTest },
    findings,
  };
}
