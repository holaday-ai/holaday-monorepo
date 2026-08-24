// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentLedgerSection } from './PaymentLedgerSection';

const { ledgerQuery } = vi.hoisted(() => ({
  ledgerQuery: vi.fn(),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    payment: {
      ledger: {
        query: ledgerQuery,
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

const refundedRecord = {
  ...settledRecord,
  orderId: 'pay_refunded',
  status: 'refunded',
  createdAt: '2026-08-03T15:14:34.852Z',
  completedAt: '2026-08-03T15:14:56.168Z',
};

const unfinishedRecord = {
  ...settledRecord,
  orderId: 'pay_failed',
  provider: 'alipay',
  status: 'failed',
  completedAt: null,
};

beforeEach(() => {
  ledgerQuery.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PaymentLedgerSection', () => {
  it('loads settled records first and fetches unfinished attempts only after expansion', async () => {
    ledgerQuery.mockImplementation(async (input: { section: string }) =>
      input.section === 'settled'
        ? { items: [settledRecord], nextCursor: null }
        : { items: [unfinishedRecord], nextCursor: null },
    );
    const user = userEvent.setup();

    render(<PaymentLedgerSection refreshKey={0} />);

    expect(await screen.findByText('Basic 套餐')).toBeTruthy();
    expect(ledgerQuery).toHaveBeenCalledWith({ section: 'settled', limit: 10 });
    expect(ledgerQuery).not.toHaveBeenCalledWith(
      expect.objectContaining({ section: 'unfinished' }),
    );

    const disclosure = screen.getByRole('button', { name: /查看未完成支付/ });
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    await user.click(disclosure);

    expect(
      (await screen.findAllByText('没有确认扣款，可重新发起支付')).length,
    ).toBeGreaterThan(0);
    expect(disclosure.getAttribute('aria-expanded')).toBe('true');
    expect(ledgerQuery).toHaveBeenCalledWith({ section: 'unfinished', limit: 10 });
  });

  it('loads settled pages independently and supports order copy and receipt mail', async () => {
    const cursor = {
      createdAt: settledRecord.createdAt,
      orderId: settledRecord.orderId,
    };
    ledgerQuery.mockImplementation(
      async (input: { section: string; cursor?: typeof cursor }) => {
        if (input.section === 'unfinished') return { items: [], nextCursor: null };
        if (input.cursor) return { items: [refundedRecord], nextCursor: null };
        return { items: [settledRecord], nextCursor: cursor };
      },
    );
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);

    render(<PaymentLedgerSection refreshKey={0} />);

    expect(await screen.findByText('Basic 套餐')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '加载更多付款记录' }));
    expect((await screen.findAllByText('已退款')).length).toBeGreaterThan(0);
    expect(ledgerQuery).toHaveBeenCalledWith({
      section: 'settled',
      limit: 10,
      cursor,
    });

    await user.click(screen.getByRole('button', { name: '复制订单 pay_completed' }));
    expect(writeText).toHaveBeenCalledWith('pay_completed');
    expect(await screen.findByText('已复制')).toBeTruthy();

    const receipt = screen.getByRole('link', {
      name: '申请订单 pay_completed 的付款凭证或发票',
    });
    const href = decodeURIComponent(receipt.getAttribute('href') ?? '');
    expect(href).toContain('mailto:support@holaday.ai');
    expect(href).toContain('pay_completed');
  });

  it('keeps loaded records visible when loading more fails and scopes retry to that list', async () => {
    const cursor = {
      createdAt: settledRecord.createdAt,
      orderId: settledRecord.orderId,
    };
    ledgerQuery
      .mockResolvedValueOnce({ items: [settledRecord], nextCursor: cursor })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ items: [refundedRecord], nextCursor: null });
    const user = userEvent.setup();

    render(<PaymentLedgerSection refreshKey={0} />);

    expect(await screen.findByText('Basic 套餐')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '加载更多付款记录' }));

    expect(await screen.findByText('付款记录暂时无法继续加载')).toBeTruthy();
    expect(screen.getByText('Basic 套餐')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '重试加载付款记录' }));
    expect((await screen.findAllByText('已退款')).length).toBeGreaterThan(0);
  });

  it('refreshes settled records without automatically opening unfinished attempts', async () => {
    ledgerQuery
      .mockResolvedValueOnce({ items: [settledRecord], nextCursor: null })
      .mockResolvedValueOnce({ items: [refundedRecord], nextCursor: null });

    const view = render(<PaymentLedgerSection refreshKey={0} />);
    expect(await screen.findByText(/订单 pay_completed/)).toBeTruthy();

    view.rerender(<PaymentLedgerSection refreshKey={1} />);
    expect(await screen.findByText(/订单 pay_refunded/)).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByText(/订单 pay_completed/)).toBeNull();
    });
    expect(ledgerQuery).toHaveBeenCalledTimes(2);
    expect(ledgerQuery).not.toHaveBeenCalledWith(
      expect.objectContaining({ section: 'unfinished' }),
    );
  });
});
