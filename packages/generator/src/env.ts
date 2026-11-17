import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Loads variables from the nearest .env (searching up from `start`) into process.env, without overriding values that
 * are already set. Values are never printed.
 */
export function loadDotEnv(start = process.cwd()): string | null {
  let dir = path.resolve(start);
  for (;;) {
    const f = path.join(dir, '.env');
    if (existsSync(f)) {
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
        if (!m) continue;
        const key = m[1]!;
        let value = m[2]!.trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
        if (process.env[key] === undefined) process.env[key] = value;
      }
      return f;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
