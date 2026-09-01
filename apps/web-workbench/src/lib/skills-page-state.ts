import type { UiSkill } from '@/types/task';

export type SkillCategory = UiSkill['category'];

export interface SkillGroup<TSkill extends Pick<UiSkill, 'category'>> {
  readonly category: SkillCategory;
  readonly items: readonly TSkill[];
}

export const SKILL_CATEGORY_ORDER: readonly SkillCategory[] = [
  '内容运营',
  '分析决策',
  '管理协作',
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
  readonly skillId: string;
  readonly skillName: string;
  readonly skillSource: 'manual';
  readonly prompt: string;
}

export type SkillStartDecision = 'start' | 'enable-and-start' | 'blocked';

const SHOWCASE_SKILL_IDS = [
  'data-report-insight',
  'social-media-strategy',
  'contract-risk-review',
] as const;

const CONNECTOR_LABELS: Readonly<Record<string, string>> = {
  browser: '浏览器',
  douyin: '抖音',
  xiaohongshu: '小红书',
  'wechat-official-account': '微信公众号',
  'image-understanding': '图片理解',
  'image-generation': '图片生成',
  'a-share-market-data': 'A 股行情数据',
  'document-parser': '文档解析',
  'web-search': '网页搜索',
  spreadsheet: '表格',
  database: '数据库',
  'recruiting-sites': '招聘网站',
};

const DEFAULT_SKILL_BOUNDARY = '执行前请确认输入材料、授权范围和最终用途。';

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
  if (options.cap <= 0) {
    return `${skillPlanLabel(options.planId)}暂不支持启用技能`;
  }
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
      : '请稍后重试，或刷新页面后再打开技能。';
  return {
    title: '技能暂时无法加载',
    body,
  };
}

export function skillLimitMessage(options: {
  readonly cap: number;
  readonly planId: string;
}): string {
  if (options.cap <= 0) return `${skillPlanLabel(options.planId)}暂不支持启用技能`;
  if (options.planId === 'pro') return `已达到 ${options.cap} 个技能上限`;
  return `已达到当前套餐的技能上限（${options.cap} 个）· 升级到专业版可使用全部 13 个技能`;
}

export function skillLimitBannerCopy(options: {
  readonly cap: number;
  readonly enabledCount: number;
  readonly planId: string;
}): SkillLimitBannerCopy {
  if (options.cap <= 0) {
    return {
      title: `${skillPlanLabel(options.planId)}暂不支持启用技能`,
      body: '升级到基础版可自选技能；升级到专业版可使用全部 13 个技能。',
    };
  }
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
        : '升级到专业版可使用全部 13 个技能。',
  };
}

export function skillCardBadge(options: {
  readonly enabled: boolean;
  readonly pending: boolean;
  readonly limitBlocked?: boolean;
  readonly cap?: number;
}): string {
  if (options.pending) return '保存中…';
  if (!options.enabled && options.limitBlocked && (options.cap ?? 1) <= 0) return '不可启用';
  if (!options.enabled && options.limitBlocked) return '已达上限';
  return options.enabled ? '已启用' : '启用';
}

export function skillCardUsageHint(options: {
  readonly enabled: boolean;
  readonly pending: boolean;
  readonly limitBlocked?: boolean;
  readonly cap?: number;
}): string {
  if (options.pending) return '正在保存选择';
  if (options.enabled && (options.cap ?? 1) <= 0) {
    return '当前套餐不可使用，可停用';
  }
  if (!options.enabled && options.limitBlocked && (options.cap ?? 1) <= 0) {
    return '当前套餐不可启用';
  }
  if (!options.enabled && options.limitBlocked) return '先停用一个技能后可启用';
  return options.enabled ? '会自动匹配；可在输入框 @ 调用' : '启用后可参与自动匹配';
}

export function skillTaskDraft(
  skill: Pick<UiSkill, 'id' | 'name' | 'description'>,
  starterPrompt?: string,
): SkillTaskDraft {
  const id = safeSkillText(skill.id);
  const name = safeSkillText(skill.name) || '技能';
  const prompt = safeSkillText(starterPrompt);
  return {
    skillId: id,
    skillName: name,
    skillSource: 'manual',
    prompt: prompt ? `@${name} ${prompt}` : `@${name} `,
  };
}

export function skillStartDecision(options: {
  readonly enabled: boolean;
  readonly enabledCount: number;
  readonly cap: number;
}): SkillStartDecision {
  if (options.enabled) return 'start';
  if (options.cap <= 0 || options.enabledCount >= options.cap) return 'blocked';
  return 'enable-and-start';
}

export function pickCapabilityShowcase<TSkill extends { readonly id: string }>(
  skills: readonly TSkill[],
): readonly TSkill[] {
  const byId = new Map(skills.map((skill) => [skill.id, skill]));
  const selected: TSkill[] = [];
  for (const id of SHOWCASE_SKILL_IDS) {
    const skill = byId.get(id);
    if (skill) selected.push(skill);
  }
  for (const skill of skills) {
    if (selected.length >= SHOWCASE_SKILL_IDS.length) break;
    if (!selected.some((item) => item.id === skill.id)) selected.push(skill);
  }
  return selected;
}

export function skillConnectorLabel(connectorId: string): string {
  const id = safeSkillText(connectorId);
  return CONNECTOR_LABELS[id] ?? id;
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
    logoId: safeSkillText(value.logoId) || id,
    category: normalizeSkillCategory(value.category),
    description: safeSkillText(value.description) || '暂无技能说明',
    aliases: normalizeTextArray(value.aliases),
    maturity: normalizeSkillMaturity(value.maturity),
    connectors: normalizeTextArray(value.connectors),
    experience: normalizeSkillExperience(value.experience),
    enabled: value.enabled === true,
  };
}

function normalizeSkillExperience(value: unknown): UiSkill['experience'] {
  const experience = isRecord(value) ? value : {};
  return {
    starterPrompts: normalizeTextArray(experience.starterPrompts).slice(0, 3),
    requiredInputs: normalizeTextArray(experience.requiredInputs),
    deliverables: normalizeTextArray(experience.deliverables),
    boundary: safeSkillText(experience.boundary) || DEFAULT_SKILL_BOUNDARY,
    exampleSummary: safeSkillText(experience.exampleSummary) || '暂无示例说明',
  };
}

function normalizeSkillCategory(value: unknown): SkillCategory {
  return value === '内容运营' ||
    value === '分析决策' ||
    value === '管理协作'
    ? value
    : '内容运营';
}

function normalizeSkillMaturity(value: unknown): UiSkill['maturity'] {
  return value === 'workflow' || value === 'connected' || value === 'template'
    ? value
    : 'template';
}

function normalizeTextArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const text = safeSkillText(item);
    return text ? [text] : [];
  });
}

function safeSkillText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
