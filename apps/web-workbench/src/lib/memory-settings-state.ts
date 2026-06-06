import { pageErrorMessage } from './page-error-copy';

export interface MemoryRowView {
  readonly externalId: string;
  readonly category: string;
  readonly keyName: string;
  readonly value: string;
  readonly expiresAt: string | null;
  readonly updatedAt: string;
}

export const MEMORY_CATEGORY_LABELS: Record<string, string> = {
  preference: '偏好',
  site_state: '网站状态',
  task_history: '任务历史',
  execution_tip: '执行经验',
};

export function normalizeMemoryRows(value: unknown): MemoryRowView[] {
  if (typeof value !== 'object' || value === null) {
    throw new Error('AI 记忆暂时无法读取，请刷新后重试。');
  }
  const memories = (value as { memories?: unknown }).memories;
  if (!Array.isArray(memories)) {
    throw new Error('AI 记忆暂时无法读取，请刷新后重试。');
  }
  return memories.flatMap((row, index): MemoryRowView[] => {
    if (typeof row !== 'object' || row === null) return [];
    const raw = row as Record<string, unknown>;
    const externalId = safeMemoryText(raw.externalId);
    if (!externalId) return [];
    return [
      {
        externalId,
        category: safeMemoryText(raw.category) || 'task_history',
        keyName: safeMemoryText(raw.keyName) || `记忆 ${index + 1}`,
        value: safeMemoryText(raw.value) || '暂无内容。',
        expiresAt: safeNullableIsoText(raw.expiresAt),
        updatedAt: safeMemoryText(raw.updatedAt),
      },
    ];
  });
}

export function memoryCategoryLabel(category: unknown): string {
  const safeCategory = safeMemoryText(category);
  return MEMORY_CATEGORY_LABELS[safeCategory] ?? (safeCategory || '记忆');
}

export function memoryLoadErrorMessage(
  err: unknown,
  fallback = 'AI 记忆暂时无法加载，请稍后重试。',
): string {
  return pageErrorMessage(err, fallback);
}

function safeMemoryText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function safeNullableIsoText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return safeMemoryText(value) || null;
}
