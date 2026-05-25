export type ConnectionCategory =
  | 'productivity'
  | 'communication'
  | 'storage'
  | 'development'
  | 'social';

export interface ConnectionProviderLike {
  readonly id: string;
  readonly name: string;
  readonly icon?: string;
  readonly description?: string;
  readonly category: ConnectionCategory;
  readonly oauthSupported: boolean;
  readonly comingSoon: boolean;
}

export interface ConnectionProviderView extends ConnectionProviderLike {
  readonly icon: string;
  readonly description: string;
}

export interface ConnectionProviderGroup<TProvider extends ConnectionProviderLike> {
  readonly category: ConnectionCategory;
  readonly label: string;
  readonly items: readonly TProvider[];
}

export const CONNECTION_CATEGORY_LABELS: Record<ConnectionCategory, string> = {
  productivity: '效率工具',
  communication: '沟通协作',
  storage: '文件与存储',
  development: '研发协作',
  social: '社交媒体',
};

const CONNECTION_CATEGORY_ORDER: readonly ConnectionCategory[] = [
  'productivity',
  'communication',
  'storage',
  'development',
  'social',
];

export function groupConnectionProviders<TProvider extends ConnectionProviderLike>(
  providers: readonly TProvider[],
): readonly ConnectionProviderGroup<TProvider>[] {
  const grouped = new Map<ConnectionCategory, TProvider[]>();
  for (const provider of providers) {
    const items = grouped.get(provider.category) ?? [];
    items.push(provider);
    grouped.set(provider.category, items);
  }

  return CONNECTION_CATEGORY_ORDER.map((category) => ({
    category,
    label: CONNECTION_CATEGORY_LABELS[category],
    items: grouped.get(category) ?? [],
  })).filter((group) => group.items.length > 0);
}

export function connectionProviderStatus(provider: ConnectionProviderLike): string {
  if (provider.oauthSupported && !provider.comingSoon) return '可连接';
  if (provider.oauthSupported) return '授权准备中';
  return '按需开通';
}

export function connectionPageSummary(options: {
  readonly count: unknown;
  readonly categoryCount: unknown;
  readonly loading: boolean;
  readonly error: string | null;
}): string {
  const count = safeConnectionCount(options.count);
  const categoryCount = safeConnectionCount(options.categoryCount);
  if (options.loading) return '连接器加载中…';
  if (options.error) return '连接器加载失败';
  if (count === 0) return '暂无规划连接器';
  return `已规划 ${count} 个连接器 · ${categoryCount} 类工具`;
}

export function connectionAccessMailBody(providerName: string): string {
  return `请协助开通 ${providerName} 连接器。\n\n注册邮箱：\n使用场景：\n需要执行的典型操作：`;
}

export function normalizeConnectionProviders(value: unknown): ConnectionProviderView[] {
  if (!Array.isArray(value)) {
    throw new Error('连接器数据格式异常，请稍后重试。');
  }
  return value.flatMap((item): ConnectionProviderView[] => {
    if (typeof item !== 'object' || item === null) return [];
    const raw = item as Record<string, unknown>;
    const id = safeText(raw.id);
    const name = safeText(raw.name);
    const category = safeConnectionCategory(raw.category);
    if (!id || !name || !category) return [];
    return [
      {
        id,
        name,
        icon: safeText(raw.icon) || 'Plug',
        description: safeText(raw.description) || '暂未提供说明。',
        category,
        oauthSupported: raw.oauthSupported === true,
        comingSoon: raw.comingSoon !== false,
      },
    ];
  });
}

export function safeConnectionCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function safeConnectionCategory(value: unknown): ConnectionCategory | null {
  if (typeof value !== 'string') return null;
  return CONNECTION_CATEGORY_ORDER.includes(value as ConnectionCategory)
    ? (value as ConnectionCategory)
    : null;
}

function safeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
