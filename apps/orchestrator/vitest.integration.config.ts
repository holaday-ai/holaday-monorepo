import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    environment: 'node',
    globals: false,
    pool: 'forks',
    singleThread: true,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
