import { defineConfig } from 'playwright/test';

// Every interaction regression lives with the editor tests. Keep one default
// entry point so a new spec is included without an ad-hoc build/ config.
export default defineConfig({
  testDir: './web/test',
  testMatch: '*.spec.ts',
  workers: 1,
  timeout: 20_000,
  reporter: 'line',
  outputDir: './build/test-results/playwright',
});
