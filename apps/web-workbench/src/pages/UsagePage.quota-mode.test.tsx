// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UsagePage } from './UsagePage';

const trpcMocks = vi.hoisted(() => ({
  summary: vi.fn(),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    usage: {
      summary: { query: trpcMocks.summary },
    },
  },
}));

beforeEach(() => {
  trpcMocks.summary.mockResolvedValue({
    quotaMode: 'unmetered_test',
    monthTasksTotal: 278,
    monthCompleted: 159,
    monthPartialSuccess: 7,
    monthFailed: 112,
    monthCancelled: 0,
    monthExecuting: 0,
    quotaLimit: 100,
    quotaUsed: 0,
    quotaRemaining: 100,
    quotaBonus: 0,
    dailyCounts: [
      { date: '2026-08-21', count: 169 },
      { date: '2026-08-22', count: 0 },
    ],
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('UsagePage quota mode', () => {
  it('explains unmetered test-account usage instead of showing a contradictory balance', async () => {
    render(
      <MemoryRouter initialEntries={['/usage']}>
        <UsagePage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('额度状态')).toBeTruthy();
    expect(screen.getByText('不扣减')).toBeTruthy();
    expect(screen.getByText('生产测试账号')).toBeTruthy();
    expect(screen.getByText('执行记录正常统计')).toBeTruthy();
    expect(screen.queryByText('配额 100 个')).toBeNull();
    expect(
      screen.getByText('当前为生产测试账号，任务执行记录会正常统计，但不会扣减套餐额度。'),
    ).toBeTruthy();
    expect(screen.queryByText('0 / 100')).toBeNull();
  });
});
