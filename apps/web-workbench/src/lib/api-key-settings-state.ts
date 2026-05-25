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

export function normalizeApiKeyRows(value: unknown): ApiKeyRowView[] {
  if (!Array.isArray(value)) {
    throw new Error('API Key 数据格式异常，请稍后重试。');
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
    throw new Error('API Key 创建结果格式异常，请稍后重试。');
  }
  const raw = value as Record<string, unknown>;
  const apiKeyId = safeApiKeyText(raw.apiKeyId);
  const plaintext = safeApiKeyText(raw.plaintext);
  if (!apiKeyId || !plaintext) {
    throw new Error('API Key 创建结果格式异常，请稍后重试。');
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
  if (err instanceof Error && err.message.trim()) return err.message;
  if (typeof err === 'string' && err.trim()) return err;
  return fallback;
}

function safeApiKeyText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function safeApiKeyDate(value: unknown): string | Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string') return null;
  return value.trim() || null;
}
