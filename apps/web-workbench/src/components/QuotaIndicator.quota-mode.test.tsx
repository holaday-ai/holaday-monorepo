// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuotaIndicator } from './QuotaIndicator';

const trpcMocks = vi.hoisted(() => ({
  status: vi.fn(),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    quota: {
      status: { query: trpcMocks.status },
    },
  },
}));

beforeEach(() => {
  trpcMocks.status.mockResolvedValue({
    plan: 'basic',
    period: 'month',
    quotaMode: 'unmetered_test',
    tasksUsed: 0,
    tasksLimit: 100,
    tasksRemaining: 100,
    bonusTasks: 0,
    opusUsed: 0,
    opusLimit: null,
    opusRemaining: null,
    bonusOpus: 0,
    concurrentCount: 0,
    concurrencyLimit: 1,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('QuotaIndicator quota mode', () => {
  it('shows the test-account quota policy instead of a fake remaining balance', async () => {
    render(
      <MemoryRouter>
        <QuotaIndicator />
      </MemoryRouter>,
    );

    expect(await screen.findByText('测试账号')).toBeTruthy();
    expect(screen.getByText('额度不扣减')).toBeTruthy();
    expect(screen.getByText('执行记录正常统计')).toBeTruthy();
    expect(screen.queryByText('剩余 100')).toBeNull();
  });
});
