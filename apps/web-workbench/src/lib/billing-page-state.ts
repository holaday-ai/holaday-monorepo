import type { PaidPlanId } from '@holaday/shared-types';
import { pageErrorMessage } from './page-error-copy';

export interface BillingSnapshot {
  readonly plan: string;
  readonly planExpiresAt: string | null;
}

export interface BillingLoadErrorCopy {
  readonly title: string;
  readonly body: string;
}

export type BillingPaymentReturnStatus = 'checking' | 'completed' | 'failed' | 'timeout';

export interface BillingPaymentReturnCopy {
  readonly tone: 'neutral' | 'success' | 'warning';
  readonly title: string;
  readonly body: string;
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

export function billingPlanActionLabel(plan: string | null | undefined): string {
  if (plan === 'pro') return '管理套餐';
  return '升级';
}

export function isPaidBillingPlan(plan: string | null | undefined): plan is PaidPlanId {
  return plan === 'pro' || plan === 'basic';
}

export function planValidUntilText(
  plan: string | null | undefined,
  planExpiresAt: string | null,
): string {
  if (!isPaidBillingPlan(plan) || !planExpiresAt) return '—';
  const timestamp = Date.parse(planExpiresAt);
  if (!Number.isFinite(timestamp)) return '—';
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function renewalMethodText(plan: string | null | undefined): string {
  return isPaidBillingPlan(plan) ? '到期前手动续费' : '无需续费';
}

export function billingPageSummary(options: {
  readonly loading: boolean;
  readonly error: string | null;
  readonly plan: string | null | undefined;
}): string {
  if (options.loading) return '订阅加载中…';
  if (options.error) return '订阅信息暂时无法加载';
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

export function billingLoadErrorCopy(message: string | null | undefined): BillingLoadErrorCopy {
  const body =
    typeof message === 'string' && message.trim()
      ? message.trim()
      : '请稍后重试，或刷新页面后再打开账单。';
  return {
    title: '订阅信息暂时无法加载',
    body,
  };
}

export function normalizePaymentReturnOrder(value: string | null | undefined): string | null {
  const order = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9_-]{1,64}$/.test(order) ? order : null;
}

export function billingPaymentReturnCopy(
  status: BillingPaymentReturnStatus,
): BillingPaymentReturnCopy {
  if (status === 'completed') {
    return {
      tone: 'success',
      title: '支付已到账',
      body: '套餐与额度已更新，可以继续使用。',
    };
  }
  if (status === 'failed') {
    return {
      tone: 'warning',
      title: '支付未完成',
      body: '订单已失败或取消，没有扣款时可重新发起支付。',
    };
  }
  if (status === 'timeout') {
    return {
      tone: 'warning',
      title: '支付结果仍在确认',
      body: '订单可能仍在处理中，请稍后刷新；请勿重复支付同一订单。',
    };
  }
  return {
    tone: 'neutral',
    title: '正在确认支付结果',
    body: '支付宝回调可能稍有延迟，此页会自动更新。',
  };
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
