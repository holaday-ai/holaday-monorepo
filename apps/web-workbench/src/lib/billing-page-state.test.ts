import { describe, expect, it } from 'vitest';
import {
  billingPageSummary,
  billingPlanLabel,
  cancellationMailBody,
  isPaidBillingPlan,
  nextBillingAmountText,
  nextBillingDateText,
} from './billing-page-state';

describe('billing page state helpers', () => {
  it('labels billing plans', () => {
    expect(billingPlanLabel('free')).toBe('Free · 试用');
    expect(billingPlanLabel('basic')).toBe('Basic');
    expect(billingPlanLabel('pro')).toBe('Pro');
    expect(billingPlanLabel('enterprise')).toBe('Free · 试用');
  });

  it('detects paid plans', () => {
    expect(isPaidBillingPlan('basic')).toBe(true);
    expect(isPaidBillingPlan('pro')).toBe(true);
    expect(isPaidBillingPlan('free')).toBe(false);
    expect(isPaidBillingPlan(null)).toBe(false);
  });

  it('formats next billing amount and date only for paid plans', () => {
    expect(nextBillingAmountText('free')).toBe('—');
    expect(nextBillingAmountText('basic')).toMatch(/^¥/);
    expect(nextBillingDateText('free', '2026-06-24T00:00:00.000Z')).toBe('—');
    expect(nextBillingDateText('basic', '2026-06-24T00:00:00.000Z')).toBe('2026-06-24');
    expect(nextBillingDateText('basic', 'not a date')).toBe('—');
  });

  it('summarizes loading, failed, and loaded subscription states', () => {
    expect(billingPageSummary({ loading: true, error: null, plan: null })).toBe('订阅加载中…');
    expect(billingPageSummary({ loading: false, error: 'offline', plan: null })).toBe('订阅加载失败');
    expect(billingPageSummary({ loading: false, error: null, plan: 'pro' })).toBe(
      'Pro · 当前订阅',
    );
  });

  it('includes the current plan in cancellation support copy', () => {
    expect(cancellationMailBody('Pro')).toContain('当前套餐：Pro');
  });
});
