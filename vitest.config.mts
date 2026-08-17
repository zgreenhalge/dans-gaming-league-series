import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    // Plain `.test.ts` files run under the default `node` environment (no DOM). Component tests
    // (`.test.tsx`) opt into jsdom per-file via a `// @vitest-environment jsdom` comment, so the two
    // suites don't pay for each other's setup cost.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./src/lib/test-support/setupRtl.ts'],
  },
});
