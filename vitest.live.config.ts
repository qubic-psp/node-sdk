import { existsSync, readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// yarn test:live — the live check against a testnet platform (test/live), separate from the unit tests.
// The credentials come from the environment or from the git-ignored file .env.live (KEY=value lines).
if (existsSync('.env.live')) {
  for (const line of readFileSync('.env.live', 'utf8').split('\n')) {
    const match = /^\s*(PSP_E2E_[A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match?.[1] && match[2] !== undefined && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}

export default defineConfig({
  test: {
    include: ['test/live/**/*.test.ts'],
    environment: 'node',
    testTimeout: 200_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
