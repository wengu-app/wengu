// Channels that CSP does not govern: WebRTC (ICE to STUN/TURN servers) and DNS prefetch/preconnect.
// These tests launch their own browser so they can vary Chromium flags and capture a net-log.
import { test, expect, chromium } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CHROMIUM_ARGS } from '../playwright.config.ts';
import { startEvilServers, type EvilServers } from './servers.ts';
import { componentFrame, mount, waitForStatus } from './helpers.ts';

let evil: EvilServers;
test.beforeAll(async () => {
  evil = await startEvilServers();
});
test.afterAll(async () => evil.close());
test.beforeEach(() => evil.reset());

const out: Record<string, unknown> = {};
test.afterAll(() => {
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/webrtc-dns.json', JSON.stringify(out, null, 2));
});

async function runBattery(extraArgs: string[], netLog?: string, delivery: 'srcdoc' | 'url-cross-site' = 'url-cross-site') {
  const browser = await chromium.launch({ channel: 'chromium', args: [...CHROMIUM_ARGS, ...extraArgs, ...(netLog ? [`--log-net-log=${netLog}`, '--net-log-capture-mode=Everything'] : [])] });
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/harness.html');
  await mount(page, { component: 'hostile', delivery, props: { attack: 'battery', evil: evil.evil, pre: evil.pre, udp: evil.udpPort, tcp: evil.tcpPort } });
  if (netLog) {
    // Positive control for the net-log: a DNS prefetch from the (unsandboxed) host page.
    await page.evaluate(() => {
      const l = document.createElement('link');
      l.rel = 'dns-prefetch';
      l.href = '//control.dns.wengu-test';
      document.head.append(l);
    });
  }
  await waitForStatus(page, 'ready');
  await expect(componentFrame(page).locator('#report[data-done="1"]')).toBeAttached({ timeout: 30_000 });
  const report = JSON.parse(await componentFrame(page).locator('#report').innerText()) as Record<string, string>;
  await page.waitForTimeout(1000);
  await browser.close();
  const packets = evil.udpPackets();
  return {
    webrtc: report.webrtc,
    httpHits: evil.names(),
    udpPackets: packets.length,
    turnUsernameLeaked: packets.some((p) => p.includes(Buffer.from('S3CR3T'))),
    preconnectTcp: evil.preConnections(),
    turnTcpConnections: evil.tcpConnections(),
  };
}

test('KNOWN GAP: WebRTC sends STUN/TURN packets despite the CSP, and the TURN username carries data out', async () => {
  const r = await runBattery([]);
  out.default = r;
  expect(r.httpHits).toEqual([]);
  expect(r.udpPackets).toBeGreaterThan(0);
  expect(r.turnUsernameLeaked).toBe(true);
});

test('KNOWN GAP: TURN over TCP also connects out', async () => {
  const r = await runBattery([]);
  expect(r.turnTcpConnections).toBeGreaterThan(0);
});

test('KNOWN GAP: mitigation candidate --force-webrtc-ip-handling-policy=disable_non_proxied_udp', async () => {
  const r = await runBattery(['--force-webrtc-ip-handling-policy=disable_non_proxied_udp']);
  out.disableNonProxiedUdp = r;
  // Measured: in the headless shell this flag stops UDP, in full Chromium (this config) it does not. TURN over TCP
  // connects directly either way. So the flag is not a fix.
  expect(r.turnTcpConnections).toBeGreaterThan(0);
  test.info().annotations.push({ type: 'result', description: JSON.stringify(r) });
});

test('preconnect: inconclusive here (records sandbox vs host-page TCP connections)', async () => {
  const r = await runBattery([]);
  out.preconnect = r;
  expect(r.preconnectTcp).toBe(0);
  // Control: an unsandboxed page doing the same preconnect. Measured 0 as well in this environment, so the 0 above
  // proves nothing.: an unsandboxed page doing the same preconnect.
  const browser = await chromium.launch({ channel: 'chromium', args: CHROMIUM_ARGS });
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/harness.html');
  await page.evaluate((href) => {
    const l = document.createElement('link');
    l.rel = 'preconnect';
    l.href = href;
    document.head.append(l);
  }, evil.pre);
  await page.waitForTimeout(1000);
  await browser.close();
  out.preconnectControl = evil.preConnections();
  test.info().annotations.push({ type: 'control', description: `host-page preconnect TCP connections: ${evil.preConnections()}` });
});

test('DNS prefetch: inconclusive here (net-log does not show prefetches even from the host page)', async () => {
  const dir = test.info().outputPath();
  mkdirSync(dir, { recursive: true });
  const log = path.join(dir, 'netlog.json');
  await runBattery([], log);
  const text = readFileSync(log, 'utf8');
  const dns = {
    netLogValid: /localhost/.test(text),
    controlHostSeen: /control\.dns\.wengu-test/.test(text),
    sandboxHostSeen: /s3cr3t\.dns\.wengu-test/i.test(text),
  };
  out.dns = dns;
  expect(dns.netLogValid).toBe(true);
  test.info().annotations.push({ type: 'result', description: JSON.stringify(dns) });
});
