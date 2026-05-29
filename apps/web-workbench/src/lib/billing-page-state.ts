import { formatCny, getPlanPriceCents, type PaidPlanId } from '@holaday/shared-types';
import { pageErrorMessage } from './page-error-copy';

export interface BillingSnapshot {
  readonly plan: string;
  readonly planExpiresAt: string | null;
}

export function normalizeBillingSnapshot(value: unknown): BillingSnapshot {
  const raw = isRecord(value) ? value : {};
  return {
    plan: safeBillingText(raw.plan) || 'free',
    planExpiresAt: safeBillingNullableText(raw.planExpiresAt),
  };
}

export function billingPlanLabel(plan: string | null | undefined): string {
  if (plan === 'pro') return 'Pro';
  if (plan === 'basic') return 'Basic';
  return 'Free · 试用';
}

export function isPaidBillingPlan(plan: string | null | undefined): plan is PaidPlanId {
  return plan === 'pro' || plan === 'basic';
}

export function nextBillingAmountText(plan: string | null | undefined): string {
  if (!isPaidBillingPlan(plan)) return '—';
  return formatCny(getPlanPriceCents(plan, 'monthly', 'cny', false));
}

export function nextBillingDateText(plan: string | null | undefined, planExpiresAt: string | null): string {
  if (!isPaidBillingPlan(plan) || !planExpiresAt) return '—';
  const timestamp = Date.parse(planExpiresAt);
  if (!Number.isFinite(timestamp)) return '—';
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function billingPageSummary(options: {
  readonly loading: boolean;
  readonly error: string | null;
  readonly plan: string | null | undefined;
}): string {
  if (options.loading) return '订阅加载中…';
  if (options.error) return '订阅加载失败';
  return `${billingPlanLabel(options.plan)} · 当前订阅`;
}

export function cancellationMailBody(planLabel: string): string {
  return `请协助取消我的 HOLA DAY 订阅。\n\n注册邮箱：\n当前套餐：${planLabel}`;
}

export function billingLoadErrorMessage(
  err: unknown,
  fallback = '订阅信息暂时无法加载，请稍后重试。',
): string {
  return pageErrorMessage(err, fallback);
}

function safeBillingNullableText(value: unknown): string | null {
  const text = safeBillingText(value);
  return text || null;
}

function safeBillingText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
