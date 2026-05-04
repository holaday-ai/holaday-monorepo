import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.integration.test.ts', 'node_modules/**', 'dist/**'],
    environment: 'node',
    globals: false,
    pool: 'threads',
    // Single setup file with the placeholder env. Lets individual
    // tests stop maintaining their own per-file env-stamp boilerplate.
    setupFiles: ['./vitest.setup.ts'],
  },
});
