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
    expect(ledgerQuery).toHaveBeenCalledWith({ section: 'settled', limit: 10 });
    expect(historyQuery).not.toHaveBeenCalled();
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
