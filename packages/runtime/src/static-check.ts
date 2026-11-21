/**
 * Static validation for sandboxed Wengu visual components.
 *
 * Parses the ES module with Acorn (browser- and Node-safe), verifies that it exports `mount`,
 * rejects network/storage/navigation APIs blocked by the sandbox, and infers required library ids
 * from static import specifiers.
 */

import * as acorn from 'acorn';
import { MAX_SOURCE_LENGTH, type LibraryId } from './manifest.ts';

type AstNode = acorn.Node & Record<string, unknown>;

export interface StaticFinding {
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

export interface StaticCheckOptions {
  /** Allowed bare specifiers mapped to their library bundle id or `'builtin'`. */
  allowedSpecifiers?: ReadonlyMap<string, LibraryId | 'builtin'>;
  /** Warn when a module appears to ignore `ctx.phase` / `ctx.onPhaseChange`. Defaults to `true`. */
  checkTwoPhase?: boolean;
}

export interface StaticCheckResult {
  ok: boolean;
  imports: string[];
  inferredLibraries: LibraryId[];
  findings: StaticFinding[];
}

const DEFAULT_THREE_ADDONS = [
  'three/addons/controls/OrbitControls.js',
  'three/addons/controls/TrackballControls.js',
  'three/addons/controls/DragControls.js',
  'three/addons/controls/TransformControls.js',
  'three/addons/renderers/CSS2DRenderer.js',
  'three/addons/renderers/CSS3DRenderer.js',
  'three/addons/environments/RoomEnvironment.js',
  'three/addons/geometries/RoundedBoxGeometry.js',
  'three/addons/geometries/ConvexGeometry.js',
  'three/addons/geometries/ParametricGeometry.js',
  'three/addons/utils/BufferGeometryUtils.js',
  'three/addons/lines/Line2.js',
  'three/addons/lines/LineMaterial.js',
  'three/addons/lines/LineGeometry.js',
  'three/addons/postprocessing/EffectComposer.js',
  'three/addons/postprocessing/RenderPass.js',
  'three/addons/postprocessing/UnrealBloomPass.js',
  'three/addons/postprocessing/OutputPass.js',
  'three/addons/postprocessing/Pass.js',
  'three/addons/postprocessing/ShaderPass.js',
  'three/addons/shaders/CopyShader.js',
] as const;

export const DEFAULT_ALLOWED_SPECIFIERS: ReadonlyMap<string, LibraryId | 'builtin'> = new Map<
  string,
  LibraryId | 'builtin'
>([
  ['wengu/card', 'builtin'],
  ['three', 'three'],
  ['wengu/scene3d', 'three'],
  ...DEFAULT_THREE_ADDONS.map((s) => [s, 'three'] as const),
  ['d3', 'd3'],
  ['katex', 'katex'],
]);

const BLOCKED_GLOBALS: Record<string, string> = {
  fetch: 'network requests are blocked in the sandbox',
  XMLHttpRequest: 'network requests are blocked in the sandbox',
  WebSocket: 'network requests are blocked in the sandbox',
  EventSource: 'network requests are blocked in the sandbox',
  RTCPeerConnection: 'WebRTC is disallowed in components',
  localStorage: 'storage throws in the sandbox (opaque origin)',
  sessionStorage: 'storage throws in the sandbox (opaque origin)',
  indexedDB: 'storage throws in the sandbox (opaque origin)',
  importScripts: 'importScripts is unavailable in ES modules',
};

const BLOCKED_CALLS: Record<string, string> = {
  alert: 'modal dialogs are blocked in the sandbox',
  confirm: 'modal dialogs are blocked in the sandbox',
  prompt: 'modal dialogs are blocked in the sandbox',
};

const err = (code: string, message: string): StaticFinding => ({ severity: 'error', code, message });
const warn = (code: string, message: string): StaticFinding => ({ severity: 'warning', code, message });

function walkAst(node: unknown, visit: (n: AstNode, parent: AstNode | null) => void, parent: AstNode | null = null): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) walkAst(child, visit, parent);
    return;
  }
  const n = node as AstNode;
  if (typeof n.type !== 'string') return;
  visit(n, parent);
  for (const key of Object.keys(n)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue;
    walkAst(n[key], visit, n);
  }
}

/** Validates ES module source text without running it in a browser. */
export function checkComponentSource(source: string, opts: StaticCheckOptions = {}): StaticCheckResult {
  const findings: StaticFinding[] = [];
  if (typeof source !== 'string' || !source.trim()) {
    findings.push(err('source-empty', 'component source must be a non-empty string'));
    return { ok: false, imports: [], inferredLibraries: [], findings };
  }
  if (source.length > MAX_SOURCE_LENGTH) {
    findings.push(err('source-too-large', `source is ${source.length} chars, max ${MAX_SOURCE_LENGTH}`));
  }

  let ast: acorn.Program;
  try {
    ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  } catch (e) {
    findings.push(err('syntax-error', `module does not parse: ${(e as Error).message}`));
    return { ok: false, imports: [], inferredLibraries: [], findings };
  }

  const usingDefault = !opts.allowedSpecifiers;
  const allowed = opts.allowedSpecifiers ?? DEFAULT_ALLOWED_SPECIFIERS;
  const imports: string[] = [];
  let exportsMount = false;
  const line = (n: AstNode) => (n.loc ? ` (line ${n.loc.start.line})` : '');

  walkAst(ast, (n, parent) => {
    switch (n.type) {
      case 'ImportDeclaration':
      case 'ExportAllDeclaration':
      case 'ExportNamedDeclaration': {
        const src = n.source as { value?: unknown } | null | undefined;
        if (src && typeof src.value === 'string') imports.push(src.value);
        if (n.type === 'ExportNamedDeclaration') {
          const decl = n.declaration as AstNode | null;
          if (decl?.type === 'FunctionDeclaration' && (decl.id as { name?: string } | null)?.name === 'mount') {
            exportsMount = true;
          }
          if (decl?.type === 'VariableDeclaration') {
            for (const d of decl.declarations as AstNode[]) {
              if ((d.id as { name?: string }).name === 'mount') exportsMount = true;
            }
          }
          for (const s of (n.specifiers as AstNode[]) ?? []) {
            const ex = s.exported as { name?: string; value?: string };
            if ((ex.name ?? ex.value) === 'mount' && !src) exportsMount = true;
          }
        }
        break;
      }
      case 'ImportExpression': {
        const s = n.source as AstNode;
        if (s.type === 'Literal' && typeof s.value === 'string') {
          imports.push(s.value);
        } else {
          findings.push(
            err('dynamic-import', `dynamic import() with a computed specifier${line(n)}; only static, allowed specifiers work`),
          );
        }
        break;
      }
      case 'Identifier': {
        const name = n.name as string;
        if (!(name in BLOCKED_GLOBALS)) break;
        if (parent?.type === 'MemberExpression' && parent.property === n && !parent.computed) break;
        if (parent?.type === 'Property' && parent.key === n && !parent.computed) break;
        if (parent?.type === 'MethodDefinition' || parent?.type === 'PropertyDefinition') break;
        findings.push(err('blocked-api', `uses ${name}${line(n)}: ${BLOCKED_GLOBALS[name]}`));
        break;
      }
      case 'CallExpression': {
        const callee = n.callee as AstNode;
        let name: string | undefined;
        if (callee.type === 'Identifier') {
          name = callee.name as string;
        } else if (
          callee.type === 'MemberExpression' &&
          (callee.object as AstNode).type === 'Identifier' &&
          ['window', 'globalThis', 'self'].includes((callee.object as AstNode).name as string) &&
          !callee.computed
        ) {
          name = (callee.property as AstNode).name as string;
          if (name === 'open') findings.push(err('blocked-api', `window.open${line(n)}: popups are blocked`));
        }
        if (name && name in BLOCKED_CALLS) {
          findings.push(err('blocked-api', `calls ${name}()${line(n)}: ${BLOCKED_CALLS[name]}`));
        }
        break;
      }
      case 'MemberExpression': {
        const obj = n.object as AstNode;
        const prop = n.property as AstNode;
        if (obj.type === 'Identifier' && obj.name === 'document' && !n.computed && prop.name === 'cookie') {
          findings.push(err('blocked-api', `document.cookie${line(n)}: storage throws in the sandbox`));
        }
        break;
      }
      case 'AssignmentExpression': {
        const left = n.left as AstNode;
        const isLocation =
          (left.type === 'Identifier' && left.name === 'location') ||
          (left.type === 'MemberExpression' &&
            (((left.object as AstNode).type === 'Identifier' && (left.object as AstNode).name === 'location') ||
              ((left.property as AstNode).type === 'Identifier' && (left.property as AstNode).name === 'location')));
        if (isLocation) {
          findings.push(err('blocked-api', `assigns to location${line(n)}: navigation kills the component`));
        }
        break;
      }
    }
  });

  if (!exportsMount) {
    findings.push(err('no-mount-export', 'module must `export function mount(root, ctx)`'));
  }

  const uniqueImports = [...new Set(imports)];
  const libs = new Set<LibraryId>();
  for (const spec of uniqueImports) {
    const resolved = allowed.get(spec) ?? (usingDefault && spec.startsWith('three/addons/') ? 'three' : undefined);
    if (!resolved) {
      const hint = spec.startsWith('three/examples/')
        ? ` (use '${spec.replace('three/examples/jsm/', 'three/addons/')}')`
        : '';
      findings.push(err('import-not-allowed', `imports '${spec}', which the host does not provide${hint}`));
      continue;
    }
    if (resolved !== 'builtin') libs.add(resolved);
  }

  if (/<form[\s>]/i.test(source)) {
    findings.push(warn('form-element', 'uses a <form>; submission is blocked in the sandbox, use buttons'));
  }
  if (opts.checkTwoPhase !== false && !/\bonPhaseChange\b|\bphase\b/.test(source)) {
    findings.push(
      warn(
        'no-phase-handling',
        'component never references ctx.phase or ctx.onPhaseChange; reveal transitions will not update the canvas in place',
      ),
    );
  }

  const ok = !findings.some((f) => f.severity === 'error');
  return { ok, imports: uniqueImports, inferredLibraries: [...libs], findings };
}
