/**
 * Browser harness (headless Chromium via run.mjs). Modes:
 *  - ?mode=test     — functional checks against the real worker + OPFS (see run.mjs for the multi-page steps)
 *  - ?mode=bench    — the benchmark scenario on a synthetic 50k-note collection, through the worker client
 */
import { connectWengu, replaceMediaReferences } from "../../src/index.js";
import type { WenguClient } from "../../src/index.js";
import { formatRows, runScenario } from "../scenario.js";
import type { BenchApi } from "../scenario.js";
import { syntheticPackage } from "../synthetic.js";

declare global {
  interface Window {
    __result?: unknown;
    __error?: string;
    __log: string[];
  }
}
window.__log = [];
const log = (s: string) => {
  window.__log.push(s);
  console.log(s);
};

async function open(): Promise<{ client: WenguClient; worker: Worker }> {
  const worker = new Worker("./worker.js", { type: "module" });
  const client = await connectWengu(worker);
  return { client, worker };
}

async function step(name: string): Promise<unknown> {
  const out: Record<string, unknown> = { crossOriginIsolated: self.crossOriginIsolated, secure: self.isSecureContext };
  if (name === "wipe") {
    const root = await navigator.storage.getDirectory();
    for await (const [entry] of (root as unknown as { entries(): AsyncIterable<[string, unknown]> }).entries()) await root.removeEntry(entry, { recursive: true });
    return out;
  }
  const t0 = performance.now();
  const { client, worker } = await open();
  out["openMs"] = performance.now() - t0;
  out["info"] = client.opened;
  if (name === "import") {
    const bytes = new Uint8Array(await (await fetch("./fixtures/full-latest.apkg")).arrayBuffer());
    const phases = new Set<string>();
    out["import"] = await client.importAnki(bytes, { onProgress: (p) => phases.add(p.phase) });
    out["phases"] = [...phases];
    const s = await client.study(null);
    out["firstCard"] = s.card ? { id: s.card.item.id, labels: Object.values(s.card.schedule.outcomes).map((o) => o.label) } : null;
    const after = await client.answer({ itemId: s.card!.item.id, rating: 3, takenMs: 2000 });
    out["undoLabel"] = after.undoLabel;
    out["answeredId"] = s.card!.item.id;
    // media: blob from OPFS, usable as an image
    const pres = await client.renderItem(1740819615000);
    const media = await client.getMedia(pres.media);
    const urls = new Map(Object.entries(media).map(([n, b]) => [n, b ? URL.createObjectURL(b) : ""]));
    const html = replaceMediaReferences(pres.question, (n) => urls.get(n));
    const img = new Image();
    img.src = /src="([^"]+)"/.exec(html)![1]!;
    await img.decode();
    out["imageSize"] = [img.naturalWidth, img.naturalHeight];
    out["mediaNames"] = Object.keys(media);
  }
  if (name === "check") {
    out["revlog"] = (await client.info()).counts.reviewLog;
    out["undoLabel"] = await client.undoLabel();
    out["studyCounts"] = (await client.study(null)).counts;
    const media = await client.getMedia(["猫 cat.png"]);
    out["catSize"] = media["猫 cat.png"]?.size ?? null;
  }
  if (name === "undo") {
    out["undo"] = await client.undo();
    out["revlog"] = (await client.info()).counts.reviewLog;
  }
  if (name === "hold") {
    // keep the database open; another page then tries to open it
    (window as unknown as { __client: WenguClient }).__client = client;
    return out;
  }
  await client.close();
  worker.terminate();
  return out;
}

async function bench(): Promise<unknown> {
  const root = await navigator.storage.getDirectory();
  for await (const [entry] of (root as unknown as { entries(): AsyncIterable<[string, unknown]> }).entries()) await root.removeEntry(entry, { recursive: true });
  const { client, worker } = await open();
  const q = new URLSearchParams(location.search);
  // The synthetic collection's "now" is the real now (the worker uses the real clock); ?backlogDays=N makes the
  // collection N days stale, so that a large backlog of overdue reviews is due (stress case).
  const nowSecs = Math.floor(Date.now() / 1000) - Number(q.get("backlogDays") ?? 0) * 86400;
  const pkg = syntheticPackage({ notes: Number(q.get("notes") ?? 50_000), nowSecs });
  const api: BenchApi = {
    importAnki: (p) => {
      const t0 = performance.now();
      let last = "";
      return client.importAnki(p, {
        onProgress: (x) => {
          if (x.phase !== last) log(`import phase ${x.phase} starts at ${(performance.now() - t0).toFixed(0)} ms`);
          last = x.phase;
        },
      });
    },
    deckTree: () => client.deckTree(),
    study: (d) => client.study(d),
    answer: (a) => client.answer(a),
    undo: () => client.undo(),
    search: (q) => client.search(q),
    stats: () => client.stats(),
    exportAnki: () => client.exportAnki(),
    info: () => client.info(),
  };
  const rows = await runScenario(api, pkg, log);
  await client.close();
  worker.terminate();
  // reopen the 50k collection from OPFS
  const t0 = performance.now();
  const again = await open();
  const reopenMs = performance.now() - t0;
  const t1 = performance.now();
  const s = await again.client.study(null);
  const firstStudyMs = performance.now() - t1;
  const est = await navigator.storage.estimate();
  await again.client.close();
  again.worker.terminate();
  return { table: formatRows(rows), rows, reopenMs, firstStudyAfterReopenMs: firstStudyMs, hasCard: !!s.card, storageUsageMB: (est.usage ?? 0) / 1e6, ua: navigator.userAgent, cores: navigator.hardwareConcurrency };
}

const params = new URLSearchParams(location.search);
const mode = params.get("mode");
(mode === "bench" ? bench() : step(params.get("step") ?? "check"))
  .then((r) => (window.__result = r))
  .catch((e: unknown) => (window.__error = e instanceof Error ? `${e.name}: ${e.message}\n${e.stack}` : String(e)));
