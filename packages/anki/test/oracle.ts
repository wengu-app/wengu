/**
 * Runs fixtures/reimport.py: imports packages into fresh collections with
 * the official `anki` library (clock frozen with libfaketime) and returns
 * Anki's dump of each.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FIXTURES, type Expected } from "./helpers.js";

const PYTHON = join(FIXTURES, ".venv", "bin", "python");
const FT_CANDIDATES = [
  "/usr/lib/x86_64-linux-gnu/faketime/libfaketime.so.1",
  "/usr/lib/aarch64-linux-gnu/faketime/libfaketime.so.1",
  "/usr/lib/faketime/libfaketime.so.1",
  "/usr/local/lib/faketime/libfaketime.so.1",
  "/opt/homebrew/lib/faketime/libfaketime.1.dylib",
];

/** Why the oracle cannot run here, or null when it can. */
export function oracleUnavailable(): string | null {
  if (!existsSync(PYTHON)) return `no Anki oracle venv at ${PYTHON} (see fixtures/generate.py)`;
  const ft = process.env["LIBFAKETIME"] ?? FT_CANDIDATES.find((c) => existsSync(c));
  if (!ft || !existsSync(ft)) return "libfaketime not found; set LIBFAKETIME=/path/to/libfaketime.so.1 (see fixtures/generate.py)";
  return null;
}

export interface OracleJob {
  /** Package bytes, or a path to an existing package. */
  package: Uint8Array | string;
  /** Import with scheduling and deck presets (Anki's import option). */
  scheduling: boolean;
}

export type RawNote = [number, string, string, number, number, string, string, string | number, number, number, string];
export type RawCard = [number, number, string, number, number, number, number, number, number, number, number, number, number, number, number, string | number, number, string];

export interface OracleDump extends Expected {
  error?: string;
  importLog: Record<string, number>;
  raw: {
    col: { crt: number; ver: number };
    notetypes: Record<string, unknown>[];
    decks: Record<string, unknown>[];
    deckConfigs: Record<string, unknown>[];
    tags: [string, number, number][];
    /** id, guid, notetype name, mod, usn, tags, flds, sfld, csum, flags, data */
    notes: RawNote[];
    /** id, nid, deck name, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, original deck name, flags, data */
    cards: RawCard[];
    revlog: number[][];
    proto: { notetypes: unknown[]; decks: unknown[]; deckConfigs: unknown[] };
  };
}

/** Import every job's package into its own empty collection at unix time `now` and return Anki's dumps. */
export function runOracle(now: number, jobs: OracleJob[]): OracleDump[] {
  const dir = mkdtempSync(join(tmpdir(), "wengu-oracle-"));
  const spec = {
    now,
    jobs: jobs.map((j, i) => {
      let path = typeof j.package === "string" ? j.package : join(dir, `job-${i}.apkg`);
      if (typeof j.package !== "string") writeFileSync(path, j.package);
      return { package: path, scheduling: j.scheduling, out: join(dir, `job-${i}.json`) };
    }),
  };
  const specPath = join(dir, "spec.json");
  writeFileSync(specPath, JSON.stringify(spec));
  const ft = process.env["LIBFAKETIME"] ?? FT_CANDIDATES.find((c) => existsSync(c))!;
  execFileSync(PYTHON, [join(FIXTURES, "reimport.py"), specPath], {
    env: { ...process.env, LIBFAKETIME: ft },
    timeout: 300_000,
    stdio: ["ignore", "pipe", "inherit"],
  });
  return spec.jobs.map((j) => JSON.parse(readFileSync(j.out, "utf8")) as OracleDump);
}
