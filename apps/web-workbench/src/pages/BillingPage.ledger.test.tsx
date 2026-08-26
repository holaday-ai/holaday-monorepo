// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BillingPage } from './BillingPage';

const { authMeQuery, ledgerQuery, historyQuery, cnStatusQuery } = vi.hoisted(() => ({
  authMeQuery: vi.fn(),
  ledgerQuery: vi.fn(),
  historyQuery: vi.fn(),
  cnStatusQuery: vi.fn(),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    auth: {
      me: {
        query: authMeQuery,
      },
    },
    payment: {
      ledger: {
        query: ledgerQuery,
      },
      history: {
        query: historyQuery,
      },
      cnStatus: {
        query: cnStatusQuery,
      },
    },
  },
}));

const settledRecord = {
  orderId: 'pay_completed',
  provider: 'wechat',
  kind: 'subscription',
  plan: 'basic',
  amountCents: 2900,
  currency: 'CNY',
  status: 'completed',
  createdAt: '2026-08-04T15:14:34.852Z',
  completedAt: '2026-08-04T15:14:56.168Z',
};

function renderBilling(path = '/billing'): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <BillingPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  authMeQuery.mockReset();
  ledgerQuery.mockReset();
  historyQuery.mockReset();
  cnStatusQuery.mockReset();
  authMeQuery.mockResolvedValue({
    plan: 'basic',
    planExpiresAt: '2026-09-24T00:00:00.000Z',
  });
  ledgerQuery.mockResolvedValue({ items: [settledRecord], nextCursor: null });
  historyQuery.mockResolvedValue([]);
  cnStatusQuery.mockResolvedValue({ status: 'completed' });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('BillingPage payment ledger integration', () => {
  it('uses the sectioned payment ledger instead of the legacy mixed history', async () => {
    renderBilling();

    expect(await screen.findByText('已确认到账或已退款的记录')).toBeTruthy();
    expect(screen.getByText('到期前手动续费 · 不会自动扣款')).toBeTruthy();
    expect(screen.getByRole('link', { name: '退款/提前结束套餐' })).toBeTruthy();
    expect(screen.queryByText('联系客服取消')).toBeNull();
    expect(screen.queryByText(/当前订阅|订阅加载中/)).toBeNull();
    expect(ledgerQuery).toHaveBeenCalledWith({ section: 'settled', limit: 10 });
    expect(historyQuery).not.toHaveBeenCalled();
  });

  it('explains checkout honestly and links billing to security and legal details', async () => {
    renderBilling();

    expect(await screen.findByText(/付款由结账页处理/)).toBeTruthy();
    expect(screen.queryByText(/本地支付可联系支持处理/)).toBeNull();

    const trustNavigation = screen.getByRole('navigation', { name: '购买与账号保障' });
    expect(trustNavigation.querySelector('a[href="/plan"]')).toBeTruthy();
    expect(trustNavigation.querySelector('a[href="/profile"]')).toBeTruthy();
    expect(trustNavigation.querySelector('a[href="/terms"]')).toBeTruthy();
    expect(trustNavigation.querySelector('a[href="/privacy"]')).toBeTruthy();
  });

  it('refreshes settled payments after a confirmed payment return', async () => {
    renderBilling('/billing?payment=pay_return');

    expect(await screen.findByText('支付已到账')).toBeTruthy();
    await waitFor(() => {
      expect(ledgerQuery.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    expect(cnStatusQuery).toHaveBeenCalledWith({ outTradeNo: 'pay_return' });
    expect(historyQuery).not.toHaveBeenCalled();
  });
});
