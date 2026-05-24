import {
  BASIC_ROLE_PICK_LIMIT,
  ROLE_CHANGES_PER_MONTH,
  type RoleDefinition,
} from '@holaday/shared-types';

export interface RoleGroup {
  readonly key: RoleDefinition['category'];
  readonly nameZh: string;
  readonly items: readonly RoleDefinition[];
}

export const ROLE_CATEGORY_ORDER: readonly Pick<RoleGroup, 'key' | 'nameZh'>[] = [
  { key: 'marketing', nameZh: '营销 & 内容' },
  { key: 'ecommerce', nameZh: '电商 & 运营' },
  { key: 'product', nameZh: '产品 & 项目' },
  { key: 'data', nameZh: '数据 & 分析' },
  { key: 'support', nameZh: '支持 & 合规' },
  { key: 'hr', nameZh: 'HR & 供应链' },
  { key: 'specialty', nameZh: '专项' },
];

export function rolePlanLabel(plan: string | null | undefined): string {
  if (plan === 'pro') return '专业版';
  if (plan === 'basic') return '基础版';
  if (plan === 'free') return '体验版';
  return '当前套餐';
}

export function groupRoleCatalogue(catalogue: readonly RoleDefinition[]): readonly RoleGroup[] {
  return ROLE_CATEGORY_ORDER.map((category) => ({
    ...category,
    items: catalogue.filter((role) => role.category === category.key),
  })).filter((group) => group.items.length > 0);
}

export function rolePageSummary(options: {
  readonly loading: boolean;
  readonly error: string | null;
  readonly plan: string | null | undefined;
  readonly selectedCount: number;
  readonly totalCount: number;
  readonly pickLimit?: number;
}): string {
  if (options.loading) return '角色加载中…';
  if (options.error) return '角色加载失败';
  if (options.totalCount === 0) return '暂无可用角色';
  if (options.plan === 'pro') return `全部 ${options.totalCount} 个角色 · 专业版`;
  if (options.plan === 'basic') {
    return `已选 ${options.selectedCount} / ${options.pickLimit ?? BASIC_ROLE_PICK_LIMIT} · 基础版`;
  }
  return `解锁 ${options.totalCount} 个角色 · ${rolePlanLabel(options.plan)}`;
}

export function roleRemainingChanges(changesThisMonth: number, changesLimit = ROLE_CHANGES_PER_MONTH): number {
  return Math.max(0, changesLimit - changesThisMonth);
}

export function roleLimitMessage(limit = BASIC_ROLE_PICK_LIMIT): string {
  return `最多选择 ${limit} 个角色`;
}
