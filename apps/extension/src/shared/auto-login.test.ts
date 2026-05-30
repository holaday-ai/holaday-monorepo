import { afterEach, describe, expect, it, vi } from 'vitest';
import { tryAutoLogin } from './auto-login.js';

afterEach(() => {
  vi.restoreAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).chrome;
});

describe('tryAutoLogin', () => {
  it('skips malformed localStorage tokens while scanning workbench tabs', async () => {
    const executeScript = vi
      .fn()
      .mockResolvedValueOnce([{ result: 'undefined' }])
      .mockResolvedValueOnce([{ result: '  hd_live_valid_token  ' }]);
    globalThis.chrome = {
      tabs: {
        query: vi.fn(async () => [
          {
            id: 1,
            url: 'https://holaday.ai/app',
            active: true,
            lastAccessed: 2,
          },
          {
            id: 2,
            url: 'https://app.holaday.ai/app',
            active: false,
            lastAccessed: 1,
          },
          {
            id: 3,
            url: 'https://example.com/',
            active: false,
            lastAccessed: 3,
          },
        ]),
      },
      scripting: { executeScript },
    } as unknown as typeof chrome;

    await expect(tryAutoLogin()).resolves.toBe('hd_live_valid_token');
    expect(executeScript).toHaveBeenCalledTimes(2);
  });
});
