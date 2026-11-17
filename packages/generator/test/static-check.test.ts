import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { allowedSpecifiers } from '../src/libraries.ts';
import { analyzeModule, manifestId, parseModelOutput, staticCheck } from '../src/static-check.ts';
import type { KnowledgePoint, ModelOutput, ReviewStep } from '../src/types.ts';

const allowed = allowedSpecifiers();
const kp: KnowledgePoint = { id: 'test.angles', title: '角', subject: '数学', content: '...' };
const good = readFileSync(new URL('./fixtures/good.js', import.meta.url), 'utf8');
const click = (selector: string): ReviewStep => ({ action: 'click', selector, x: null, y: null, x2: null, y2: null, value: null });
const out = (source: string, extra: Partial<ModelOutput> = {}): ModelOutput => ({
  title: '角的大小',
  design: 'd',
  source,
  reviewTest: { correct: [click('#opt-a')], incorrect: [click('#opt-b')] },
  ...extra,
});
const codes = (fs: Array<{ code: string }>) => fs.map((f) => f.code);

describe('analyzeModule', () => {
  it('accepts a module with an exported mount and allowed imports', () => {
    const src = `import * as THREE from 'three';\nimport { OrbitControls } from 'three/addons/controls/OrbitControls.js';\nimport * as d3 from 'd3';\nimport katex from 'katex';\nexport async function mount(root, ctx) {}`;
    const r = analyzeModule(src, allowed);
    expect(r.findings).toEqual([]);
    expect(r.info?.imports).toEqual(['three', 'three/addons/controls/OrbitControls.js', 'd3', 'katex']);
  });

  it('accepts `export const mount` and `export { mount }`', () => {
    expect(analyzeModule('export const mount = (root) => {};', allowed).info?.exportsMount).toBe(true);
    expect(analyzeModule('function mount() {}\nexport { mount };', allowed).info?.exportsMount).toBe(true);
  });

  it('reports syntax errors with position', () => {
    const r = analyzeModule('export function mount(root, ctx) {', allowed);
    expect(codes(r.findings)).toEqual(['syntax-error']);
    expect(r.findings[0]!.message).toMatch(/\(1:\d+\)/);
  });

  it('requires a mount export', () => {
    expect(codes(analyzeModule('export function render() {}', allowed).findings)).toEqual(['no-mount-export']);
  });

  it('rejects imports the host does not provide, with a hint for three/examples paths', () => {
    const r = analyzeModule(
      `import x from 'lodash';\nimport { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';\nimport y from 'https://cdn.example/x.js';\nexport function mount() {}`,
      allowed,
    );
    expect(codes(r.findings)).toEqual(['import-not-allowed', 'import-not-allowed', 'import-not-allowed']);
    expect(r.findings[1]!.message).toContain("use 'three/addons/controls/OrbitControls.js'");
  });

  it('rejects computed dynamic imports', () => {
    expect(codes(analyzeModule(`export async function mount() { const m = 'd3'; await import(m); }`, allowed).findings)).toEqual(['dynamic-import']);
  });

  it('flags APIs the sandbox blocks, but not same-named properties', () => {
    const src = `export function mount(root, ctx) {
      fetch('/x'); localStorage.setItem('a', 1); alert('hi'); window.open('x'); document.cookie = 'a'; location.href = 'x';
      const o = { fetch: 1, localStorage: 2 }; o.fetch; o.alert(); ctx.prompt;
    }`;
    const r = analyzeModule(src, allowed);
    expect(codes(r.findings).filter((c) => c === 'blocked-api')).toHaveLength(6);
    expect(r.findings.map((f) => f.message).join('\n')).toMatch(/fetch.*\n.*localStorage.*\n.*alert.*\n.*window\.open.*\n.*document\.cookie.*\n.*location/s);
  });
});

describe('staticCheck', () => {
  it('builds a valid manifest from the imports and the knowledge point', () => {
    const r = staticCheck(kp, out(good), { modes: ['learn', 'review'], allowed });
    expect(r.findings.filter((f) => f.severity === 'error')).toEqual([]);
    expect(r.candidate?.manifest).toEqual({
      id: 'gen.test.angles',
      title: '角的大小',
      apiVersion: 1,
      libraries: [],
      knowledgePoints: ['test.angles'],
      sources: [],
      modes: ['learn', 'review'],
    });
  });

  it('derives libraries from imports', () => {
    const r = staticCheck(kp, out(`import * as d3 from 'd3';\nexport function mount(r, ctx) { ctx.mode; ctx.submitResult }`), { modes: ['learn', 'review'], allowed });
    expect(r.candidate?.manifest.libraries).toEqual(['d3']);
  });

  it('requires submitResult and a review test when review mode is requested', () => {
    const r = staticCheck(kp, out('export function mount(root, ctx) { ctx.mode }', { reviewTest: null }), { modes: ['learn', 'review'], allowed });
    expect(r.candidate).toBeNull();
    expect(codes(r.findings)).toEqual(['no-submit-result', 'review-test-missing']);
  });

  it('does not require them for learn-only components', () => {
    const r = staticCheck(kp, out('export function mount(root, ctx) { ctx.mode }', { reviewTest: null }), { modes: ['learn'], allowed });
    expect(r.candidate).not.toBeNull();
  });

  it('validates review steps', () => {
    const bad: ReviewStep[] = [
      { action: 'clickAt', selector: null, x: 1.5, y: 0.2, x2: null, y2: null, value: null },
      { action: 'fill', selector: '#x', x: null, y: null, x2: null, y2: null, value: null },
    ];
    const r = staticCheck(kp, out(good, { reviewTest: { correct: bad, incorrect: [click('#b')] } }), { modes: ['learn', 'review'], allowed });
    expect(codes(r.findings)).toEqual(['review-test-invalid', 'review-test-invalid']);
  });

  it('makes manifest ids that the runtime accepts', () => {
    expect(manifestId('Physics/Kinematics: Projectile Motion!')).toBe('gen.physics-kinematics-projectile-motion');
    expect(manifestId('a..b--c')).toBe('gen.a-b-c');
  });
});

describe('parseModelOutput', () => {
  it('parses plain and fenced JSON', () => {
    const json = JSON.stringify(out(good));
    expect(parseModelOutput(json).ok).toBe(true);
    expect(parseModelOutput('Here you go:\n```json\n' + json + '\n```').ok).toBe(true);
  });

  it('reports missing source and non-JSON output', () => {
    const a = parseModelOutput(JSON.stringify({ title: 't', design: '', source: '', reviewTest: null }));
    expect(a.ok).toBe(false);
    const b = parseModelOutput('export function mount() {}');
    expect(b.ok ? '' : b.finding.code).toBe('output-invalid');
  });
});
