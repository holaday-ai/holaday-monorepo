import { describe, expect, it } from 'vitest';
import { SKILL_META, skillMetaById } from '../../agent/skills/skill-meta.js';
import { __skillsInternals } from './skills.js';

const {
  buildSkillListRows,
  normalizeSelectedSkillIds,
  skillCapForPlan,
  skillLimitErrorMessage,
} = __skillsInternals;

describe('skills router plan limits', () => {
  it('exposes the v1 skills catalogue instead of legacy expert cards', () => {
    expect(SKILL_META).toHaveLength(13);
    expect(SKILL_META.map((skill) => skill.id)).toEqual([
      'douyin-live-ops',
      'xiaohongshu-seeding-ops',
      'wechat-article-ops',
      'social-media-strategy',
      'image-prompt-reverse',
      'a-share-market-briefing',
      'contract-risk-review',
      'market-competitor-insight',
      'data-report-insight',
      'product-plan-drafting',
      'project-delivery-management',
      'resume-search-screening',
      'performance-review-design',
    ]);
    expect(skillMetaById('douyin-live-ops')?.name).toBe('抖音直播与运营');
    expect(skillMetaById('resume-search-screening')?.aliases).toContain('简历');
    expect(skillMetaById('a-share-market-briefing')?.connectors).toContain('a-share-market-data');
  });

  it('uses the shared plan role limits for expert skills', () => {
    expect(skillCapForPlan('free')).toBe(0);
    expect(skillCapForPlan('basic')).toBe(5);
    expect(skillCapForPlan('pro')).toBe(33);
    expect(skillCapForPlan('unknown')).toBe(0);
  });

  it('keeps server-side limit errors actionable', () => {
    expect(skillLimitErrorMessage('free', 0)).toBe('当前套餐暂不支持启用技能');
    expect(skillLimitErrorMessage('basic', 5)).toBe(
      '基础版最多可启用 5 个技能，请先停用一个技能后再启用新的技能',
    );
    expect(skillLimitErrorMessage('pro', 33)).toBe(
      '专业版最多可启用 33 个技能，请先停用一个技能后再启用新的技能',
    );
  });

  it('drops stale selected skill ids before counting plan limits', () => {
    expect(
      normalizeSelectedSkillIds(['douyin-live-ops', 'missing-skill', 'douyin-live-ops']),
    ).toEqual(['douyin-live-ops']);
    expect(normalizeSelectedSkillIds(null)).toEqual([]);
  });

  it('builds richer skill list rows for the web app', () => {
    const [first] = buildSkillListRows(['douyin-live-ops']);
    expect(first).toBeDefined();
    if (!first) throw new Error('expected at least one skill row');
    expect(first).toMatchObject({
      id: 'douyin-live-ops',
      name: '抖音直播与运营',
      logoId: 'douyin-live-ops',
      category: '内容运营',
      maturity: 'workflow',
      enabled: true,
    });
    expect(first.aliases).toContain('抖音');
    expect(first.connectors).toContain('douyin');
    expect('icon' in first).toBe(false);
  });
});
