import { describe, expect, it, vi } from 'vitest';
import { DRIVER_ERRORS } from './driver.js';
import { PlaywrightCrxAdapter } from './crx-adapter.js';

vi.mock('playwright-crx', () => ({
  crx: {
    start: () => {
      throw new Error('unexpected crx.start in lifecycle guard test');
    },
  },
}));

describe('PlaywrightCrxAdapter lifecycle guards', () => {
  it('forgets a closed page before running non-goto actions', async () => {
    const adapter = new PlaywrightCrxAdapter({ allowedOrigins: ['holaday.ai'] });
    const harness = adapter as unknown as {
      page: { isClosed: () => boolean; url: () => string } | null;
      tabId: number | null;
    };
    harness.page = {
      isClosed: () => true,
      url: () => 'https://holaday.ai/app',
    };
    harness.tabId = 42;

    const result = await adapter.execute({ kind: 'click' });

    expect(result.status).toBe('error');
    expect(result.error?.code).toBe(DRIVER_ERRORS.NOT_ATTACHED);
    expect(harness.page).toBeNull();
    expect(harness.tabId).toBeNull();
  });

  it('forgets a page when the closed-state probe itself fails', async () => {
    const adapter = new PlaywrightCrxAdapter();
    const harness = adapter as unknown as {
      page: { isClosed: () => boolean; url: () => string } | null;
      tabId: number | null;
    };
    harness.page = {
      isClosed: () => {
        throw new Error('page lifecycle unavailable');
      },
      url: () => 'https://holaday.ai/app',
    };
    harness.tabId = 77;

    const result = await adapter.execute({ kind: 'screenshot' });

    expect(result.status).toBe('error');
    expect(result.error?.code).toBe(DRIVER_ERRORS.NOT_ATTACHED);
    expect(harness.page).toBeNull();
    expect(harness.tabId).toBeNull();
  });
});
