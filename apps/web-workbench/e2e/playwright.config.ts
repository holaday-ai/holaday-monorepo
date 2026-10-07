import path from 'node:path';
import { defineConfig, devices } from 'playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30 * 60_000,
  globalTimeout: 2 * 60 * 60_000,
  reporter: [['line']],
  outputDir: path.resolve(process.env.HOLADAY_AUDIT_OUTPUT ?? 'e2e/artifacts', 'runner'),
  use: {
    baseURL: process.env.HOLADAY_AUDIT_BASE_URL ?? 'http://127.0.0.1:4173',
    actionTimeout: 8_000,
    navigationTimeout: 30_000,
    // Traces/HAR/video can contain Authorization headers or account data.
    trace: 'off',
    video: 'off',
    screenshot: 'off',
    serviceWorkers: 'block',
    launchOptions: { args: ['--renderer-process-limit=2'] },
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'iphone-14', use: { ...devices['iPhone 14'], defaultBrowserType: 'chromium' } },
  ],
});
