import { pageErrorMessage } from './page-error-copy';

export interface ApiKeyRowView {
  readonly apiKeyId: string;
  readonly name: string;
  readonly keyPrefix: string;
  readonly lastUsedAt: string | Date | null;
  readonly expiresAt: string | Date | null;
  readonly revokedAt: string | Date | null;
  readonly createdAt: string | Date | null;
}

export interface FreshApiKeyView {
  readonly apiKeyId: string;
  readonly plaintext: string;
  readonly name: string;
}

export interface ApiKeySettingsLoadErrorCopy {
  readonly title: string;
  readonly body: string;
}

export function normalizeApiKeyRows(value: unknown): ApiKeyRowView[] {
  if (!Array.isArray(value)) {
    throw new Error('API Key 列表暂时无法读取，请刷新后重试。');
  }
  return value.flatMap((row): ApiKeyRowView[] => {
    if (typeof row !== 'object' || row === null) return [];
    const raw = row as Record<string, unknown>;
    const apiKeyId = safeApiKeyText(raw.apiKeyId);
    if (!apiKeyId) return [];
    return [
      {
        apiKeyId,
        name: safeApiKeyText(raw.name) || '未命名 Key',
        keyPrefix: safeApiKeyText(raw.keyPrefix) || '未知前缀',
        lastUsedAt: safeApiKeyDate(raw.lastUsedAt),
        expiresAt: safeApiKeyDate(raw.expiresAt),
        revokedAt: safeApiKeyDate(raw.revokedAt),
        createdAt: safeApiKeyDate(raw.createdAt),
      },
    ];
  });
}

export function normalizeFreshApiKey(
  value: unknown,
  fallbackName: string,
): FreshApiKeyView {
  if (typeof value !== 'object' || value === null) {
    throw new Error('API Key 已创建，但结果暂时无法确认，请刷新后查看列表。');
  }
  const raw = value as Record<string, unknown>;
  const apiKeyId = safeApiKeyText(raw.apiKeyId);
  const plaintext = safeApiKeyText(raw.plaintext);
  if (!apiKeyId || !plaintext) {
    throw new Error('API Key 已创建，但结果暂时无法确认，请刷新后查看列表。');
  }
  return {
    apiKeyId,
    plaintext,
    name: safeApiKeyText(raw.name) || fallbackName.trim() || '未命名 Key',
  };
}

export function apiKeySettingsErrorMessage(
  err: unknown,
  fallback = '请稍后重试',
): string {
  return pageErrorMessage(err, fallback);
}

export function apiKeySettingsLoadErrorCopy(
  message: string | null | undefined,
): ApiKeySettingsLoadErrorCopy {
  const body =
    typeof message === 'string' && message.trim()
      ? message.trim()
      : '请稍后重试，或刷新页面后再打开开发者设置。';
  return {
    title: 'API Key 暂时无法加载',
    body,
  };
}

export function apiKeySettingsActionError(
  action: string,
  err: unknown,
): string {
  return `${action}：${apiKeySettingsErrorMessage(err)}`;
}

function safeApiKeyText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function safeApiKeyDate(value: unknown): string | Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  return Number.isFinite(Date.parse(text)) ? text : null;
}
