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

  it('canonicalizes legacy selected skill ids before counting plan limits', () => {
    expect(
      normalizeSelectedSkillIds([
        'a-share-analyst',
        'a-share-market-briefing',
        'douyin',
        'xiaohongshu',
        'wechat_gongzhong',
      ]),
    ).toEqual([
      'a-share-market-briefing',
      'douyin-live-ops',
      'xiaohongshu-seeding-ops',
      'wechat-article-ops',
    ]);
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
    expect(first.experience).toEqual({
      starterPrompts: [
        '复盘这场直播，找出流失点和下一场优化动作',
        '为这个产品写一份 60 秒直播讲解脚本',
        '规划未来 7 天的直播与短视频选题',
      ],
      requiredInputs: ['直播回放或数据截图', '产品与目标受众信息'],
      deliverables: ['复盘结论与问题清单', '下一轮脚本或运营计划'],
      boundary: '不会代替平台发布、投流或承诺销量；关键数据缺失时会标注待确认。',
      exampleSummary: '从直播数据和内容中提炼流失原因、有效话术与下一场行动。',
    });
    expect(
      buildSkillListRows([]).every(
        (skill) => skill.experience.starterPrompts.length === 3,
      ),
    ).toBe(true);
    expect('icon' in first).toBe(false);
  });

  it('marks canonical skill rows enabled when the user still stores legacy skill ids', () => {
    const rows = buildSkillListRows(['a-share-analyst', 'douyin', 'xiaohongshu']);
    expect(rows.find((skill) => skill.id === 'a-share-market-briefing')?.enabled).toBe(true);
    expect(rows.find((skill) => skill.id === 'douyin-live-ops')?.enabled).toBe(true);
    expect(rows.find((skill) => skill.id === 'xiaohongshu-seeding-ops')?.enabled).toBe(true);
  });
});
