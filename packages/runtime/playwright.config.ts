import { defineConfig } from '@playwright/test';

/** Flags shared by tests and scripts/measure-jank.mjs. */
export const CHROMIUM_ARGS = [
  // evil.wengu-test, pre.wengu-test, *.dns.wengu-test -> 127.0.0.1, so exfiltration attempts reach local test servers.
  '--host-resolver-rules=MAP *.wengu-test 127.0.0.1',
  // WebGL in headless Chromium.
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
];

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    browserName: 'chromium',
    // Full Chromium in new-headless mode. The default headless shell has no site isolation at all (every frame in one
    // renderer process, measured), so it would not represent Chrome/Electron.
    channel: 'chromium',
    headless: true,
    launchOptions: { args: CHROMIUM_ARGS },
    viewport: { width: 1000, height: 800 },
  },
  webServer: [
    {
      command: 'vite',
      url: 'http://127.0.0.1:5173/harness.html',
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: 'node scripts/sandbox-server.mjs 5174',
      url: 'http://127.0.0.1:5174/sandbox.html',
      reuseExistingServer: true,
    },
  ],
});
