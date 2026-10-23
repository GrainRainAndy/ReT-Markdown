import { defineConfig } from "@playwright/test";
// Playwright sets FORCE_COLOR in worker children; avoid inherited conflicting NO_COLOR.
delete process.env.NO_COLOR;
export default defineConfig({
  testDir: "tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 15000,
  use: { baseURL: "http://127.0.0.1:4173", browserName: "chromium" },
  webServer: {
    command: process.env.RET_TEST_WEB_ROOT
      ? "node scripts/serve-web.mjs"
      : "npm run dev",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
  },
});
