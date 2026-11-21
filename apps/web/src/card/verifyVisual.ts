import type { VisualLibraryId } from "@wengu/core";
import {
  checkComponentSource,
  ComponentHost,
  validateManifest,
  type ComponentManifest,
  type HostEvent,
  type JsonObject,
  type LibraryBundle,
  type LibraryId,
  type StaticFinding,
} from "@wengu/runtime";

import { visualThemeFor } from "./VisualCard.tsx";
import { loadVisualLibraries, visualFrameUrl } from "./visualLibs.ts";

export interface VisualVerifyInput {
  manifest: ComponentManifest;
  source: string;
  props: JsonObject;
}

export interface VisualVerifyIssue {
  stage: "static" | "sandbox";
  code: string;
  message: string;
  stack?: string;
}

export interface VisualVerifyResult {
  ok: boolean;
  inferredLibraries: VisualLibraryId[];
  errors: VisualVerifyIssue[];
  warnings: StaticFinding[];
  metrics?: { mountMs: number; totalMs: number; height: number };
}

export type VisualVerifier = (input: VisualVerifyInput) => Promise<VisualVerifyResult>;

const BUNDLED_LIBRARIES = new Set<VisualLibraryId>(["three"]);
const OVERALL_TIMEOUT_MS = 10_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function collectStaticIssues(findings: readonly StaticFinding[]): {
  errors: VisualVerifyIssue[];
  warnings: StaticFinding[];
} {
  const errors: VisualVerifyIssue[] = [];
  const warnings: StaticFinding[] = [];
  for (const f of findings) {
    if (f.severity === "error") errors.push({ stage: "static", code: f.code, message: f.message });
    else warnings.push(f);
  }
  return { errors, warnings };
}

/**
 * Validates visual card source statically against the sandbox import whitelist and, when running in
 * a browser/Electron renderer, mounts it offscreen in a real sandboxed iframe through both
 * `'question'` and `'reveal'` phases to catch runtime, CSP, empty-render, or freeze errors.
 */
export async function verifyVisualCard(input: VisualVerifyInput): Promise<VisualVerifyResult> {
  const firstPass = checkComponentSource(input.source, { checkTwoPhase: true });
  const inferredLibraries = [
    ...new Set([...input.manifest.libraries, ...firstPass.inferredLibraries]),
  ] as VisualLibraryId[];

  const unbundled = inferredLibraries.filter((lib) => !BUNDLED_LIBRARIES.has(lib));
  if (unbundled.length > 0) {
    const { errors, warnings } = collectStaticIssues(firstPass.findings);
    for (const lib of unbundled) {
      errors.push({
        stage: "static",
        code: "library-not-available",
        message: `Visual library "${lib}" is not bundled in this Wengu build (available: three)`,
      });
    }
    return { ok: false, inferredLibraries, errors, warnings };
  }

  let bundles: Record<string, LibraryBundle> = {};
  if (inferredLibraries.length > 0 && typeof fetch !== "undefined") {
    try {
      bundles = await loadVisualLibraries(inferredLibraries);
    } catch (err) {
      return {
        ok: false,
        inferredLibraries,
        errors: [
          {
            stage: "static",
            code: "library-load-failed",
            message: err instanceof Error ? err.message : String(err),
          },
        ],
        warnings: collectStaticIssues(firstPass.findings).warnings,
      };
    }
  }

  let exactPass = firstPass;
  if (Object.keys(bundles).length > 0) {
    const allowed = new Map<string, LibraryId | "builtin">([["wengu/card", "builtin"]]);
    for (const [libId, bundle] of Object.entries(bundles)) {
      for (const spec of Object.keys(bundle.modules)) {
        allowed.set(spec, libId as LibraryId);
      }
    }
    exactPass = checkComponentSource(input.source, { allowedSpecifiers: allowed, checkTwoPhase: true });
  }

  const { errors, warnings } = collectStaticIssues(exactPass.findings);
  const manifestCheck = validateManifest({ ...input.manifest, libraries: inferredLibraries });
  if (!manifestCheck.ok) {
    errors.push({ stage: "static", code: "manifest-invalid", message: manifestCheck.error });
  }
  if (errors.length > 0 || !manifestCheck.ok) {
    return { ok: false, inferredLibraries, errors, warnings };
  }

  if (typeof document === "undefined") {
    return { ok: true, inferredLibraries, errors: [], warnings };
  }

  const container = document.createElement("div");
  container.setAttribute("aria-hidden", "true");
  // Keep inside the viewport at opacity:0 so Chromium's OOPIF compositor does not throttle rAF/ResizeObserver.
  container.style.cssText =
    "position:fixed;left:0;top:0;width:760px;opacity:0;pointer-events:none;z-index:-1;";
  document.body.append(container);

  const sandboxErrors: VisualVerifyIssue[] = [];
  let host: ComponentHost | null = null;
  let mountMs = 0;
  let totalMs = 0;
  let observedHeight: number | null = null;
  let aborted = false;
  let resolveReady!: () => void;
  let resolvePositiveHeight!: () => void;
  let rejectFatal!: () => void;

  const readyPromise = new Promise<void>((res, rej) => {
    resolveReady = res;
    rejectFatal = rej;
  });
  const heightPromise = new Promise<void>((res) => {
    resolvePositiveHeight = res;
  });
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    host = new ComponentHost({
      container,
      component: { manifest: manifestCheck.value, source: input.source },
      libraries: bundles,
      props: input.props,
      theme: visualThemeFor(false),
      mode: "review",
      phase: "question",
      delivery: { kind: "url", url: visualFrameUrl() },
      hostCspCheck: "off",
      watchdog: { intervalMs: 500, timeoutMs: 8_000 },
      onEvent(ev: HostEvent) {
        switch (ev.type) {
          case "ready":
            mountMs = Math.round(ev.mountMs);
            totalMs = Math.round(ev.totalMs);
            resolveReady();
            break;
          case "resize":
            observedHeight = ev.height;
            if (ev.height > 0) resolvePositiveHeight();
            break;
          case "error":
            sandboxErrors.push({
              stage: "sandbox",
              code: `${ev.phase}-error`,
              message: ev.message,
              ...(ev.stack ? { stack: ev.stack } : {}),
            });
            if (ev.phase === "load" || ev.phase === "mount") rejectFatal();
            break;
          case "killed":
            sandboxErrors.push({
              stage: "sandbox",
              code: `killed-${ev.reason}`,
              message: ev.detail || `component killed (${ev.reason})`,
            });
            rejectFatal();
            break;
          case "violation":
            sandboxErrors.push({
              stage: "sandbox",
              code: "protocol-violation",
              message: ev.reason,
            });
            break;
        }
      },
    });

    const timeout = new Promise<void>((res) => {
      timeoutId = setTimeout(() => {
        aborted = true;
        if (sandboxErrors.length === 0) {
          sandboxErrors.push({
            stage: "sandbox",
            code: "timeout",
            message: `component did not become ready within ${OVERALL_TIMEOUT_MS} ms`,
          });
        }
        res();
      }, OVERALL_TIMEOUT_MS);
    });

    await Promise.race([readyPromise, timeout]).catch(() => {
      aborted = true;
    });
    clearTimeout(timeoutId);

    if (!aborted && sandboxErrors.length === 0) {
      if ((observedHeight ?? 0) <= 0) {
        let heightTimerId: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          heightPromise,
          new Promise<void>((res) => {
            heightTimerId = setTimeout(res, 1_500);
          }),
        ]);
        clearTimeout(heightTimerId);
      }
      if ((observedHeight ?? 0) <= 0) {
        sandboxErrors.push({
          stage: "sandbox",
          code: "empty-render",
          message: "component rendered zero content height after mount",
        });
      } else {
        host.setPhase("reveal");
        await sleep(200);
      }
    }

    return {
      ok: sandboxErrors.length === 0,
      inferredLibraries,
      errors: sandboxErrors,
      warnings,
      ...(sandboxErrors.length === 0
        ? { metrics: { mountMs, totalMs, height: observedHeight ?? 0 } }
        : {}),
    };
  } finally {
    clearTimeout(timeoutId);
    host?.destroy();
    container.remove();
  }
}
