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

export interface RoleListSnapshot {
  readonly plan: string;
  readonly selected: readonly string[];
  readonly catalogue: readonly RoleDefinition[];
  readonly pickLimit: number;
  readonly changesThisMonth: number;
  readonly changesLimit: number;
  readonly overLimit: boolean;
  readonly needsRoleRepair: boolean;
}

export interface RoleSelectSnapshot {
  readonly selected: readonly string[];
  readonly changesThisMonth: number;
  readonly changesLimit: number;
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

export function normalizeRoleListResponse(value: unknown): RoleListSnapshot {
  const root = isRecord(value) ? value : {};
  const catalogue = normalizeRoleCatalogue(root.catalogue);
  const rawSelected = safeRoleStringArray(root.selected);
  const catalogueIds = new Set(catalogue.map((role) => role.id));
  const selected = dedupeRoleIds(
    rawSelected.filter((id) => catalogueIds.has(id)),
  );
  const plan = safeRoleText(root.plan) || 'free';
  const pickLimit = safePositiveRoleCount(root.pickLimit, BASIC_ROLE_PICK_LIMIT);
  const changesThisMonth = safeRoleCount(root.changesThisMonth);
  const changesLimit = safePositiveRoleCount(
    root.changesLimit,
    ROLE_CHANGES_PER_MONTH,
  );

  return {
    plan,
    selected,
    catalogue,
    pickLimit,
    changesThisMonth,
    changesLimit,
    overLimit:
      root.overLimit === true ||
      (plan === 'basic' && selected.length > pickLimit),
    needsRoleRepair:
      root.needsRoleRepair === true ||
      (plan === 'basic' && selected.length !== rawSelected.length),
  };
}

export function normalizeRoleSelectResponse(
  value: unknown,
  fallback: RoleSelectSnapshot,
): RoleSelectSnapshot {
  if (!isRecord(value)) return fallback;
  const selected = safeRoleStringArray(value.selected);
  return {
    selected: selected.length > 0 ? selected : fallback.selected,
    changesThisMonth:
      'changesThisMonth' in value
        ? safeRoleCount(value.changesThisMonth)
        : fallback.changesThisMonth,
    changesLimit: safePositiveRoleCount(value.changesLimit, fallback.changesLimit),
  };
}

function normalizeRoleCatalogue(value: unknown): RoleDefinition[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const role = normalizeRoleDefinition(entry);
    return role ? [role] : [];
  });
}

function normalizeRoleDefinition(value: unknown): RoleDefinition | null {
  if (!isRecord(value)) return null;
  const id = safeRoleText(value.id);
  if (!id) return null;
  const nameZh = safeRoleText(value.nameZh) || id;
  const nameEn = safeRoleText(value.nameEn) || nameZh;
  return {
    id,
    nameZh,
    nameEn,
    descriptionZh: safeRoleText(value.descriptionZh),
    descriptionEn: safeRoleText(value.descriptionEn),
    tier: value.tier === 'pro' ? 'pro' : 'open',
    category: normalizeRoleCategory(value.category),
  };
}

function normalizeRoleCategory(value: unknown): RoleDefinition['category'] {
  return value === 'marketing' ||
    value === 'ecommerce' ||
    value === 'product' ||
    value === 'data' ||
    value === 'support' ||
    value === 'hr' ||
    value === 'specialty'
    ? value
    : 'specialty';
}

function safeRoleStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return dedupeRoleIds(value.map(safeRoleText).filter(Boolean));
}

function dedupeRoleIds(value: readonly string[]): string[] {
  return Array.from(new Set(value));
}

function safePositiveRoleCount(value: unknown, fallback: number): number {
  const count = safeRoleCount(value);
  return count > 0 ? count : fallback;
}

function safeRoleCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function safeRoleText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
