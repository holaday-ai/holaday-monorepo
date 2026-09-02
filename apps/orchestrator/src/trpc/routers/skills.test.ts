import { describe, expect, it } from 'vitest';
import { SKILL_META, skillMetaById } from '../../agent/skills/skill-meta.js';
import { __skillsInternals, skillsRouter } from './skills.js';

const {
  buildSkillListRows,
  normalizeSelectedSkillIds,
  toggleSelectedSkillIds,
} = __skillsInternals;

describe('skills router preferences', () => {
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

  it('allows every catalogue skill to be added to common skills without a plan cap', () => {
    let selected: string[] = [];
    for (const skill of SKILL_META) {
      const result = toggleSelectedSkillIds(selected, skill.id);
      expect(result.enabled).toBe(true);
      selected = result.next;
    }
    expect(selected).toHaveLength(13);

    const removed = toggleSelectedSkillIds(selected, 'douyin-live-ops');
    expect(removed.enabled).toBe(false);
    expect(removed.next).toHaveLength(12);
    expect(removed.next).not.toContain('douyin-live-ops');
  });

  it('drops stale selected skill ids before updating common skills', () => {
    expect(
      normalizeSelectedSkillIds(['douyin-live-ops', 'missing-skill', 'douyin-live-ops']),
    ).toEqual(['douyin-live-ops']);
    expect(normalizeSelectedSkillIds(null)).toEqual([]);
  });

  it('canonicalizes legacy selected skill ids before updating common skills', () => {
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

  it('serializes preference toggles with a row lock inside a transaction', async () => {
    const events: string[] = [];
    let storedSkills: string[] | null = [];
    const tx = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => ({
              for: async (mode: string) => {
                events.push(`lock:${mode}`);
                return [{ id: 7, selectedSkills: storedSkills }];
              },
            }),
          }),
        }),
      }),
      update: () => ({
        set: (value: { selectedSkills: string[] | null }) => ({
          where: async () => {
            storedSkills = value.selectedSkills;
            events.push('update');
          },
        }),
      }),
    };
    const db = {
      transaction: async <T>(operation: (transaction: typeof tx) => Promise<T>): Promise<T> => {
        events.push('transaction');
        return operation(tx);
      },
    };

    const result = await skillsRouter
      .createCaller({ db, userId: 'usr_skills', logger: {} } as never)
      .toggle({ skillId: 'douyin-live-ops' });

    expect(events).toEqual(['transaction', 'lock:update', 'update']);
    expect(storedSkills).toEqual(['douyin-live-ops']);
    expect(result).toEqual({ skillId: 'douyin-live-ops', enabled: true });
  });
});
