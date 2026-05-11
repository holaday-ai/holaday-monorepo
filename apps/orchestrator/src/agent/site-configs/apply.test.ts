import { describe, expect, it, vi } from 'vitest';

import { applySiteConfigPostNavigation } from './apply.js';
import type { SiteConfig } from './types.js';

interface FakePage {
  url: () => string;
  evaluate: ReturnType<typeof vi.fn>;
}

function fakePage(returnValueByText: string | null = null): FakePage {
  return {
    url: () => 'https://x.com/',
    evaluate: vi.fn(async (_fn: unknown, _arg: string[]) => returnValueByText),
  };
}

const baseConfig: SiteConfig = {
  siteId: 'test',
  domains: ['x.com'],
  requiresAuth: false,
  dismiss: {
    cookieBannerTexts: ['同意', 'Accept'],
    popupDismissTexts: ['关闭', '稍后再说'],
  },
};

describe('applySiteConfigPostNavigation', () => {
  it('null config → no-op, empty dismissed list', async () => {
    const page = fakePage();
    const r = await applySiteConfigPostNavigation(null, page);
    expect(r.config).toBeNull();
    expect(r.dismissed).toEqual([]);
    expect(page.evaluate).not.toHaveBeenCalled();
  });

  it('config without dismiss patterns → no clicks', async () => {
    const page = fakePage();
    const r = await applySiteConfigPostNavigation(
      { siteId: 'noop', domains: ['y.com'], requiresAuth: false },
      page,
    );
    expect(r.dismissed).toEqual([]);
    expect(page.evaluate).not.toHaveBeenCalled();
  });

  it('cookie banner clicks → dismissed list contains the matched text', async () => {
    const page = fakePage('同意');
    const r = await applySiteConfigPostNavigation(baseConfig, page);
    expect(r.dismissed).toContain('同意');
    expect(r.config).toBe(baseConfig);
  });

  it('cookie banner not found → empty dismissed', async () => {
    const page = fakePage(null);
    const r = await applySiteConfigPostNavigation(baseConfig, page);
    expect(r.dismissed).toEqual([]);
    // evaluate is called twice (cookie + popup) when no age-gate config
    expect(page.evaluate).toHaveBeenCalledTimes(2);
  });

  it('all three categories run independently when each finds something', async () => {
    const page: FakePage = {
      url: () => 'https://x.com/',
      evaluate: vi
        .fn()
        .mockImplementationOnce(async () => '同意') // cookie
        .mockImplementationOnce(async () => '已满18岁') // age
        .mockImplementationOnce(async () => '关闭'), // popup
    };
    const r = await applySiteConfigPostNavigation(
      {
        ...baseConfig,
        dismiss: {
          cookieBannerTexts: ['同意'],
          ageGateTexts: ['已满18岁'],
          popupDismissTexts: ['关闭'],
        },
      },
      page,
    );
    expect(r.dismissed).toEqual(['同意', '已满18岁', '关闭']);
  });

  it('evaluate throws → swallow + continue with remaining categories', async () => {
    const page: FakePage = {
      url: () => 'https://x.com/',
      evaluate: vi
        .fn()
        .mockImplementationOnce(async () => {
          throw new Error('page closed mid-eval');
        })
        .mockImplementationOnce(async () => '关闭'),
    };
    const r = await applySiteConfigPostNavigation(baseConfig, page);
    // First (cookie) threw → swallowed → empty contribution.
    // Second (popup) succeeded.
    expect(r.dismissed).toEqual(['关闭']);
  });

  it('evaluate hangs > 800ms → race timeout returns null (no click)', async () => {
    // Codex P3 — guard against renderer pin (taobao's sliding-captcha
    // bootstrap occasionally pegs the main thread for seconds). The
    // post-nav hook MUST not block the agent loop.
    const slowEval = (): Promise<string | null> =>
      new Promise((resolve) => setTimeout(() => resolve('同意'), 1_200));
    const page: FakePage = {
      url: () => 'https://x.com/',
      evaluate: vi.fn(slowEval),
    };
    const started = Date.now();
    const r = await applySiteConfigPostNavigation(
      { ...baseConfig, dismiss: { cookieBannerTexts: ['同意'] } },
      page,
    );
    const elapsed = Date.now() - started;
    expect(r.dismissed).toEqual([]);
    // The race should bail well before 1.2 s. Allow generous slack for
    // CI clock jitter — anything under 1100 ms proves the race worked.
    expect(elapsed).toBeLessThan(1_100);
  });
});
