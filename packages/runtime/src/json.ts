/** JSON-compatible values: the only data that crosses the host/component boundary as props or result detail. */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/**
 * Validates that `value` is plain JSON data and copies it.
 * Rejects functions, class instances, cycles, non-finite numbers, and anything deeper or larger than the limits.
 */
export function cloneJson(
  value: unknown,
  limits: { maxDepth?: number; maxNodes?: number; maxStringLength?: number } = {},
): JsonValue | undefined {
  const maxDepth = limits.maxDepth ?? 32;
  const maxNodes = limits.maxNodes ?? 10_000;
  const maxStringLength = limits.maxStringLength ?? 100_000;
  let nodes = 0;

  const walk = (v: unknown, depth: number): JsonValue | undefined => {
    if (++nodes > maxNodes || depth > maxDepth) return undefined;
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
    if (typeof v === 'string') return v.length <= maxStringLength ? v : undefined;
    if (Array.isArray(v)) {
      const out: JsonValue[] = [];
      for (const item of v) {
        const c = walk(item, depth + 1);
        if (c === undefined) return undefined;
        out.push(c);
      }
      return out;
    }
    if (isPlainObject(v)) {
      const out: JsonObject = {};
      for (const key of Object.keys(v)) {
        const c = walk(v[key], depth + 1);
        if (c === undefined) return undefined;
        out[key] = c;
      }
      return out;
    }
    return undefined;
  };
  return walk(value, 0);
}
