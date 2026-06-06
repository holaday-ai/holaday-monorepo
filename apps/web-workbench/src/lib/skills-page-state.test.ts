import { describe, expect, it } from 'vitest';
import {
  groupSkillsByCategory,
  normalizeSkillRows,
  normalizeSkillToggleResponse,
  skillCardBadge,
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
  { id: 'finance', category: '财务' },
  { id: 'content', category: '内容' },
  { id: 'ops', category: '运营' },
];

describe('skills page state helpers', () => {
  it('groups skills in product category order', () => {
    const groups = groupSkillsByCategory(skills);

    expect(groups.map((group) => group.category)).toEqual(['运营', '内容', '财务']);
    expect(groups[0]?.items.map((item) => item.id)).toEqual(['ops']);
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
    ).toBe('技能加载失败');
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
        enabledCount: 0,
        cap: 0,
        planId: 'free',
      }),
    ).toBe('已加载 33 个技能 · 体验版');
  });

  it('builds plan-aware limit messages', () => {
    expect(skillLimitMessage({ cap: 33, planId: 'pro' })).toBe('已达到 33 个技能上限');
    expect(skillLimitMessage({ cap: 5, planId: 'basic' })).toBe(
      '已达到当前套餐的技能上限（5 个）· 升级到专业版可使用全部 33 个技能',
    );
  });

  it('formats skill load errors for user-facing surfaces', () => {
    expect(skillLoadErrorCopy('  offline  ')).toEqual({
      title: '技能暂时无法加载',
      body: 'offline',
    });
    expect(skillLoadErrorCopy('')).toEqual({
      title: '技能暂时无法加载',
      body: '请稍后重试，或刷新页面后再打开专家技能。',
    });
  });

  it('describes the card badge while saving', () => {
    expect(skillCardBadge({ enabled: false, pending: false })).toBe('启用');
    expect(skillCardBadge({ enabled: true, pending: false })).toBe('已启用');
    expect(skillCardBadge({ enabled: true, pending: true })).toBe('保存中…');
  });

  it('normalizes skill list payloads before rendering', () => {
    expect(
      normalizeSkillRows([
        {
          id: ' content ',
          name: ' 内容助手 ',
          icon: ' PenTool ',
          category: '内容',
          description: ' 写作 ',
          enabled: true,
        },
        {
          id: 'loose',
          name: '',
          icon: '',
          category: 'bad',
          description: null,
          enabled: 'yes',
        },
        { id: 'content', name: 'duplicate', category: '运营' },
        { id: '', name: 'empty' },
        null,
      ]),
    ).toEqual([
      {
        id: 'content',
        name: '内容助手',
        icon: 'PenTool',
        category: '内容',
        description: '写作',
        enabled: true,
      },
      {
        id: 'loose',
        name: 'loose',
        icon: 'Sparkles',
        category: '其他',
        description: '暂无技能说明',
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
