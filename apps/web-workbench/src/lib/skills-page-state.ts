import type { UiSkill } from '@/types/task';

export type SkillCategory = UiSkill['category'];

export interface SkillGroup<TSkill extends Pick<UiSkill, 'category'>> {
  readonly category: SkillCategory;
  readonly items: readonly TSkill[];
}

export const SKILL_CATEGORY_ORDER: readonly SkillCategory[] = ['内容运营', '分析决策', '管理协作'];

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

export interface SkillIntentMatch<TSkill extends UiSkill = UiSkill> {
  readonly skill: TSkill;
  readonly score: number;
}

export interface SkillIntentMatchResult<TSkill extends UiSkill = UiSkill> {
  readonly confidence: 'strong' | 'low';
  readonly matches: readonly SkillIntentMatch<TSkill>[];
}

const SHOWCASE_SKILL_IDS = [
  'data-report-insight',
  'social-media-strategy',
  'contract-risk-review',
] as const;

const NON_SPECIFIC_INTENT_TERMS = new Set([
  '分析',
  '评估',
  '判断',
  '处理',
  '查看',
  '比较',
  '对比',
  '总结',
  '建议',
  '方案',
  '计划',
  '风险',
  '市场',
  '数据',
  '内容',
  '项目',
  '产品',
]);

const STOCK_DECISION_CONFLICTS: readonly RegExp[] = [
  /荐股/,
  /(?:帮我|替我|给我|请|直接)?(?:推荐|选|挑)(?:出|一下)?(?:一只|几只|一些)?(?:股票|个股|a股)/,
  /(?:买|卖|选|挑)(?:哪只|哪些)(?:股票|个股|a股)/,
  /(?:股票|个股|a股).{0,5}(?:能不能|可不可以|要不要|该不该|是否|值不值得).{0,3}(?:买|卖|买入|卖出)/,
  /(?:能不能|可不可以|要不要|该不该|是否|值不值得).{0,3}(?:买|卖|买入|卖出).{0,5}(?:股票|个股|a股)/,
  /(?:股票|个股|a股).{0,4}值得买/,
  /(?:帮我|替我|给我|请|直接|立即|马上|代我|为我)(?:直接|立即|马上|执行|决定|去)?(?:买入|卖出|买|卖|下单|清仓|建仓|加仓|减仓)/,
  /(?:帮我|替我|给我|请|直接|立即|马上|代我|为我)(?:直接|立即|马上|执行|决定|去)?交易(?:这只|那只|该只|某只)?(?:股票|个股|a股)/,
  /(?:帮我|替我|给我|请|直接|立即|马上|代我|为我)(?:直接|立即|马上|执行|决定|去|做|进行)?交易(?!量|数据|记录|明细|统计|分析|信号)/,
  /(?:执行|进行)(?:股票|个股|a股)?交易(?!量|数据|记录|明细|统计|分析|信号)/,
  /把.{0,8}(?:股票|个股|a股).{0,4}(?:买入|卖出|买下|卖掉|下单|清仓|建仓|加仓|减仓)/,
  /^(?:买入|卖出|买|卖|下单)(?:这只|那只|该只|某只|一只|几只|一些)?(?:股票|个股|a股)/,
  /(?:分析完后|解释完后|研究完后|看完后|然后|之后|再|最后)(?:直接|立即|马上)?(?:买入|卖出|买|卖|下单|清仓|建仓|加仓|减仓)(?:这只|那只|该只|某只|一只|几只|一些)?(?:股票|个股|a股)/,
  /(?:股票|个股|a股).{0,4}(?:买入|卖出|买下|卖掉|下单|清仓|建仓|加仓|减仓)$/,
  /(?:买入|卖出|投资)(?:建议|意见|结论)/,
];

const HIRING_DECISION_EXPLANATION = /(?:分析|解释|说明|复盘|研究).{0,10}(?:为什么|为何|原因|依据|逻辑)/;

const SENSITIVE_IDENTITY_TERM =
  '(?:性别|年龄|民族|种族|宗教|残障|残疾|婚姻|婚育|孕育|怀孕|户籍|籍贯|国籍|政治面貌|健康状况|疾病|男性|女性|男士|女士|孕妇|已婚|未婚)';

const HIRING_DISCRIMINATION_CONFLICTS: readonly RegExp[] = [
  new RegExp(
    `(?:基于|按照|根据|按|依据|以).{0,4}${SENSITIVE_IDENTITY_TERM}.{0,8}(?:筛选|过滤|招聘|招|找|选择|选|挑|排序|排名|分组|淘汰|拒绝|录用)`,
  ),
  new RegExp(`(?:只招|只要|仅限|只选|优先|排除|不要|拒绝).{0,6}${SENSITIVE_IDENTITY_TERM}`),
  new RegExp(`${SENSITIVE_IDENTITY_TERM}.{0,6}(?:优先|排除|不要|拒绝|淘汰|录用)`),
];

const HIRING_DIRECT_DECISION_CONFLICTS: readonly RegExp[] = [
  /(?:帮我|替我|给我|请|直接|立即|马上|代我|为我)(?:直接|最终|马上|立即|决定|选择)?(?:录用|淘汰|拒绝)/,
  /(?:帮我|替我|给我|请|直接|代我|为我)(?:直接|最终)?(?:选择|选|挑)(?:一位|一个|几位|一些)?(?:候选人|人才).{0,4}(?:录用|淘汰|拒绝)/,
  /(?:帮我|替我|给我|请|代我|为我)(?:做|给出|作出)?(?:录用|招聘|用人)?(?:决定|决策|结论)/,
  /^(?:决定|决策).{0,4}(?:是否|要不要|该不该|能否)?(?:录用|淘汰|拒绝)/,
  /(?:再|然后|之后|最后)(?:决定|决策).{0,4}(?:是否|要不要|该不该|能否)?(?:录用|淘汰|拒绝)/,
  /(?:选出|选择|挑出).{0,3}(?:最终录用|录用|最终)(?:人选|候选人|人才)/,
  /^(?:录用|淘汰|拒绝)(?:这份|该份|一份|这些|这位|该位|这个|该|哪个|哪些)?(?:简历|候选人|人才)/,
  /(?:并|然后|之后|再|最后)(?:直接|最终|马上|立即)?(?:录用|淘汰|拒绝)/,
];

const HIRING_DECISION_CONFLICTS: readonly RegExp[] = [
  /(?:录用|淘汰|拒绝)(?:这份|该份|一份|这些|这位|该位|这个|该|哪个|哪些)?(?:简历|候选人|人才)/,
  /(?:简历|候选人|人才)(?:是否|要不要|该不该|应不应该|能否)(?:录用|淘汰|拒绝)/,
];

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
  if (options.loading) return '任务选项加载中…';
  if (options.error) return '任务选项暂时无法加载';
  if (options.totalCount === 0) return '暂无可开始的任务';
  if (options.cap <= 0) {
    return `${skillPlanLabel(options.planId)}可查看任务示例`;
  }
  if (options.cap > 0) {
    if (options.enabledCount > options.cap) {
      return `已保留 ${options.enabledCount} 项常用能力 · ${skillPlanLabel(options.planId)}上限 ${options.cap}`;
    }
    return `常用能力 ${options.enabledCount} / ${options.cap} · ${skillPlanLabel(options.planId)}`;
  }
  return `已加载 ${options.totalCount} 项任务 · ${skillPlanLabel(options.planId)}`;
}

export function skillLoadErrorCopy(message: string | null | undefined): SkillLoadErrorCopy {
  const body =
    typeof message === 'string' && message.trim()
      ? message.trim()
      : '请稍后重试，或刷新页面后再打开能力中心。';
  return {
    title: '任务选项暂时无法加载',
    body,
  };
}

export function skillLimitMessage(options: {
  readonly cap: number;
  readonly planId: string;
}): string {
  if (options.cap <= 0) return '当前套餐暂不支持开始此任务';
  if (options.planId === 'pro') return `当前套餐的常用能力已满（${options.cap} 项）`;
  return `常用能力已满（${options.cap} 项）· 可先移除一项或升级套餐`;
}

export function skillLimitBannerCopy(options: {
  readonly cap: number;
  readonly enabledCount: number;
  readonly planId: string;
}): SkillLimitBannerCopy {
  if (options.cap <= 0) {
    return {
      title: '当前套餐可查看任务示例',
      body: '升级到基础版后即可选择并开始任务；专业版可使用全部 13 类任务。',
    };
  }
  if (options.enabledCount > options.cap) {
    return {
      title: `当前已保留 ${options.enabledCount} 项常用能力`,
      body: `${skillPlanLabel(options.planId)}最多保留 ${options.cap} 项。现有任务仍可使用；移除后才能添加新的常用能力。`,
    };
  }
  return {
    title: `常用能力已满（${options.cap} 项）`,
    body:
      options.planId === 'pro'
        ? '当前套餐支持的能力已全部加入常用。'
        : '开始其他任务前，可先移除一项常用能力，或升级套餐。',
  };
}

export function skillCardBadge(options: {
  readonly enabled: boolean;
  readonly pending: boolean;
  readonly limitBlocked?: boolean;
  readonly cap?: number;
}): string {
  if (options.pending) return '保存中…';
  if (!options.enabled && options.limitBlocked && (options.cap ?? 1) <= 0) return '暂不可用';
  if (!options.enabled && options.limitBlocked) return '已达上限';
  return options.enabled ? '常用' : '加入常用';
}

export function skillCardUsageHint(options: {
  readonly enabled: boolean;
  readonly pending: boolean;
  readonly limitBlocked?: boolean;
  readonly cap?: number;
}): string {
  if (options.pending) return '正在保存';
  if (options.enabled && (options.cap ?? 1) <= 0) {
    return '当前套餐暂不可使用';
  }
  if (!options.enabled && options.limitBlocked && (options.cap ?? 1) <= 0) {
    return '当前套餐暂不可使用';
  }
  if (!options.enabled && options.limitBlocked) return '先移除一项常用能力';
  return options.enabled ? '已加入常用' : '可加入常用';
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

export function matchSkillsForIntent<TSkill extends UiSkill>(
  skills: readonly TSkill[],
  intent: string,
): SkillIntentMatchResult<TSkill> {
  const normalizedIntent = normalizeMatchText(intent);
  const intentPairs = characterPairs(normalizedIntent);
  const skillDocuments = skills.map((skill) => normalizeSkillIntentDocument(skill));
  const scoredSkills = skills.map((skill, index) => {
    const evidence = scoreSkillIntent(skill, normalizedIntent, intentPairs);
    const specificExactScore = [...evidence.exactBonuses].reduce(
      (sum, [term, value]) =>
        sum +
        (!NON_SPECIFIC_INTENT_TERMS.has(term) &&
        skillDocuments.filter((document) => document.includes(term)).length === 1
          ? value
          : 0),
      0,
    );
    return {
      skill,
      score: evidence.pairScore + specificExactScore,
      index,
    };
  });
  const matches = scoredSkills
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ skill, score }) => ({ skill, score }));
  const topScore = matches[0]?.score ?? 0;
  const secondScore = matches[1]?.score ?? 0;
  const boundaryConflict = matches[0]
    ? intentViolatesSkillBoundary(matches[0].skill.id, normalizedIntent)
    : false;
  const confidence =
    !boundaryConflict &&
    normalizedIntent.length >= 2 &&
    topScore >= 9 &&
    topScore - secondScore >= 4
      ? 'strong'
      : 'low';
  return { confidence, matches };
}

function intentViolatesSkillBoundary(skillId: string, normalizedIntent: string): boolean {
  if (skillId === 'a-share-market-briefing') {
    return STOCK_DECISION_CONFLICTS.some((pattern) => pattern.test(normalizedIntent));
  }
  if (skillId === 'resume-search-screening') {
    if (HIRING_DISCRIMINATION_CONFLICTS.some((pattern) => pattern.test(normalizedIntent))) {
      return true;
    }
    if (HIRING_DIRECT_DECISION_CONFLICTS.some((pattern) => pattern.test(normalizedIntent))) {
      return true;
    }
    if (HIRING_DECISION_EXPLANATION.test(normalizedIntent)) return false;
    return HIRING_DECISION_CONFLICTS.some((pattern) => pattern.test(normalizedIntent));
  }
  return false;
}

function scoreSkillIntent(
  skill: UiSkill,
  normalizedIntent: string,
  intentPairs: ReadonlySet<string>,
): {
  readonly pairScore: number;
  readonly exactBonuses: ReadonlyMap<string, number>;
} {
  if (!normalizedIntent) return { pairScore: 0, exactBonuses: new Map() };
  const weightedFields: ReadonlyArray<readonly [string, number, number]> = [
    [skill.name, 18, 6],
    ...skill.aliases.map((value) => [value, 14, 5] as const),
    [skill.description, 0, 3],
    ...skill.experience.starterPrompts.map((value) => [value, 0, 2] as const),
    ...skill.experience.requiredInputs.map((value) => [value, 0, 2] as const),
    ...skill.experience.deliverables.map((value) => [value, 0, 2] as const),
    [skill.experience.exampleSummary, 0, 2],
  ];
  const exactBonuses = new Map<string, number>();
  const pairWeights = new Map<string, number>();
  for (const [value, exactWeight, pairWeight] of weightedFields) {
    const normalizedValue = normalizeMatchText(value);
    if (normalizedValue.length < 2) continue;
    if (exactWeight > 0 && normalizedIntent.includes(normalizedValue)) {
      exactBonuses.set(
        normalizedValue,
        Math.max(exactBonuses.get(normalizedValue) ?? 0, exactWeight),
      );
    }
    for (const pair of characterPairs(normalizedValue)) {
      if (!intentPairs.has(pair)) continue;
      pairWeights.set(pair, Math.max(pairWeights.get(pair) ?? 0, pairWeight));
    }
  }
  return {
    pairScore: [...pairWeights.values()].reduce((sum, value) => sum + value, 0),
    exactBonuses,
  };
}

function normalizeSkillIntentDocument(skill: UiSkill): string {
  return [
    skill.name,
    ...skill.aliases,
    skill.description,
    ...skill.experience.starterPrompts,
    ...skill.experience.requiredInputs,
    ...skill.experience.deliverables,
    skill.experience.exampleSummary,
  ]
    .map(normalizeMatchText)
    .join('\n');
}

function normalizeMatchText(value: string): string {
  return value.trim().toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function characterPairs(value: string): Set<string> {
  const pairs = new Set<string>();
  for (let index = 0; index < value.length - 1; index += 1) {
    pairs.add(value.slice(index, index + 2));
  }
  return pairs;
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
    enabled: typeof value.enabled === 'boolean' ? value.enabled : fallbackEnabled,
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
    description: safeSkillText(value.description) || '暂未提供说明',
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
  return value === '内容运营' || value === '分析决策' || value === '管理协作' ? value : '内容运营';
}

function normalizeSkillMaturity(value: unknown): UiSkill['maturity'] {
  return value === 'workflow' || value === 'connected' || value === 'template' ? value : 'template';
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
