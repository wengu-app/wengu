import { isPlainObject } from './json.ts';

/** Component API versions this runtime can mount. Bump when ComponentContext changes incompatibly. */
export const SUPPORTED_API_VERSIONS = [1] as const;
export type ApiVersion = (typeof SUPPORTED_API_VERSIONS)[number];

/** Libraries the host can preload into the sandbox. A component lists the ones it imports. */
export type LibraryId = 'three' | 'd3' | 'katex';

export interface SourceReference {
  /** Human-readable citation, e.g. "Atkins, Physical Chemistry, 11e, §9.2". */
  title: string;
  url?: string;
  /** Free-form locator: page, section, timestamp. */
  locator?: string;
}

/**
 * Metadata stored alongside the component's source text.
 * Everything here is data; nothing is executed.
 */
export interface ComponentManifest {
  /** Stable id, lowercase, dot/dash separated, e.g. "chem.molecule-viewer". */
  id: string;
  title: string;
  /** Version of the ComponentContext contract the module was written against. */
  apiVersion: ApiVersion;
  /** Libraries the module imports. Only these are injected into the frame. */
  libraries: LibraryId[];
  /** Knowledge-point ids this component presents. */
  knowledgePoints: string[];
  /** Where the content comes from (principle: generated content must be traceable). */
  sources: SourceReference[];
  /** Modes the component implements. A component without `review` is learn-only. */
  modes: Array<'learn' | 'review'>;
}

/** A component as stored: manifest + ES module source text. */
export interface ComponentPackage {
  manifest: ComponentManifest;
  /** ES module source. Must `export function mount(root, ctx)`. May import only the declared libraries. */
  source: string;
}

const ID_RE = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const LIBRARY_IDS: readonly LibraryId[] = ['three', 'd3', 'katex'];

export const MAX_SOURCE_LENGTH = 512 * 1024;

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Validates a manifest from untrusted storage (e.g. shared by another user). Returns a normalised copy. */
export function validateManifest(input: unknown): ValidationResult<ComponentManifest> {
  if (!isPlainObject(input)) return { ok: false, error: 'manifest must be an object' };
  const { id, title, apiVersion, libraries, knowledgePoints, sources, modes } = input;
  if (typeof id !== 'string' || id.length > 128 || !ID_RE.test(id)) return { ok: false, error: 'manifest.id invalid' };
  if (typeof title !== 'string' || title.length === 0 || title.length > 200) return { ok: false, error: 'manifest.title invalid' };
  if (!SUPPORTED_API_VERSIONS.includes(apiVersion as ApiVersion)) {
    return { ok: false, error: `manifest.apiVersion ${String(apiVersion)} not supported (supported: ${SUPPORTED_API_VERSIONS.join(', ')})` };
  }
  if (!Array.isArray(libraries) || !libraries.every((l) => LIBRARY_IDS.includes(l as LibraryId))) {
    return { ok: false, error: 'manifest.libraries invalid' };
  }
  if (!Array.isArray(knowledgePoints) || !knowledgePoints.every((k) => typeof k === 'string' && k.length <= 200)) {
    return { ok: false, error: 'manifest.knowledgePoints invalid' };
  }
  if (!Array.isArray(sources)) return { ok: false, error: 'manifest.sources invalid' };
  const cleanSources: SourceReference[] = [];
  for (const s of sources) {
    if (!isPlainObject(s) || typeof s.title !== 'string') return { ok: false, error: 'manifest.sources entry invalid' };
    const ref: SourceReference = { title: s.title.slice(0, 500) };
    if (typeof s.url === 'string') ref.url = s.url.slice(0, 2000);
    if (typeof s.locator === 'string') ref.locator = s.locator.slice(0, 200);
    cleanSources.push(ref);
  }
  const cleanModes = Array.isArray(modes) ? modes.filter((m): m is 'learn' | 'review' => m === 'learn' || m === 'review') : [];
  if (cleanModes.length === 0) return { ok: false, error: 'manifest.modes invalid' };
  return {
    ok: true,
    value: {
      id,
      title,
      apiVersion: apiVersion as ApiVersion,
      libraries: [...new Set(libraries as LibraryId[])],
      knowledgePoints: [...(knowledgePoints as string[])],
      sources: cleanSources,
      modes: [...new Set(cleanModes)],
    },
  };
}

export function validatePackage(input: unknown): ValidationResult<ComponentPackage> {
  if (!isPlainObject(input)) return { ok: false, error: 'package must be an object' };
  const m = validateManifest(input.manifest);
  if (!m.ok) return m;
  if (typeof input.source !== 'string' || input.source.length === 0 || input.source.length > MAX_SOURCE_LENGTH) {
    return { ok: false, error: 'source must be a non-empty string' };
  }
  return { ok: true, value: { manifest: m.value, source: input.source } };
}
