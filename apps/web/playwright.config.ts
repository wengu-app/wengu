import { defineConfig } from "@playwright/test";

const PORT = 5177;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  reporter: [["list"]],
  outputDir: "test-results",
  use: {
    // The production build, served from a sub-path by a plain static server.
    baseURL: `http://localhost:${PORT}/wengu/`,
    browserName: "chromium",
    channel: "chromium",
    headless: true,
    viewport: { width: 1200, height: 820 },
    acceptDownloads: true,
    launchOptions: {
      args: ["--autoplay-policy=no-user-gesture-required", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    },
  },
  webServer: {
    command: `node scripts/serve.mjs dist ${PORT} /wengu/`,
    url: `http://localhost:${PORT}/wengu/index.html`,
    reuseExistingServer: false,
    timeout: 20_000,
  },
});
