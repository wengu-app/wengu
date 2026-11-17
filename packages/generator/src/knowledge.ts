import type { Mode } from '@wengu/runtime';
import type { GenerationInput, KnowledgePoint } from './types.ts';

const MODES: Mode[] = ['learn', 'review'];

/**
 * Validates an input file: either `{ knowledgePoint: {...}, modes: [...] }` or a bare knowledge point with an optional
 * `modes` field. Default modes: learn + review.
 */
export function parseInput(raw: unknown): GenerationInput {
  if (!raw || typeof raw !== 'object') throw new Error('input must be a JSON object');
  const o = raw as Record<string, unknown>;
  const kpRaw = (o.knowledgePoint ?? o) as Record<string, unknown>;
  const str = (k: string) => {
    const v = kpRaw[k];
    if (typeof v !== 'string' || !v.trim()) throw new Error(`knowledge point: "${k}" must be a non-empty string`);
    return v.trim();
  };
  const kp: KnowledgePoint = { id: str('id'), title: str('title'), subject: str('subject'), content: str('content') };
  if (typeof kpRaw.language === 'string') kp.language = kpRaw.language;
  if (Array.isArray(kpRaw.sources)) {
    kp.sources = kpRaw.sources.map((s, i) => {
      if (!s || typeof s !== 'object' || typeof (s as { title?: unknown }).title !== 'string') throw new Error(`sources[${i}].title missing`);
      const r = s as { title: string; url?: unknown; locator?: unknown };
      return { title: r.title, ...(typeof r.url === 'string' ? { url: r.url } : {}), ...(typeof r.locator === 'string' ? { locator: r.locator } : {}) };
    });
  }
  const modesRaw = o.modes ?? kpRaw.modes ?? MODES;
  if (!Array.isArray(modesRaw) || modesRaw.length === 0 || !modesRaw.every((m) => MODES.includes(m as Mode))) {
    throw new Error('modes must be a non-empty array of "learn" / "review"');
  }
  return { knowledgePoint: kp, modes: [...new Set(modesRaw as Mode[])] };
}
