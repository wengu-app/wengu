import { defineConfig } from "@playwright/test";

/**
 * Drives the real app over CDP (see tests/launch.ts): the dev shell by default, a packaged binary with
 * WENGU_APP_EXECUTABLE=/path/to/binary. WENGU_TEST_NO_SANDBOX=1 on hosts where Chromium's sandbox is unavailable.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  timeout: 240_000,
  reporter: [["list"]],
  outputDir: "test-results",
});
