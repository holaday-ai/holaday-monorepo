import { describe, expect, it } from 'vitest';
import {
  billingLoadErrorCopy,
  billingLoadErrorMessage,
  billingPageSummary,
  billingPaymentReturnCopy,
  billingPlanActionLabel,
  billingPlanLabel,
  cancellationMailBody,
  isPaidBillingPlan,
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
});
