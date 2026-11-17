/** Main-thread client: every WenguApi method as an async call into the database worker. */
import type { AnkiPackage } from "@wengu/anki";

import type { CollectionInfo, ImportOptions, ImportResult, WenguApi } from "../types.js";
import type { ApiMethod, OpenOptions, Port, Request, Response } from "./protocol.js";
import { API_METHODS } from "./protocol.js";

type Asyncify<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : never;
};

export type WenguClient = Asyncify<Omit<WenguApi, "importAnki">> & {
  /**
   * Imports an .apkg/.colpkg (bytes; parsed in the worker) or a parsed AnkiPackage. Progress callbacks are
   * delivered while the worker imports.
   */
  importAnki(input: Uint8Array | AnkiPackage, options?: ImportOptions): Promise<ImportResult>;
  /** Info returned when the collection was opened. */
  readonly opened: CollectionInfo;
  /** Closes the database and releases the storage (another tab/window can then open it). */
  close(): Promise<void>;
};

export class WenguError extends Error {
  constructor(name: string, message: string, readonly workerStack?: string) {
    super(message);
    this.name = name;
  }
}

/**
 * Connects to a Wengu database worker and opens the collection.
 *
 *   const worker = new Worker(new URL("./db.worker.ts", import.meta.url), { type: "module" });
 *   const wengu = await connectWengu(worker);
 */
export async function connectWengu(port: Port, options: OpenOptions = {}): Promise<WenguClient> {
  let nextId = 1;
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: unknown): void; progress?: ImportOptions["onProgress"] }>();
  const onMessage = (ev: MessageEvent) => {
    const r = ev.data as Response;
    const p = pending.get(r.id);
    if (!p) return;
    if (r.t === "progress") {
      p.progress?.(r.progress);
      return;
    }
    pending.delete(r.id);
    if (r.t === "result") p.resolve(r.value);
    else p.reject(new WenguError(r.error.name, r.error.message, r.error.stack));
  };
  port.addEventListener("message", onMessage);
  port.start?.();

  type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
  const request = <T>(req: DistributiveOmit<Request, "id">, progress?: ImportOptions["onProgress"]): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject, ...(progress ? { progress } : {}) });
      port.postMessage({ ...req, id } as Request);
    });

  const opened = await request<CollectionInfo>({ t: "open", options });
  const client: Record<string, unknown> = { opened };
  for (const method of API_METHODS) {
    client[method] = (...args: unknown[]) => {
      if (method === "importAnki") {
        const opts = (args[1] ?? {}) as ImportOptions;
        const { onProgress, ...rest } = opts;
        return request({ t: "call", method, args: [args[0], rest], progress: !!onProgress }, onProgress);
      }
      if (method === "search") {
        const { signal, ...opts } = (args[1] ?? {}) as { signal?: AbortSignal; timeoutMs?: number };
        if (signal?.aborted) return Promise.reject(new WenguError("AbortError", "search aborted"));
        const id = nextId;
        const p = request({ t: "call", method, args: [args[0], opts], cancellable: true });
        const abort = () => port.postMessage({ t: "cancel", id: nextId++, target: id } as Request);
        signal?.addEventListener("abort", abort, { once: true });
        return p.finally(() => signal?.removeEventListener("abort", abort));
      }
      return request({ t: "call", method: method as ApiMethod, args });
    };
  }
  client["close"] = async () => {
    await request({ t: "close" });
    port.removeEventListener("message", onMessage);
  };
  return client as unknown as WenguClient;
}
