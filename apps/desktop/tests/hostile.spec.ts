/**
 * Untrusted deck code in the card frame: can it get data out, and can it freeze the app?
 * Prints a table of attempt → what the script saw → what reached the test servers / the DNS resolver.
 */
import { expect, test, type Page } from "@playwright/test";
import { createServer, type IncomingMessage } from "node:http";
import { createServer as createTcpServer, type AddressInfo } from "node:net";
import { createSocket } from "node:dgram";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import { DNS_SUFFIX, hostIp, hostilePackage, type Endpoints } from "./hostile-deck.ts";
import { DESKTOP, importFile, launch, openNote, rawAppPage, SCRATCH, useTestSettings } from "./launch.ts";

interface Hits {
  http: string[];
  tcp: string[];
  udp: string[];
}

async function listeners(ip: string): Promise<{ endpoints: Endpoints; hits: Hits; close(): void }> {
  const hits: Hits = { http: [], tcp: [], udp: [] };
  const http = createServer((req: IncomingMessage, res) => {
    hits.http.push(`${req.method} ${req.url}`);
    res.writeHead(200, { "access-control-allow-origin": "*", "content-type": "text/plain" }).end("ok");
  });
  http.on("upgrade", (req, socket) => {
    hits.http.push(`UPGRADE ${req.url}`);
    socket.destroy();
  });
  http.on("connection", () => hits.tcp.push("http-port connection"));
  await new Promise<void>((r) => http.listen(0, ip, r));
  const tcp = createTcpServer((s) => {
    hits.tcp.push("turn/tcp-candidate port connection");
    s.on("data", (d) => hits.tcp.push(`bytes: ${d.length}`));
    s.on("error", () => {});
    setTimeout(() => s.destroy(), 500);
  });
  await new Promise<void>((r) => tcp.listen(0, ip, r));
  const udp = createSocket("udp4");
  udp.on("message", (m, from) => {
    const s = m.toString("latin1");
    hits.udp.push(`${m.length} bytes from ${from.address}:${from.port}${s.includes("EXFIL") ? " (contains EXFIL ufrag)" : ""}`);
  });
  await new Promise<void>((r) => udp.bind(0, ip, r));
  const endpoints = { ip, http: (http.address() as AddressInfo).port, tcp: (tcp.address() as AddressInfo).port, udp: udp.address().port };
  return {
    endpoints,
    hits,
    close() {
      http.closeAllConnections();
      http.close();
      tcp.close();
      udp.close();
    },
  };
}

const dir = path.join(SCRATCH, "wengu-hostile");
mkdirSync(dir, { recursive: true });

/**
 * Everything network-shaped in a Chromium net log: URL requests started, host lookups, TCP/UDP connects. Deck
 * hostnames (DNS_SUFFIX) appear here only if something tried to resolve or reach them.
 */
export function netLogSummary(file: string): { requests: string[]; lookups: string[]; connects: string[]; deckHostnames: string[] } {
  const empty = { requests: [], lookups: [], connects: [], deckHostnames: [] };
  if (!existsSync(file)) return { ...empty, requests: ["(no net log)"] };
  let text = readFileSync(file, "utf8").trimEnd();
  if (!text.endsWith("}")) text = text.replace(/,$/, "") + "]}";
  let log: { constants: { logEventTypes: Record<string, number> }; events: { type: number; params?: Record<string, unknown> }[] };
  try {
    log = JSON.parse(text);
  } catch {
    return { ...empty, requests: ["(net log not parseable)"] };
  }
  const names = Object.fromEntries(Object.entries(log.constants.logEventTypes).map(([k, v]) => [v, k]));
  const requests = new Set<string>(), lookups = new Set<string>(), connects = new Set<string>(), deck = new Set<string>();
  for (const ev of log.events) {
    const name = names[ev.type] ?? String(ev.type);
    const p = ev.params ?? {};
    if (name === "URL_REQUEST_START_JOB" && typeof p.url === "string") requests.add(p.url);
    if (/^HOST_RESOLVER_MANAGER_(REQUEST|JOB)$/.test(name) && p.host) lookups.add(String(p.host));
    if (/CONNECT_ATTEMPT|^UDP_CONNECT$|^SOCKET_POOL_CONNECTING|^TCP_CONNECT$/.test(name) && (p.address || p.group_name)) connects.add(`${name} ${String(p.address ?? p.group_name)}`);
    const js = JSON.stringify(p);
    if (js.includes(DNS_SUFFIX)) deck.add(`${name}: ${(js.match(new RegExp(`[a-z0-9.-]*${DNS_SUFFIX.replace(/\./g, "\\.")}`)) ?? [""])[0]}`);
  }
  return { requests: [...requests], lookups: [...lookups], connects: [...connects], deckHostnames: [...deck] };
}

async function results(page: Page, testId: string): Promise<Record<string, string>> {
  const raw = await page.frameLocator(`[data-testid="${testId}"]`).locator("html").getAttribute("data-results", { timeout: 15_000 });
  return raw ? (JSON.parse(raw) as Record<string, string>) : {};
}

test("egress: deck code cannot send anything out", async () => {
  const net = await listeners(hostIp());
  const pkg = await hostilePackage("egress", net.endpoints);
  const netlog = path.join(dir, "egress-netlog.json");
  const app = await launch({ args: [`--log-net-log=${netlog}`, "--net-log-capture-mode=Everything"] });
  let seen: Record<string, string> = {};
  try {
    const { page } = app;
    await useTestSettings(page);
    await importFile(page, { name: "hostile-egress.apkg", mimeType: "application/octet-stream", buffer: Buffer.from(pkg.bytes) });
    await openNote(page, "capital", "France");
    const frame = page.frameLocator('[data-testid="preview-frame"]');
    await expect(frame.locator("html")).toHaveAttribute("data-results", /"ran":"yes"/);
    // let ICE gathering, connectivity checks and retries run
    await page.waitForTimeout(12_000);
    seen = await results(page, "preview-frame");
    // the app page itself is unaffected
    expect(page.url()).toMatch(/^wengu:\/\/app\//);
  } finally {
    await app.close();
    net.close();
  }
  const report = { attempts: seen, arrived: net.hits, netLog: netLogSummary(netlog), endpoints: net.endpoints };
  writeFileSync(path.join(dir, "egress-report.json"), JSON.stringify(report, null, 2));
  console.log("EGRESS REPORT", JSON.stringify(report, null, 2));
  expect(net.hits.http).toEqual([]);
  expect(net.hits.udp).toEqual([]);
  expect(net.hits.tcp).toEqual([]);
  expect(report.netLog.deckHostnames).toEqual([]);
  // Allowed: the dead-end proxy, and Chromium's IPv6 reachability probe (a UDP connect() to Google DNS's IPv6
  // address that sends no packet; it only asks the kernel for a route).
  expect(report.netLog.connects.filter((c) => !/127\.0\.0\.1:9\b|UDP_CONNECT \[2001:4860:4860::8888\]:443/.test(c))).toEqual([]);
});

test("navigation: deck code cannot navigate its frame (or the app) anywhere", async () => {
  const net = await listeners(hostIp());
  const pkg = await hostilePackage("nav", net.endpoints);
  const app = await launch();
  const seen: Record<string, string> = {};
  try {
    const { page } = app;
    await useTestSettings(page);
    await importFile(page, { name: "hostile-nav.apkg", mimeType: "application/octet-stream", buffer: Buffer.from(pkg.bytes) });
    for (const n of pkg.notes) {
      await openNote(page, n.text, n.row);
      await page.waitForTimeout(1500);
      const frames = page.frames().map((f) => f.url());
      seen[n.row] = frames.filter((u) => !u.startsWith("wengu://app/index.html")).join(" , ");
      expect(page.url()).toMatch(/^wengu:\/\/app\//);
    }
  } finally {
    await app.close();
    net.close();
  }
  const report = { frameUrlsAfterAttempt: seen, arrived: net.hits };
  writeFileSync(path.join(dir, "nav-report.json"), JSON.stringify(report, null, 2));
  console.log("NAV REPORT", JSON.stringify(report, null, 2));
  expect(net.hits.http).toEqual([]);
});

// Exercise user input before, during and after the 5 s frame recovery timeout.
for (const skipAfterMs of [3000, 5000, 8000]) {
test(`a deck script that never yields: recovery with input after ${skipAfterMs} ms`, async () => {
  const pkg = await hostilePackage("loop", { ip: "127.0.0.1", http: 9, tcp: 9, udp: 9 });
  const app = await launch();
  const timeline: string[] = [];
  const t0 = Date.now();
  const note = (m: string) => timeline.push(`${String(Date.now() - t0).padStart(6)} ms  ${m}`);
  let sawHung = false;
  let sawOopif = false;
  let recovered = false;
  let maxEvalMs = 0;
  let maxRafGapMs = 0;
  let retiredRenderers: string[] = [];
  try {
    await useTestSettings(app.page);
    await importFile(app.page, { name: "hostile-loop.apkg", mimeType: "application/octet-stream", buffer: Buffer.from(pkg.bytes) });
    const cdp = await app.browser.newBrowserCDPSession();
    const renderers = async () =>
      ((await cdp.send("SystemInfo.getProcessInfo")) as { processInfo: { type: string; id: number; cpuTime: number }[] }).processInfo
        .filter((p) => p.type === "renderer")
        .map((p) => `${p.id}(cpu ${p.cpuTime.toFixed(1)}s)`);
    const frameTargets = async () =>
      ((await cdp.send("Target.getTargets")) as { targetInfos: { type: string; url: string }[] }).targetInfos.filter((t) => t.type === "iframe").map((t) => t.url);
    let initialRenderers: string[] | null = null;
    // From here on only a raw CDP connection: Playwright would declare the page crashed when the frame's process dies.
    const page = await rawAppPage(app.wsEndpoint);
    await page.evaluate(`location.hash = "#/review"`);
    let hungSince = 0;
    let answeredHung = false;
    for (let i = 0; i < 60 && !recovered; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const a = Date.now();
      const state = await page.evaluate<{ phase: string | null; shown: string | null }>(
        `({ phase: document.querySelector('[data-testid="review"]')?.getAttribute("data-phase") ?? null, shown: document.querySelector(".review-stage")?.getAttribute("data-shown-side") ?? null })`,
      );
      const evalMs = Date.now() - a;
      const gap = await page.evaluate<number>(
        `new Promise((r) => { let last = performance.now(), max = 0, n = 0; const f = () => { const now = performance.now(); max = Math.max(max, now - last); last = now; if (++n < 20) requestAnimationFrame(f); else r(max); }; requestAnimationFrame(f); })`,
      );
      maxEvalMs = Math.max(maxEvalMs, evalMs);
      maxRafGapMs = Math.max(maxRafGapMs, gap);
      const frames = await frameTargets();
      const processes = await renderers();
      if (!initialRenderers && frames.some((u) => u.includes("card-frame.html"))) initialRenderers = processes.map((p) => p.split("(")[0]!);
      if (frames.some((u) => u.includes("card-frame.html"))) sawOopif = true;
      note(`phase=${state.phase} shown=${state.shown} app eval ${evalMs} ms, max rAF gap ${gap.toFixed(0)} ms, renderers ${processes.join(" ")}, iframe targets ${frames.length}`);
      if (state.phase === "question" && state.shown === null) {
        hungSince ||= Date.now();
        if (Date.now() - hungSince > 2000) sawHung = true;
        // the user gives up on the blank card: reveal and rate it like any other
        if (Date.now() - hungSince > skipAfterMs) {
          note("user presses Space, 3 on the blank card");
          await page.key(" ");
          await new Promise((r) => setTimeout(r, 200));
          await page.key("3");
          answeredHung = true;
          hungSince = 0;
        }
      } else if (state.phase === "answer" && state.shown === null) {
        // the blank card's answer side: rate it again if the first key was swallowed
        hungSince ||= Date.now();
        if (Date.now() - hungSince > 1500) {
          note("user presses 3 on the blank answer");
          await page.key("3");
          hungSince = 0;
        }
      } else if (state.phase === "question" && state.shown === "question" && answeredHung) {
        recovered = true;
        note("a later card is painted in the card frame again");
      } else if (state.phase === "question" && state.shown === "question") {
        await page.key(" ");
      } else if (state.phase === "answer" && state.shown === "answer") {
        await page.key("3");
      }
    }
    const remaining = (await renderers()).map((p) => p.split("(")[0]!);
    retiredRenderers = (initialRenderers ?? []).filter((pid) => !remaining.includes(pid));
    page.close();
  } finally {
    await app.close();
  }
  const shellLog = app.log.join("").split("\n").filter((l) => l.includes("[wengu]"));
  const report = { sawOopif, sawHung, recovered, retiredRenderers, maxAppEvalMs: maxEvalMs, maxAppRafGapMs: Math.round(maxRafGapMs), shellLog, timeline };
  writeFileSync(path.join(dir, "loop-report.json"), JSON.stringify(report, null, 2));
  console.log("LOOP REPORT", JSON.stringify(report, null, 2));
  expect(sawOopif).toBe(true);
  expect(sawHung).toBe(true);
  // Chromium may retire the hung renderer itself when the page removes its iframe, before the shell's probe
  // deadline. Either recovery path is valid, but the busy process must actually be gone (not left consuming CPU).
  expect(retiredRenderers.length).toBeGreaterThan(0);
  expect(recovered).toBe(true);
  expect(maxEvalMs).toBeLessThan(250);
});
}

/**
 * For comparison only (no assertions on egress): the same hostile deck in the web app in plain Chromium, served over
 * http://127.0.0.1. Shows which attempts the web app's own CSP and sandbox already stop, and which needed the shell.
 */
test("baseline: the same deck in the web app in plain Chromium", async () => {
  const { chromium } = await import("@playwright/test");
  const { spawn } = await import("node:child_process");
  const web = path.resolve(DESKTOP, "../web");
  const port = 5195;
  const server = spawn(process.execPath, [path.join(web, "scripts/serve.mjs"), path.join(web, "dist"), String(port), "/wengu/"], { stdio: "ignore" });
  const net = await listeners(hostIp());
  const pkg = await hostilePackage("egress", net.endpoints);
  const netlog = path.join(dir, "baseline-netlog.json");
  const browser = await chromium.launch({ args: [`--log-net-log=${netlog}`, "--net-log-capture-mode=Everything"] });
  let seen: Record<string, string> = {};
  try {
    await new Promise((r) => setTimeout(r, 500));
    const page = await browser.newPage({ viewport: { width: 1200, height: 820 } });
    await page.addInitScript(() => {
      localStorage.setItem("wengu.debug", "1");
      if (!localStorage.getItem("wengu.settings.v1")) localStorage.setItem("wengu.settings.v1", JSON.stringify({ lang: "en", theme: "light" }));
    });
    await page.goto(`http://127.0.0.1:${port}/wengu/`);
    await importFile(page, { name: "hostile-egress.apkg", mimeType: "application/octet-stream", buffer: Buffer.from(pkg.bytes) });
    await openNote(page, "capital", "France");
    await expect(page.frameLocator('[data-testid="preview-frame"]').locator("html")).toHaveAttribute("data-results", /"ran":"yes"/);
    await page.waitForTimeout(12_000);
    seen = await results(page, "preview-frame");
  } finally {
    await browser.close();
    server.kill();
    net.close();
  }
  const report = { attempts: seen, arrived: net.hits, netLog: netLogSummary(netlog), endpoints: net.endpoints };
  writeFileSync(path.join(dir, "baseline-report.json"), JSON.stringify(report, null, 2));
  console.log("BASELINE REPORT", JSON.stringify(report, null, 2));
});
