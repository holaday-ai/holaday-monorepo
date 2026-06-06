import type { UiSkill } from '@/types/task';

export type SkillCategory = UiSkill['category'];

export interface SkillGroup<TSkill extends Pick<UiSkill, 'category'>> {
  readonly category: SkillCategory;
  readonly items: readonly TSkill[];
}

export const SKILL_CATEGORY_ORDER: readonly SkillCategory[] = [
  '运营',
  '内容',
  '商业分析',
  '产品',
  '法律',
  '人力',
  '行政',
  '财务',
  '翻译',
  '其他',
];

export interface SkillToggleSnapshot {
  readonly enabled: boolean;
}

export interface SkillLoadErrorCopy {
  readonly title: string;
  readonly body: string;
}

const PLAN_LABELS: Record<string, string> = {
  free: '体验版',
  basic: '基础版',
  pro: '专业版',
};

export function skillPlanLabel(planId: string): string {
  return PLAN_LABELS[planId] ?? '当前套餐';
}

export function groupSkillsByCategory<TSkill extends Pick<UiSkill, 'category'>>(
  skills: readonly TSkill[],
): readonly SkillGroup<TSkill>[] {
  const grouped = new Map<SkillCategory, TSkill[]>();
  for (const skill of skills) {
    const items = grouped.get(skill.category) ?? [];
    items.push(skill);
    grouped.set(skill.category, items);
  }

  return SKILL_CATEGORY_ORDER.map((category) => ({
    category,
    items: grouped.get(category) ?? [],
  })).filter((group) => group.items.length > 0);
}

export function skillPageSummary(options: {
  readonly loading: boolean;
  readonly error: string | null;
  readonly totalCount: number;
  readonly enabledCount: number;
  readonly cap: number;
  readonly planId: string;
}): string {
  if (options.loading) return '技能加载中…';
  if (options.error) return '技能暂时无法加载';
  if (options.totalCount === 0) return '暂无可用技能';
  if (options.cap > 0) {
    return `已启用 ${options.enabledCount} / ${options.cap} · ${skillPlanLabel(options.planId)}`;
  }
  return `已加载 ${options.totalCount} 个技能 · ${skillPlanLabel(options.planId)}`;
}

export function skillLoadErrorCopy(message: string | null | undefined): SkillLoadErrorCopy {
  const body =
    typeof message === 'string' && message.trim()
      ? message.trim()
      : '请稍后重试，或刷新页面后再打开专家技能。';
  return {
    title: '技能暂时无法加载',
    body,
  };
}

export function skillLimitMessage(options: {
  readonly cap: number;
  readonly planId: string;
}): string {
  if (options.planId === 'pro') return `已达到 ${options.cap} 个技能上限`;
  return `已达到当前套餐的技能上限（${options.cap} 个）· 升级到专业版可使用全部 33 个技能`;
}

export function skillCardBadge(options: {
  readonly enabled: boolean;
  readonly pending: boolean;
}): string {
  if (options.pending) return '保存中…';
  return options.enabled ? '已启用' : '启用';
}

export function normalizeSkillRows(value: unknown): UiSkill[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((entry) => {
    const skill = normalizeSkillRow(entry);
    if (!skill || seen.has(skill.id)) return [];
    seen.add(skill.id);
    return [skill];
  });
}

export function normalizeSkillToggleResponse(
  value: unknown,
  fallbackEnabled: boolean,
): SkillToggleSnapshot {
  if (!isRecord(value)) return { enabled: fallbackEnabled };
  return {
    enabled:
      typeof value.enabled === 'boolean' ? value.enabled : fallbackEnabled,
  };
}

function normalizeSkillRow(value: unknown): UiSkill | null {
  if (!isRecord(value)) return null;
  const id = safeSkillText(value.id);
  if (!id) return null;
  const name = safeSkillText(value.name) || id;
  return {
    id,
    name,
    icon: safeSkillText(value.icon) || 'Sparkles',
    category: normalizeSkillCategory(value.category),
    description: safeSkillText(value.description) || '暂无技能说明',
    enabled: value.enabled === true,
  };
}

function normalizeSkillCategory(value: unknown): SkillCategory {
  return value === '运营' ||
    value === '内容' ||
    value === '商业分析' ||
    value === '产品' ||
    value === '法律' ||
    value === '人力' ||
    value === '行政' ||
    value === '财务' ||
    value === '翻译' ||
    value === '其他'
    ? value
    : '其他';
}

function safeSkillText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
