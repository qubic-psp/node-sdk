import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15_000,
    // The machine is shared with other psp runs: two workers are enough for this suite
    maxWorkers: 2,
    minWorkers: 1,
    typecheck: { enabled: true, include: ['src/**/*.test-d.ts', 'test/**/*.test-d.ts'] },
  },
});
