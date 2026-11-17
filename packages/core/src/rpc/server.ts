/** Worker-side dispatcher: runs requests against an engine, one at a time, in arrival order. */
import type { AnkiPackage } from "@wengu/anki";

import type { Engine } from "../engine/engine.js";
import type { ImportOptions } from "../types.js";
import type { OpenOptions, Port, Request, Response, SerializedError } from "./protocol.js";
import { API_METHODS } from "./protocol.js";

export interface ServeOptions {
  /** Opens the engine on the first "open" request. */
  open(options: OpenOptions): Promise<Engine>;
  /** Releases storage on "close". */
  close?(engine: Engine): Promise<void>;
}

const METHODS = new Set<string>(API_METHODS);

function serializeError(e: unknown): SerializedError {
  if (e instanceof Error) return { name: e.name, message: e.message, ...(e.stack ? { stack: e.stack } : {}) };
  return { name: "Error", message: String(e) };
}

/** Buffers of large binary results, transferred instead of copied. */
function transferables(value: unknown): Transferable[] {
  if (value instanceof Uint8Array && value.buffer instanceof ArrayBuffer) return [value.buffer];
  const pkg = value as Partial<AnkiPackage> | null;
  if (pkg && Array.isArray(pkg.media) && Array.isArray(pkg.notes)) {
    const seen = new Set<ArrayBufferLike>();
    for (const m of pkg.media) if (m.data.byteLength) seen.add(m.data.buffer);
    return [...seen].filter((b): b is ArrayBuffer => b instanceof ArrayBuffer);
  }
  return [];
}

export function serve(port: Port, options: ServeOptions): void {
  let engine: Engine | null = null;
  let queue: Promise<void> = Promise.resolve();
  const send = (r: Response, transfer: Transferable[] = []) => port.postMessage(r, transfer);

  const cancelled = new Set<number>();
  const cancellable = new Set<number>();
  /** Lets queued "cancel" messages arrive before the next request runs (a long query blocks message delivery). */
  const yieldToMessages = () =>
    new Promise<void>((resolve) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => {
        ch.port1.close();
        ch.port2.close();
        resolve();
      };
      ch.port2.postMessage(null);
    });

  const handle = async (req: Request): Promise<void> => {
    if (req.t === "cancel") return;
    try {
      if (req.t === "call" && req.cancellable) {
        await yieldToMessages();
        if (cancelled.delete(req.id)) {
          const e = new Error("search abandoned before it ran");
          e.name = "AbortError";
          throw e;
        }
      }
      if (req.t === "open") {
        if (!engine) engine = await options.open(req.options);
        send({ t: "result", id: req.id, value: engine.info() });
        return;
      }
      if (req.t === "close") {
        if (engine) {
          const e = engine;
          engine = null;
          await options.close?.(e);
        }
        send({ t: "result", id: req.id, value: null });
        return;
      }
      if (!engine) throw new Error("collection is not open");
      if (!METHODS.has(req.method)) throw new Error(`unknown method ${req.method}`);
      const args = [...req.args];
      if (req.method === "importAnki") {
        const opts: ImportOptions = { ...((args[1] as ImportOptions | undefined) ?? {}) };
        if (req.progress) opts.onProgress = (progress) => send({ t: "progress", id: req.id, progress });
        args[1] = opts;
      }
      const fn = (engine as unknown as Record<string, (...a: unknown[]) => unknown>)[req.method]!;
      const value = await fn.apply(engine, args);
      send({ t: "result", id: req.id, value }, transferables(value));
    } catch (e) {
      send({ t: "error", id: req.id, error: serializeError(e) });
    } finally {
      cancellable.delete(req.id);
      cancelled.delete(req.id);
    }
  };

  port.addEventListener("message", (ev: MessageEvent) => {
    const req = ev.data as Request;
    if (req.t === "cancel") {
      if (cancellable.has(req.target)) cancelled.add(req.target);
      return;
    }
    if (req.t === "call" && req.cancellable) cancellable.add(req.id);
    queue = queue.then(() => handle(req));
  });
  port.start?.();
}
