import { describe, expect, it } from 'vitest';
import {
  type SkillCategory,
  groupSkillsByCategory,
  normalizeSkillRows,
  normalizeSkillToggleResponse,
  pickCapabilityShowcase,
  skillCardBadge,
  skillCardUsageHint,
  skillConnectorLabel,
  skillLimitBannerCopy,
  skillLimitMessage,
  skillLoadErrorCopy,
  skillPageSummary,
  skillPlanLabel,
  skillStartDecision,
  skillTaskDraft,
} from './skills-page-state';

interface SkillFixture {
  category: SkillCategory;
  id: string;
}

const skills: readonly SkillFixture[] = [
  { id: 'analytics', category: '分析决策' },
  { id: 'content', category: '内容运营' },
  { id: 'management', category: '管理协作' },
];

describe('skills page state helpers', () => {
  it('groups skills in product category order', () => {
    const groups = groupSkillsByCategory(skills);

    expect(groups.map((group) => group.category)).toEqual(['内容运营', '分析决策', '管理协作']);
    expect(groups[0]?.items.map((item) => item.id)).toEqual(['content']);
  });

  it('labels known and unknown plans', () => {
    expect(skillPlanLabel('free')).toBe('体验版');
    expect(skillPlanLabel('basic')).toBe('基础版');
    expect(skillPlanLabel('pro')).toBe('专业版');
    expect(skillPlanLabel('enterprise')).toBe('当前套餐');
  });

  it('summarizes loading, failed, empty, capped, and uncapped states', () => {
    expect(
      skillPageSummary({
        loading: true,
        error: null,
        totalCount: 0,
        enabledCount: 0,
        cap: 0,
        planId: 'free',
      }),
    ).toBe('任务选项加载中…');
    expect(
      skillPageSummary({
        loading: false,
        error: 'offline',
        totalCount: 0,
        enabledCount: 0,
        cap: 0,
        planId: 'free',
      }),
    ).toBe('任务选项暂时无法加载');
    expect(
      skillPageSummary({
        loading: false,
        error: null,
        totalCount: 0,
        enabledCount: 0,
        cap: 0,
        planId: 'free',
      }),
    ).toBe('暂无可开始的任务');
    expect(
      skillPageSummary({
        loading: false,
        error: null,
        totalCount: 33,
        enabledCount: 2,
        cap: 5,
        planId: 'basic',
      }),
    ).toBe('常用能力 2 / 5 · 基础版');
    expect(
      skillPageSummary({
        loading: false,
        error: null,
        totalCount: 33,
        enabledCount: 11,
        cap: 5,
        planId: 'basic',
      }),
    ).toBe('已保留 11 项常用能力 · 基础版上限 5');
    expect(
      skillPageSummary({
        loading: false,
        error: null,
        totalCount: 33,
        enabledCount: 0,
        cap: 0,
        planId: 'free',
      }),
    ).toBe('体验版可查看任务示例');
  });

  it('builds plan-aware limit messages', () => {
    expect(skillLimitMessage({ cap: 0, planId: 'free' })).toBe('当前套餐暂不支持开始此任务');
    expect(skillLimitMessage({ cap: 33, planId: 'pro' })).toBe('当前套餐的常用能力已满（33 项）');
    expect(skillLimitMessage({ cap: 5, planId: 'basic' })).toBe(
      '常用能力已满（5 项）· 可先移除一项或升级套餐',
    );
  });

  it('explains over-limit skill states without implying a broken counter', () => {
    expect(skillLimitBannerCopy({ cap: 0, enabledCount: 0, planId: 'free' })).toEqual({
      title: '当前套餐可查看任务示例',
      body: '升级到基础版后即可选择并开始任务；专业版可使用全部 13 类任务。',
    });
    expect(skillLimitBannerCopy({ cap: 5, enabledCount: 11, planId: 'basic' })).toEqual({
      title: '当前已保留 11 项常用能力',
      body: '基础版最多保留 5 项。现有任务仍可使用；移除后才能添加新的常用能力。',
    });
    expect(skillLimitBannerCopy({ cap: 5, enabledCount: 5, planId: 'basic' })).toEqual({
      title: '常用能力已满（5 项）',
      body: '开始其他任务前，可先移除一项常用能力，或升级套餐。',
    });
  });

  it('formats skill load errors for user-facing surfaces', () => {
    expect(skillLoadErrorCopy('  offline  ')).toEqual({
      title: '任务选项暂时无法加载',
      body: 'offline',
    });
    expect(skillLoadErrorCopy('')).toEqual({
      title: '任务选项暂时无法加载',
      body: '请稍后重试，或刷新页面后再打开能力中心。',
    });
  });

  it('describes the card badge while saving', () => {
    expect(skillCardBadge({ enabled: false, pending: false })).toBe('加入常用');
    expect(skillCardBadge({ enabled: true, pending: false })).toBe('常用');
    expect(skillCardBadge({ enabled: true, pending: true })).toBe('保存中…');
    expect(skillCardBadge({ enabled: false, pending: false, limitBlocked: true, cap: 0 })).toBe(
      '暂不可用',
    );
    expect(skillCardBadge({ enabled: false, pending: false, limitBlocked: true })).toBe('已达上限');
  });

  it('explains how enabled skill cards affect new tasks', () => {
    expect(skillCardUsageHint({ enabled: true, pending: false })).toBe('已加入常用');
    expect(skillCardUsageHint({ enabled: false, pending: false })).toBe('可加入常用');
    expect(skillCardUsageHint({ enabled: false, pending: true })).toBe('正在保存');
    expect(skillCardUsageHint({ enabled: true, pending: false, cap: 0 })).toBe(
      '当前套餐暂不可使用',
    );
    expect(skillCardUsageHint({ enabled: false, pending: false, limitBlocked: true, cap: 0 })).toBe(
      '当前套餐暂不可使用',
    );
    expect(skillCardUsageHint({ enabled: false, pending: false, limitBlocked: true })).toBe(
      '先移除一项常用能力',
    );
  });

  it('builds an editable skill task draft from a skill card', () => {
    expect(
      skillTaskDraft({
        id: ' douyin-live-ops ',
        name: ' 抖音直播与运营 ',
        description: ' 直播复盘 ',
      }),
    ).toEqual({
      skillId: 'douyin-live-ops',
      skillName: '抖音直播与运营',
      skillSource: 'manual',
      prompt: '@抖音直播与运营 ',
    });
    expect(skillTaskDraft({ id: '', name: '', description: '' })).toEqual({
      skillId: '',
      skillName: '技能',
      skillSource: 'manual',
      prompt: '@技能 ',
    });
    expect(
      skillTaskDraft(
        {
          id: 'data-report-insight',
          name: '数据报表解读',
          description: '表格分析',
        },
        ' 分析这份周报并找出异常 ',
      ),
    ).toEqual({
      skillId: 'data-report-insight',
      skillName: '数据报表解读',
      skillSource: 'manual',
      prompt: '@数据报表解读 分析这份周报并找出异常',
    });
  });

  it('decides whether a capability can start immediately, must enable first, or is blocked', () => {
    expect(skillStartDecision({ enabled: true, enabledCount: 5, cap: 5 })).toBe('start');
    expect(skillStartDecision({ enabled: false, enabledCount: 4, cap: 5 })).toBe(
      'enable-and-start',
    );
    expect(skillStartDecision({ enabled: false, enabledCount: 5, cap: 5 })).toBe('blocked');
    expect(skillStartDecision({ enabled: false, enabledCount: 0, cap: 0 })).toBe('blocked');
  });

  it('selects the preferred showcase capabilities without depending on server ordering', () => {
    const showcase = pickCapabilityShowcase([
      { id: 'contract-risk-review' },
      { id: 'douyin-live-ops' },
      { id: 'data-report-insight' },
      { id: 'social-media-strategy' },
    ]);

    expect(showcase.map((skill) => skill.id)).toEqual([
      'data-report-insight',
      'social-media-strategy',
      'contract-risk-review',
    ]);
  });

  it('falls back to available capabilities when preferred showcase entries are missing', () => {
    expect(
      pickCapabilityShowcase([{ id: 'first' }, { id: 'second' }]).map((skill) => skill.id),
    ).toEqual(['first', 'second']);
  });

  it('uses honest connector labels without implying account connection state', () => {
    expect(skillConnectorLabel('browser')).toBe('浏览器');
    expect(skillConnectorLabel('spreadsheet')).toBe('表格');
    expect(skillConnectorLabel('new-connector')).toBe('new-connector');
  });

  it('normalizes skill list payloads before rendering', () => {
    expect(
      normalizeSkillRows([
        {
          id: ' content ',
          name: ' 内容助手 ',
          logoId: ' social-media-strategy ',
          category: '内容运营',
          description: ' 写作 ',
          aliases: [' 社媒 ', ''],
          maturity: 'workflow',
          connectors: [' browser ', ''],
          experience: {
            starterPrompts: [' 示例一 ', '示例二', '示例三', '超出上限'],
            requiredInputs: [' 文件 ', ''],
            deliverables: [' 报告 ', ''],
            boundary: ' 需要人工确认 ',
            exampleSummary: ' 示例摘要 ',
          },
          enabled: true,
        },
        {
          id: 'loose',
          name: '',
          category: 'bad',
          description: null,
          aliases: 'bad',
          maturity: 'bad',
          connectors: null,
          enabled: 'yes',
        },
        { id: 'content', name: 'duplicate', category: '内容运营' },
        { id: '', name: 'empty' },
        null,
      ]),
    ).toEqual([
      {
        id: 'content',
        name: '内容助手',
        logoId: 'social-media-strategy',
        category: '内容运营',
        description: '写作',
        aliases: ['社媒'],
        maturity: 'workflow',
        connectors: ['browser'],
        experience: {
          starterPrompts: ['示例一', '示例二', '示例三'],
          requiredInputs: ['文件'],
          deliverables: ['报告'],
          boundary: '需要人工确认',
          exampleSummary: '示例摘要',
        },
        enabled: true,
      },
      {
        id: 'loose',
        name: 'loose',
        logoId: 'loose',
        category: '内容运营',
        description: '暂未提供说明',
        aliases: [],
        maturity: 'template',
        connectors: [],
        experience: {
          starterPrompts: [],
          requiredInputs: [],
          deliverables: [],
          boundary: '执行前请确认输入材料、授权范围和最终用途。',
          exampleSummary: '暂无示例说明',
        },
        enabled: false,
      },
    ]);
  });

  it('normalizes malformed skill list payloads to empty', () => {
    expect(normalizeSkillRows(null)).toEqual([]);
    expect(normalizeSkillRows({ id: 'skill' })).toEqual([]);
  });

  it('normalizes toggle responses with an optimistic fallback', () => {
    expect(normalizeSkillToggleResponse({ enabled: false }, true)).toEqual({
      enabled: false,
    });
    expect(normalizeSkillToggleResponse({ enabled: 'bad' }, true)).toEqual({
      enabled: true,
    });
    expect(normalizeSkillToggleResponse(null, false)).toEqual({
      enabled: false,
    });
  });
});
