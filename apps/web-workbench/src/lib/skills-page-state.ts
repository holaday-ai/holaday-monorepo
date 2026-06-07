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

export interface SkillLimitBannerCopy {
  readonly title: string;
  readonly body: string;
}

export interface SkillTaskDraft {
  readonly skillName: string;
  readonly expertMode: 'expert';
  readonly prompt: string;
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
    if (options.enabledCount > options.cap) {
      return `已启用 ${options.enabledCount} 个 · ${skillPlanLabel(options.planId)}上限 ${options.cap}`;
    }
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

export function skillLimitBannerCopy(options: {
  readonly cap: number;
  readonly enabledCount: number;
  readonly planId: string;
}): SkillLimitBannerCopy {
  if (options.enabledCount > options.cap) {
    return {
      title: `当前已启用 ${options.enabledCount} 个技能`,
      body: `${skillPlanLabel(options.planId)}上限为 ${options.cap} 个。已启用的技能会继续可用；如果停用后想启用新技能，需要先保持在上限内。`,
    };
  }
  return {
    title: `已达到 ${options.cap} 个技能上限`,
    body:
      options.planId === 'pro'
        ? '你已启用当前套餐支持的全部技能。'
        : '升级到专业版可使用全部 33 个技能。',
  };
}

export function skillCardBadge(options: {
  readonly enabled: boolean;
  readonly pending: boolean;
  readonly limitBlocked?: boolean;
}): string {
  if (options.pending) return '保存中…';
  if (!options.enabled && options.limitBlocked) return '已达上限';
  return options.enabled ? '已启用' : '启用';
}

export function skillCardUsageHint(options: {
  readonly enabled: boolean;
  readonly pending: boolean;
  readonly limitBlocked?: boolean;
}): string {
  if (options.pending) return '正在保存选择';
  if (!options.enabled && options.limitBlocked) return '先停用一个技能后可启用';
  return options.enabled ? '可自动匹配，也可直接使用' : '启用后可参与自动匹配';
}

export function skillTaskDraft(
  skill: Pick<UiSkill, 'name' | 'description'>,
): SkillTaskDraft {
  const name = safeSkillText(skill.name) || '专家';
  const description = safeSkillText(skill.description);
  return {
    skillName: name,
    expertMode: 'expert',
    prompt: description
      ? `使用「${name}」专家技能：${description}\n\n请帮我：`
      : `使用「${name}」专家技能：\n\n请帮我：`,
  };
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
