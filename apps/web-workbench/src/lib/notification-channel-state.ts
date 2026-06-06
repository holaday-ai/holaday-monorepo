import type { NotificationPlatform } from './notification-channel-copy';
import { pageErrorMessage } from './page-error-copy';

export interface NotificationChannelRow {
  readonly channelId: string;
  readonly platform: NotificationPlatform;
  readonly webhookUrl: string;
  readonly customTemplate: unknown;
  readonly enabled: boolean;
  readonly createdAt: string | Date;
}

export function normalizeNotificationChannels(value: unknown): NotificationChannelRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const row = normalizeNotificationChannel(entry);
    return row ? [row] : [];
  });
}

export function notificationChannelsLoadErrorMessage(
  err: unknown,
  fallback = '通知渠道暂时无法加载，请稍后重试。',
): string {
  return pageErrorMessage(err, fallback);
}

export function notificationChannelTestErrorMessage({
  error,
  status,
}: {
  error?: unknown;
  status?: unknown;
}): string {
  const httpStatus = safeStatus(status);
  return pageErrorMessage(error, notificationStatusFallback(httpStatus));
}

export function notificationStatusFallback(status: number | null): string {
  if (status === null) return '发送失败，请稍后重试。';
  if (status >= 400 && status < 500) {
    return '发送失败，请检查通知地址或签名配置后重试。';
  }
  if (status >= 500) {
    return '发送失败，对方服务暂时没有接收，请稍后重试。';
  }
  return '发送失败，请稍后重试。';
}

function normalizeNotificationChannel(value: unknown): NotificationChannelRow | null {
  if (!isRecord(value)) return null;
  const channelId = safeText(value.channelId);
  if (!channelId) return null;
  return {
    channelId,
    platform: normalizePlatform(value.platform),
    webhookUrl: safeText(value.webhookUrl),
    customTemplate: value.customTemplate,
    enabled: value.enabled !== false,
    createdAt: normalizeCreatedAt(value.createdAt),
  };
}

function normalizePlatform(value: unknown): NotificationPlatform {
  return value === 'wecom' ||
    value === 'feishu' ||
    value === 'dingtalk' ||
    value === 'custom'
    ? value
    : 'custom';
}

function normalizeCreatedAt(value: unknown): string | Date {
  if (value instanceof Date) return value;
  return typeof value === 'string' ? value : '';
}

function safeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function safeStatus(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
