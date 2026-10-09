import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx', 'tests/integration/**/*.test.ts'],
    esbuild: { jsx: 'automatic' },
    environment: 'node',
    testTimeout: 30000,
    pool: 'forks',
  },
});
