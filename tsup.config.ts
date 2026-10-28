import { defineConfig } from 'tsup';

// One entry, two formats: dist/index.js (ESM) + dist/index.cjs (CommonJS) with .d.ts / .d.cts next to them.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
});
