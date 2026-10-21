import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Parser/bundle matrices are CPU-heavy. Bound concurrency rather than raising
  // individual test timeouts when full checks share the developer's machine.
  test: { include: ['web/test/*.test.ts'], maxWorkers: 2, css: { include: [/\.css/] } },
});
