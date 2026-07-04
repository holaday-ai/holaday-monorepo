import { describe, expect, it } from 'vitest';
import {
  groupSkillsByCategory,
  normalizeSkillRows,
  normalizeSkillToggleResponse,
  skillCardBadge,
  skillCardUsageHint,
  skillTaskDraft,
  skillLimitBannerCopy,
  skillLimitMessage,
  skillLoadErrorCopy,
  skillPageSummary,
  skillPlanLabel,
  type SkillCategory,
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
    ).toBe('技能加载中…');
    expect(
      skillPageSummary({
        loading: false,
        error: 'offline',
        totalCount: 0,
        enabledCount: 0,
        cap: 0,
        planId: 'free',
      }),
    ).toBe('技能暂时无法加载');
    expect(
      skillPageSummary({
        loading: false,
        error: null,
        totalCount: 0,
        enabledCount: 0,
        cap: 0,
        planId: 'free',
      }),
    ).toBe('暂无可用技能');
    expect(
      skillPageSummary({
        loading: false,
        error: null,
        totalCount: 33,
        enabledCount: 2,
        cap: 5,
        planId: 'basic',
      }),
    ).toBe('已启用 2 / 5 · 基础版');
    expect(
      skillPageSummary({
        loading: false,
        error: null,
        totalCount: 33,
        enabledCount: 11,
        cap: 5,
        planId: 'basic',
      }),
    ).toBe('已启用 11 个 · 基础版上限 5');
    expect(
      skillPageSummary({
        loading: false,
        error: null,
        totalCount: 33,
        enabledCount: 0,
        cap: 0,
        planId: 'free',
      }),
    ).toBe('体验版暂不支持启用技能');
  });

  it('builds plan-aware limit messages', () => {
    expect(skillLimitMessage({ cap: 0, planId: 'free' })).toBe(
      '体验版暂不支持启用技能',
    );
    expect(skillLimitMessage({ cap: 33, planId: 'pro' })).toBe('已达到 33 个技能上限');
    expect(skillLimitMessage({ cap: 5, planId: 'basic' })).toBe(
      '已达到当前套餐的技能上限（5 个）· 升级到专业版可使用全部 13 个技能',
    );
  });

  it('explains over-limit skill states without implying a broken counter', () => {
    expect(skillLimitBannerCopy({ cap: 0, enabledCount: 0, planId: 'free' })).toEqual({
      title: '体验版暂不支持启用技能',
      body: '升级到基础版可自选技能；升级到专业版可使用全部 13 个技能。',
    });
    expect(skillLimitBannerCopy({ cap: 5, enabledCount: 11, planId: 'basic' })).toEqual({
      title: '当前已启用 11 个技能',
      body: '基础版上限为 5 个。已启用的技能会继续可用；如果停用后想启用新技能，需要先保持在上限内。',
    });
    expect(skillLimitBannerCopy({ cap: 5, enabledCount: 5, planId: 'basic' })).toEqual({
      title: '已达到 5 个技能上限',
      body: '升级到专业版可使用全部 13 个技能。',
    });
  });

  it('formats skill load errors for user-facing surfaces', () => {
    expect(skillLoadErrorCopy('  offline  ')).toEqual({
      title: '技能暂时无法加载',
      body: 'offline',
    });
    expect(skillLoadErrorCopy('')).toEqual({
      title: '技能暂时无法加载',
      body: '请稍后重试，或刷新页面后再打开技能。',
    });
  });

  it('describes the card badge while saving', () => {
    expect(skillCardBadge({ enabled: false, pending: false })).toBe('启用');
    expect(skillCardBadge({ enabled: true, pending: false })).toBe('已启用');
    expect(skillCardBadge({ enabled: true, pending: true })).toBe('保存中…');
    expect(skillCardBadge({ enabled: false, pending: false, limitBlocked: true, cap: 0 })).toBe(
      '不可启用',
    );
    expect(skillCardBadge({ enabled: false, pending: false, limitBlocked: true })).toBe(
      '已达上限',
    );
  });

  it('explains how enabled skill cards affect new tasks', () => {
    expect(skillCardUsageHint({ enabled: true, pending: false })).toBe(
      '会自动匹配；可在输入框 @ 调用',
    );
    expect(skillCardUsageHint({ enabled: false, pending: false })).toBe(
      '启用后可参与自动匹配',
    );
    expect(skillCardUsageHint({ enabled: false, pending: true })).toBe(
      '正在保存选择',
    );
    expect(skillCardUsageHint({ enabled: true, pending: false, cap: 0 })).toBe(
      '当前套餐不可使用，可停用',
    );
    expect(
      skillCardUsageHint({ enabled: false, pending: false, limitBlocked: true, cap: 0 }),
    ).toBe('当前套餐不可启用');
    expect(skillCardUsageHint({ enabled: false, pending: false, limitBlocked: true })).toBe(
      '先停用一个技能后可启用',
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
    expect(
      skillTaskDraft({ id: '', name: '', description: '' }),
    ).toEqual({
      skillId: '',
      skillName: '技能',
      skillSource: 'manual',
      prompt: '@技能 ',
    });
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
        enabled: true,
      },
      {
        id: 'loose',
        name: 'loose',
        logoId: 'loose',
        category: '内容运营',
        description: '暂无技能说明',
        aliases: [],
        maturity: 'template',
        connectors: [],
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
