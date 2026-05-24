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
  if (options.error) return '技能加载失败';
  if (options.totalCount === 0) return '暂无可用技能';
  if (options.cap > 0) {
    return `已启用 ${options.enabledCount} / ${options.cap} · ${skillPlanLabel(options.planId)}`;
  }
  return `已加载 ${options.totalCount} 个技能 · ${skillPlanLabel(options.planId)}`;
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
