import { describe, expect, it } from 'vitest';
import {
  appendBillingPaymentPage,
  billingLoadErrorCopy,
  billingLoadErrorMessage,
  billingPageSummary,
  billingPaymentAmount,
  billingPaymentDate,
  billingPaymentProduct,
  billingPaymentProvider,
  billingPaymentReceiptMailOptions,
  billingPaymentReturnCopy,
  billingPaymentStatusCopy,
  billingPlanActionLabel,
  billingPlanLabel,
  cancellationMailBody,
  isPaidBillingPlan,
  normalizeBillingPaymentPage,
  normalizeBillingPaymentRecords,
  normalizeBillingSnapshot,
  normalizePaymentReturnOrder,
  planValidUntilText,
  renewalMethodText,
} from './billing-page-state';

describe('billing page state helpers', () => {
  it('normalizes billing snapshots before rendering subscription details', () => {
    expect(
      normalizeBillingSnapshot({
        plan: ' pro ',
        planExpiresAt: ' 2026-06-24T00:00:00.000Z ',
      }),
    ).toEqual({
      plan: 'pro',
      planExpiresAt: '2026-06-24T00:00:00.000Z',
    });
    expect(
      normalizeBillingSnapshot({
        plan: { unsafe: true },
        planExpiresAt: { unsafe: true },
      }),
    ).toEqual({ plan: 'free', planExpiresAt: null });
    expect(normalizeBillingSnapshot(null)).toEqual({
      plan: 'free',
      planExpiresAt: null,
    });
  });

  it('labels billing plans', () => {
    expect(billingPlanLabel('free')).toBe('Free · 试用');
    expect(billingPlanLabel('basic')).toBe('Basic');
    expect(billingPlanLabel('pro')).toBe('Pro');
    expect(billingPlanLabel('enterprise')).toBe('Free · 试用');
  });

  it('labels plan actions without promising an upgrade from the top plan', () => {
    expect(billingPlanActionLabel('free')).toBe('升级');
    expect(billingPlanActionLabel('basic')).toBe('升级');
    expect(billingPlanActionLabel('pro')).toBe('管理套餐');
  });

  it('detects paid plans', () => {
    expect(isPaidBillingPlan('basic')).toBe(true);
    expect(isPaidBillingPlan('pro')).toBe(true);
    expect(isPaidBillingPlan('free')).toBe(false);
    expect(isPaidBillingPlan(null)).toBe(false);
  });

  it('shows the paid service validity without promising automatic renewal', () => {
    expect(planValidUntilText('free', '2026-06-24T00:00:00.000Z')).toBe('—');
    expect(planValidUntilText('basic', '2026-06-24T00:00:00.000Z')).toBe('2026-06-24');
    expect(planValidUntilText('basic', 'not a date')).toBe('—');
    expect(renewalMethodText('free')).toBe('无需续费');
    expect(renewalMethodText('basic')).toBe('到期前手动续费');
    expect(renewalMethodText('pro')).toBe('到期前手动续费');
  });

  it('summarizes loading, failed, and loaded subscription states', () => {
    expect(billingPageSummary({ loading: true, error: null, plan: null })).toBe('订阅加载中…');
    expect(billingPageSummary({ loading: false, error: 'offline', plan: null })).toBe(
      '订阅信息暂时无法加载',
    );
    expect(billingPageSummary({ loading: false, error: null, plan: 'pro' })).toBe('Pro · 当前订阅');
  });

  it('includes the current plan in cancellation support copy', () => {
    expect(cancellationMailBody('Pro')).toContain('当前套餐：Pro');
  });

  it('normalizes billing loading errors', () => {
    expect(billingLoadErrorMessage(new Error('offline'))).toBe(
      '任务执行出错，请重试。如果反复出现请联系 support@holaday.ai。',
    );
    expect(billingLoadErrorMessage('订阅已取消')).toBe('订阅已取消');
    expect(billingLoadErrorMessage({})).toBe('订阅信息暂时无法加载，请稍后重试。');
  });

  it('formats billing load errors for user-facing surfaces', () => {
    expect(billingLoadErrorCopy('  offline  ')).toEqual({
      title: '订阅信息暂时无法加载',
      body: 'offline',
    });
    expect(billingLoadErrorCopy(undefined)).toEqual({
      title: '订阅信息暂时无法加载',
      body: '请稍后重试，或刷新页面后再打开账单。',
    });
  });

  it('accepts only a bounded payment order id from the return URL', () => {
    expect(normalizePaymentReturnOrder('  pay_abc-123  ')).toBe('pay_abc-123');
    expect(normalizePaymentReturnOrder('')).toBeNull();
    expect(normalizePaymentReturnOrder('../pay_abc')).toBeNull();
    expect(normalizePaymentReturnOrder('x'.repeat(65))).toBeNull();
  });

  it('uses honest settlement copy while an Alipay return is being confirmed', () => {
    expect(billingPaymentReturnCopy('checking')).toEqual({
      tone: 'neutral',
      title: '正在确认支付结果',
      body: '支付宝回调可能稍有延迟，此页会自动更新。',
    });
    expect(billingPaymentReturnCopy('completed').title).toBe('支付已到账');
    expect(billingPaymentReturnCopy('failed').title).toBe('支付未完成');
    expect(billingPaymentReturnCopy('timeout').title).toBe('支付结果仍在确认');
  });

  it('normalizes only safe payment history fields', () => {
    expect(
      normalizeBillingPaymentRecords([
        {
          orderId: ' pay_abc ',
          provider: ' wechat ',
          kind: ' subscription ',
          plan: ' basic ',
          amountCents: 2900,
          currency: ' CNY ',
          status: ' completed ',
          createdAt: ' 2026-08-04T15:14:34.852Z ',
          completedAt: ' 2026-08-04T15:14:56.168Z ',
          metadata: { shouldNotLeak: true },
        },
        null,
      ]),
    ).toEqual([
      {
        orderId: 'pay_abc',
        provider: 'wechat',
        kind: 'subscription',
        plan: 'basic',
        amountCents: 2900,
        currency: 'CNY',
        status: 'completed',
        createdAt: '2026-08-04T15:14:34.852Z',
        completedAt: '2026-08-04T15:14:56.168Z',
      },
    ]);
  });

  it('labels settlement state without treating abandoned orders as paid', () => {
    const now = Date.parse('2026-08-06T12:00:00.000Z');
    expect(billingPaymentStatusCopy('completed', '2026-08-04T15:14:34.852Z', now)).toEqual({
      label: '已支付',
      detail: '款项已确认到账',
      tone: 'success',
    });
    expect(billingPaymentStatusCopy('pending', '2026-08-06T11:50:00.000Z', now).label).toBe(
      '待确认',
    );
    expect(billingPaymentStatusCopy('pending', '2026-08-05T11:50:00.000Z', now)).toEqual({
      label: '未完成',
      detail: '没有确认扣款，可重新发起支付',
      tone: 'muted',
    });
    expect(billingPaymentStatusCopy('failed', '2026-08-06T11:50:00.000Z', now).label).toBe(
      '支付失败',
    );
    expect(billingPaymentStatusCopy('refunded', '2026-08-06T11:50:00.000Z', now).label).toBe(
      '已退款',
    );
  });

  it('formats payment product, provider, amount, and Beijing time', () => {
    expect(billingPaymentProduct('subscription', 'basic')).toBe('Basic 套餐');
    expect(billingPaymentProduct('addon', 'pack-20')).toBe('20 次加量包');
    expect(billingPaymentProvider('wechat')).toBe('微信支付');
    expect(billingPaymentProvider('alipay')).toBe('支付宝');
    expect(billingPaymentProvider('paypal')).toBe('PayPal');
    expect(billingPaymentAmount(2900, 'CNY')).toBe('RMB¥29.00');
    expect(billingPaymentAmount(690, 'USD')).toBe('US$6.90');
    expect(billingPaymentDate('2026-08-04T15:14:56.168Z')).toBe('2026-08-04 23:14');
  });

  it('normalizes a payment page and keeps only statuses for its requested section', () => {
    expect(
      normalizeBillingPaymentPage(
        {
          items: [
            {
              orderId: ' pay_completed ',
              provider: ' wechat ',
              kind: ' subscription ',
              plan: ' basic ',
              amountCents: 2900,
              currency: ' CNY ',
              status: ' completed ',
              createdAt: ' 2026-08-04T15:14:34.852Z ',
              completedAt: ' 2026-08-04T15:14:56.168Z ',
              metadata: { shouldNotLeak: true },
            },
            {
              orderId: 'pay_pending',
              provider: 'alipay',
              kind: 'subscription',
              plan: 'pro',
              amountCents: 6900,
              currency: 'CNY',
              status: 'pending',
              createdAt: '2026-08-04T15:15:00.000Z',
              completedAt: null,
            },
          ],
          nextCursor: {
            createdAt: '2026-08-04T15:14:34.852Z',
            orderId: 'pay_completed',
          },
        },
        'settled',
      ),
    ).toEqual({
      items: [
        {
          orderId: 'pay_completed',
          provider: 'wechat',
          kind: 'subscription',
          plan: 'basic',
          amountCents: 2900,
          currency: 'CNY',
          status: 'completed',
          createdAt: '2026-08-04T15:14:34.852Z',
          completedAt: '2026-08-04T15:14:56.168Z',
        },
      ],
      nextCursor: {
        createdAt: '2026-08-04T15:14:34.852Z',
        orderId: 'pay_completed',
      },
    });
  });

  it('rejects malformed ledger cursors without dropping otherwise safe items', () => {
    expect(
      normalizeBillingPaymentPage(
        {
          items: [
            {
              orderId: 'pay_failed',
              provider: 'alipay',
              kind: 'subscription',
              plan: 'basic',
              amountCents: 2900,
              currency: 'CNY',
              status: 'failed',
              createdAt: '2026-08-04T15:15:00.000Z',
              completedAt: null,
            },
          ],
          nextCursor: { createdAt: 'not-a-date', orderId: '../bad' },
        },
        'unfinished',
      ),
    ).toEqual({
      items: [
        {
          orderId: 'pay_failed',
          provider: 'alipay',
          kind: 'subscription',
          plan: 'basic',
          amountCents: 2900,
          currency: 'CNY',
          status: 'failed',
          createdAt: '2026-08-04T15:15:00.000Z',
          completedAt: null,
        },
      ],
      nextCursor: null,
    });
  });

  it('appends payment pages without duplicating an overlapping order', () => {
    const completed = {
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
    const refunded = { ...completed, orderId: 'pay_refunded', status: 'refunded' };

    expect(appendBillingPaymentPage([completed], [completed, refunded])).toEqual([
      completed,
      refunded,
    ]);
  });

  it('builds a receipt request from safe visible payment fields', () => {
    const options = billingPaymentReceiptMailOptions({
      orderId: 'pay_completed',
      provider: 'wechat',
      kind: 'subscription',
      plan: 'basic',
      amountCents: 2900,
      currency: 'CNY',
      status: 'completed',
      createdAt: '2026-08-04T15:14:34.852Z',
      completedAt: '2026-08-04T15:14:56.168Z',
    });

    expect(options.subject).toBe('HOLA DAY 付款凭证与发票申请 · pay_completed');
    expect(options.body).toContain('订单号：pay_completed');
    expect(options.body).toContain('产品：Basic 套餐');
    expect(options.body).toContain('金额：RMB¥29.00');
    expect(options.body).toContain('付款时间：2026-08-04 23:14');
    expect(options.body).toContain('发票抬头：');
    expect(options.body).not.toContain('userId');
    expect(options.body).not.toContain('metadata');
  });
});
