import { defineConfig } from 'vitest/config';

// yarn test:live — the live check against a testnet platform (test/live), separate from the unit tests
export default defineConfig({
  test: {
    include: ['test/live/**/*.test.ts'],
    environment: 'node',
    testTimeout: 200_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
