import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { AnkiPackage } from "@wengu/anki";
import { readAnkiPackage } from "@wengu/anki";

import { ManualClock, openNodeEngine } from "../src/node.js";
import type { NodeEngineOptions } from "../src/node.js";

const here = dirname(fileURLToPath(import.meta.url));
export const ANKI_FIXTURES = join(here, "..", "..", "anki", "fixtures");
export const APKG_FIXTURES = ["full-latest.apkg", "full-legacy.apkg", "shared-latest.apkg", "full-latest.colpkg", "derived-legacy1.apkg"] as const;

export function fixtureBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(ANKI_FIXTURES, "apkg", name)));
}

/** Read with @wengu/anki's default reader (sql.js), independent of the core's SQLite. */
export function readFixture(name: string): Promise<AnkiPackage> {
  return readAnkiPackage(fixtureBytes(name));
}

export function expectedJson<T = Record<string, unknown>>(name: string): T {
  return JSON.parse(readFileSync(join(ANKI_FIXTURES, "expected", name), "utf8")) as T;
}

/** The moment the fixtures were exported (fixtures/expected/source.json `now`), UTC, rollover 4. */
export const FIXTURE_NOW_SECS = 1759834802;

export async function engineAt(unixSecs = FIXTURE_NOW_SECS, opts: NodeEngineOptions = {}) {
  const clock = new ManualClock(unixSecs * 1000, 0);
  const engine = await openNodeEngine({ clock, ...opts });
  return { engine, clock };
}
