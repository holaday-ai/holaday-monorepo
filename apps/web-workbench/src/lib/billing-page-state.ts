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

export interface BillingPaymentRecord {
  readonly orderId: string;
  readonly provider: string;
  readonly kind: string;
  readonly plan: string;
  readonly amountCents: number;
  readonly currency: string;
  readonly status: string;
  readonly createdAt: string;
  readonly completedAt: string | null;
}

export type BillingPaymentLedgerSection = 'settled' | 'unfinished';

export interface BillingPaymentCursor {
  readonly createdAt: string;
  readonly orderId: string;
}

export interface BillingPaymentPage {
  readonly items: BillingPaymentRecord[];
  readonly nextCursor: BillingPaymentCursor | null;
}

export interface BillingPaymentStatusCopy {
  readonly label: string;
  readonly detail: string;
  readonly tone: 'success' | 'warning' | 'muted';
}

const PENDING_PAYMENT_WINDOW_MS = 30 * 60 * 1_000;

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

export function normalizeBillingPaymentRecords(value: unknown): BillingPaymentRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const orderId = safeBillingText(item.orderId);
    const provider = safeBillingText(item.provider);
    const kind = safeBillingText(item.kind);
    const plan = safeBillingText(item.plan);
    const currency = safeBillingText(item.currency).toUpperCase();
    const status = safeBillingText(item.status);
    const createdAt = safeBillingText(item.createdAt);
    const completedAt = safeBillingNullableText(item.completedAt);
    const amountCents =
      typeof item.amountCents === 'number' && Number.isSafeInteger(item.amountCents)
        ? item.amountCents
        : -1;
    if (
      !orderId ||
      !provider ||
      !kind ||
      !plan ||
      !currency ||
      !status ||
      !createdAt ||
      amountCents < 0
    ) {
      return [];
    }
    return [
      {
        orderId,
        provider,
        kind,
        plan,
        amountCents,
        currency,
        status,
        createdAt,
        completedAt,
      },
    ];
  });
}

export function normalizeBillingPaymentPage(
  value: unknown,
  section: BillingPaymentLedgerSection,
): BillingPaymentPage {
  const raw = isRecord(value) ? value : {};
  const allowedStatuses =
    section === 'settled' ? new Set(['completed', 'refunded']) : new Set(['pending', 'failed']);
  const items = normalizeBillingPaymentRecords(raw.items).filter((item) =>
    allowedStatuses.has(item.status),
  );
  const rawCursor = isRecord(raw.nextCursor) ? raw.nextCursor : null;
  const createdAt = safeBillingText(rawCursor?.createdAt);
  const orderId = safeBillingText(rawCursor?.orderId);
  const nextCursor =
    Number.isFinite(Date.parse(createdAt)) && /^[A-Za-z0-9_-]{1,64}$/.test(orderId)
      ? { createdAt, orderId }
      : null;

  return { items, nextCursor };
}

export function appendBillingPaymentPage(
  current: readonly BillingPaymentRecord[],
  incoming: readonly BillingPaymentRecord[],
): BillingPaymentRecord[] {
  const seen = new Set<string>();
  return [...current, ...incoming].filter((record) => {
    if (seen.has(record.orderId)) return false;
    seen.add(record.orderId);
    return true;
  });
}

export function billingPaymentStatusCopy(
  status: string,
  createdAt: string,
  now = Date.now(),
): BillingPaymentStatusCopy {
  if (status === 'completed') {
    return { label: '已支付', detail: '款项已确认到账', tone: 'success' };
  }
  if (status === 'refunded') {
    return { label: '已退款', detail: '款项已按退款流程处理', tone: 'muted' };
  }
  if (status === 'failed') {
    return { label: '支付失败', detail: '没有确认扣款，可重新发起支付', tone: 'warning' };
  }
  const created = Date.parse(createdAt);
  if (
    status === 'pending' &&
    Number.isFinite(created) &&
    now - created < PENDING_PAYMENT_WINDOW_MS
  ) {
    return { label: '待确认', detail: '正在等待支付平台确认', tone: 'warning' };
  }
  return { label: '未完成', detail: '没有确认扣款，可重新发起支付', tone: 'muted' };
}

export function billingPaymentProduct(kind: string, plan: string): string {
  if (kind === 'addon') {
    const count = /^pack-(\d+)$/.exec(plan)?.[1];
    return count ? `${count} 次加量包` : '任务加量包';
  }
  if (plan === 'pro') return 'Pro 套餐';
  if (plan === 'basic') return 'Basic 套餐';
  return '套餐订阅';
}

export function billingPaymentProvider(provider: string): string {
  if (provider === 'wechat') return '微信支付';
  if (provider === 'alipay') return '支付宝';
  if (provider === 'paypal') return 'PayPal';
  return '在线支付';
}

export function billingPaymentAmount(amountCents: number, currency: string): string {
  const amount = (Math.max(0, amountCents) / 100).toFixed(2);
  if (currency.toUpperCase() === 'CNY') return `RMB¥${amount}`;
  if (currency.toUpperCase() === 'USD') return `US$${amount}`;
  return `${currency.toUpperCase()} ${amount}`;
}

export function billingPaymentDate(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '时间待确认';
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(timestamp);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`;
}

export function billingPaymentReceiptMailOptions(record: BillingPaymentRecord): {
  subject: string;
  body: string;
} {
  const product = billingPaymentProduct(record.kind, record.plan);
  const amount = billingPaymentAmount(record.amountCents, record.currency);
  const paidAt = billingPaymentDate(record.completedAt ?? record.createdAt);
  return {
    subject: `HOLA DAY 付款凭证与发票申请 · ${record.orderId}`,
    body: [
      '请协助处理以下付款的凭证或发票申请。',
      '',
      `订单号：${record.orderId}`,
      `产品：${product}`,
      `金额：${amount}`,
      `付款时间：${paidAt}`,
      '',
      '需要：付款凭证 / 发票（请保留所需项）',
      '发票抬头：',
      '税号：',
      '接收邮箱：',
    ].join('\n'),
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
